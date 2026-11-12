// Participants and consent (FRS FR-PART-1…4, FR-PLAN-1, FR-PRIV-1/2; DDD §14). No identity data:
// study code, grouping and demographics only (DDD §15). The school is stored only as a keyed HMAC and
// the birth date only as month and year (FR-PART-2). Consent is a history: recording consent
// supersedes the current record, which is kept.
import { createHmac } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserClaims } from '../auth.js';
import { inTransaction, likeAny, one, rows } from '../db.js';
import type { Queryable } from '../app-log.js';
import { NO_GROUP } from '../director.js';
import { loadEffectiveSettings, setting } from '../settings-store.js';

const GRADES = ['KINDERGARTEN', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6'] as const;
const BirthMonth = z.string().regex(/^(19|20)\d\d-(0[1-9]|1[0-2])$/).refine((v) => v <= new Date().toISOString().slice(0, 7));

const CreateParticipant = z.object({
  study_code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  domain_id: z.number().int().positive(),
  region_id: z.number().int().positive().nullable().default(null),
  school: z.string().trim().min(1).max(120),
  /** YYYY-MM; not in the future. */
  birth_year_month: BirthMonth,
  grade_level: z.enum(GRADES),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  ses_group: z.enum(['LOW', 'MID', 'HIGH']).nullable().default(null),
  dominant_hand: z.enum(['RIGHT', 'LEFT', 'AMBIDEXTROUS']),
  /** TABLET (default) or PAPER (scores entered by hand, FR-LEG-2). LEGACY participants come only from the legacy import. */
  cohort: z.enum(['TABLET', 'PAPER']).default('TABLET'),
});

/** Every field but the study code can change (FR-PART-1: the code is the participant's identity). */
const UpdateParticipant = z.object({
  domain_id: z.number().int().positive().optional(),
  region_id: z.number().int().positive().nullable().optional(),
  /** A new school name; only its keyed hash is stored. */
  school: z.string().trim().min(1).max(120).optional(),
  birth_year_month: BirthMonth.optional(),
  grade_level: z.enum(GRADES).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  ses_group: z.enum(['LOW', 'MID', 'HIGH']).nullable().optional(),
  dominant_hand: z.enum(['RIGHT', 'LEFT', 'AMBIDEXTROUS']).optional(),
  is_active: z.boolean().optional(),
}).strict();

const Consent = z.object({
  consent_version: z.string().trim().min(1).max(20),
  /** The day the form was signed: not in the future. */
  signed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => v <= new Date().toISOString().slice(0, 10) && !Number.isNaN(Date.parse(v))),
  allows_hand_video: z.boolean().default(false),
  allows_research_use: z.boolean().default(false),
  allows_open_science: z.boolean().default(false),
});

const ParticipantFilter = z.object({
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
  /** true: deactivated participants too. */
  all: z.enum(['true', 'false']).optional(),
});

const bad = (details: unknown) => ({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details } });
const notFound = { error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } };

/** Same school, same code: case, spacing and Unicode form are normalised before hashing. */
export function schoolCodeHmac(key: string, school: string): string {
  const normalised = school.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return createHmac('sha256', key).update(normalised).digest('hex');
}

const DETAIL = `SELECT p.id, p.study_code, p.domain_id, p.region_id, p.grade_level, p.gender, p.ses_group, p.dominant_hand,
       to_char(p.birth_year_month, 'YYYY-MM') AS birth_year_month, p.cohort, p.legacy_ref, p.is_active,
       p.school_code_hmac IS NOT NULL AS has_school, p.created_at, p.updated_at
  FROM participants p WHERE p.id = $1`;

interface ParticipantRow {
  id: string;
  study_code: string;
  domain_id: number;
  region_id: number | null;
  grade_level: string;
  gender: string;
  ses_group: string | null;
  dominant_hand: string;
  birth_year_month: string | null;
  is_active: boolean;
}

export interface ConsentRow {
  id: string;
  consent_version: string;
  signed_on: string;
  allows_hand_video: boolean;
  allows_research_use: boolean;
  allows_open_science: boolean;
  recorded_by: string;
  recorded_at: string;
  superseded_at: string | null;
}

export const currentConsent = (db: Queryable, participantId: string) =>
  one<ConsentRow>(db,
    `SELECT c.id, c.consent_version, to_char(c.signed_on, 'YYYY-MM-DD') AS signed_on, c.allows_hand_video, c.allows_research_use,
            c.allows_open_science, u.full_name AS recorded_by, c.recorded_at, c.superseded_at
       FROM consent_records c JOIN users u ON u.id = c.recorded_by
      WHERE c.participant_id = $1 AND c.superseded_at IS NULL`, [participantId]);

/** A RESEARCH ethics approval valid today and not withdrawn, newest first. */
export const validResearchApproval = (db: Queryable) =>
  one<{ id: number; authority: string; reference: string | null }>(db,
    `SELECT id, authority, reference FROM ethics_approvals
      WHERE approval_type = 'RESEARCH' AND withdrawn_at IS NULL
        AND (valid_from IS NULL OR valid_from <= current_date) AND (valid_to IS NULL OR valid_to >= current_date)
      ORDER BY id DESC LIMIT 1`);

export type ResearchBlock = 'RESEARCH_DISABLED' | 'NO_RESEARCH_APPROVAL' | 'NO_RESEARCH_CONSENT';

/**
 * Whether a RESEARCH session may be created for the participant (FR-PLAN-1): the System setting is on,
 * a research approval is valid today and the current consent allows research use.
 */
export async function researchCheck(db: Queryable, participantId: string): Promise<{ allowed: true; approval_id: number } | { allowed: false; reason: ResearchBlock }> {
  if (!setting(await loadEffectiveSettings(db, NO_GROUP, null), 'privacy.research_purpose_enabled', false)) return { allowed: false, reason: 'RESEARCH_DISABLED' };
  const approval = await validResearchApproval(db);
  if (!approval) return { allowed: false, reason: 'NO_RESEARCH_APPROVAL' };
  if (!(await currentConsent(db, participantId))?.allows_research_use) return { allowed: false, reason: 'NO_RESEARCH_CONSENT' };
  return { allowed: true, approval_id: approval.id };
}

export const participantRoutes: FastifyPluginAsync = async (app) => {
  const staff = app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN');
  const db = () => app.deps.db;
  const groupsExist = async (domainId: number | undefined, regionId: number | null | undefined) =>
    (domainId === undefined || !!(await one(db(), 'SELECT 1 FROM domains WHERE id = $1 AND is_active', [domainId])))
    && (regionId == null || !!(await one(db(), 'SELECT 1 FROM regions WHERE id = $1 AND is_active', [regionId])));

  // ?q= narrows the list to study codes containing the text (the cockpit's participant search).
  app.get('/participants', { preHandler: staff }, async (req, reply) => {
    const f = ParticipantFilter.safeParse(req.query);
    if (!f.success) return reply.status(400).send(bad(f.error.flatten()));
    return rows(
      db(),
      `SELECT p.id, p.study_code, p.domain_id, p.region_id, p.grade_level, p.gender, p.ses_group, p.dominant_hand,
              to_char(p.birth_year_month, 'YYYY-MM') AS birth_year_month, p.is_active, p.created_at,
              c.consent_version, c.allows_hand_video, c.allows_research_use, c.allows_open_science
         FROM participants p LEFT JOIN consent_records c ON c.participant_id = p.id AND c.superseded_at IS NULL
        WHERE ($3::boolean OR p.is_active) AND ($1::text IS NULL OR p.study_code ILIKE $1)
        ORDER BY p.created_at DESC LIMIT $2`,
      [f.data.q ? likeAny(f.data.q) : null, f.data.limit, f.data.all === 'true'],
    );
  });

  app.post('/participants', { preHandler: staff }, async (req, reply) => {
    const body = CreateParticipant.safeParse(req.body);
    if (!body.success) return reply.status(400).send(bad(body.error.flatten()));
    const user = req.user as UserClaims;
    const { school, ...p } = body.data;
    if (!(await groupsExist(p.domain_id, p.region_id))) return reply.status(400).send(bad({ domain_id: p.domain_id, region_id: p.region_id }));
    const exists = await one(db(), 'SELECT 1 FROM participants WHERE upper(study_code) = upper($1)', [p.study_code]);
    if (exists) return reply.status(409).send({ error: { code: 'STUDY_CODE_TAKEN', message_key: 'participants.code_taken', details: {} } });
    const created = await one<{ id: string }>(
      db(),
      `INSERT INTO participants (study_code, domain_id, region_id, school_code_hmac, grade_level, gender, ses_group, dominant_hand,
         birth_year_month, created_by, cohort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [p.study_code, p.domain_id, p.region_id, schoolCodeHmac(app.deps.schoolHmacKey, school), p.grade_level, p.gender,
        p.ses_group, p.dominant_hand, `${p.birth_year_month}-01`, user.sub, p.cohort],
    );
    app.appLog.write({
      severity: 'INFO', event_type: 'participants.participant.created', actor_user_id: user.sub, actor_role: user.role,
      domain_id: p.domain_id, region_id: p.region_id, entity_type: 'participant', entity_id: created!.id,
      message: `Participant ${p.study_code} created`, details: { study_code: p.study_code, cohort: p.cohort },
    });
    return reply.status(201).send({ id: created!.id, ...p });
  });

  /** The participant's record, current consent and its history, sessions count and whether research is possible now. */
  app.get<{ Params: { id: string } }>('/participants/:id', { preHandler: staff }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(notFound);
    const p = await one<ParticipantRow>(db(), DETAIL, [req.params.id]);
    if (!p) return reply.status(404).send(notFound);
    const consents = await rows<ConsentRow>(db(),
      `SELECT c.id, c.consent_version, to_char(c.signed_on, 'YYYY-MM-DD') AS signed_on, c.allows_hand_video, c.allows_research_use,
              c.allows_open_science, u.full_name AS recorded_by, c.recorded_at, c.superseded_at
         FROM consent_records c JOIN users u ON u.id = c.recorded_by
        WHERE c.participant_id = $1 ORDER BY c.recorded_at DESC`, [p.id]);
    const sessions = await one<{ n: number }>(db(), 'SELECT count(*)::int AS n FROM sessions WHERE participant_id = $1', [p.id]);
    const research = await researchCheck(db(), p.id);
    const settings = await loadEffectiveSettings(db(), p.domain_id, p.region_id);
    return {
      ...p,
      consent: consents.find((c) => c.superseded_at === null) ?? null,
      consent_history: consents,
      sessions: sessions!.n,
      research: research.allowed ? { allowed: true } : research,
      hand_video: { setting: setting(settings, 'ilt.video.recording_enabled', false) },
    };
  });

  app.patch<{ Params: { id: string } }>('/participants/:id', { preHandler: staff }, async (req, reply) => {
    const body = UpdateParticipant.safeParse(req.body);
    if (!body.success || !z.string().uuid().safeParse(req.params.id).success) return reply.status(400).send(bad(body.success ? {} : body.error.flatten()));
    const user = req.user as UserClaims;
    const before = await one<ParticipantRow & { school_code_hmac: string | null }>(db(),
      `SELECT id, study_code, domain_id, region_id, grade_level, gender, ses_group, dominant_hand,
              to_char(birth_year_month, 'YYYY-MM') AS birth_year_month, is_active, school_code_hmac FROM participants WHERE id = $1`, [req.params.id]);
    if (!before) return reply.status(404).send(notFound);
    const { school, ...p } = body.data;
    if (!(await groupsExist(p.domain_id, p.region_id))) return reply.status(400).send(bad({ domain_id: p.domain_id, region_id: p.region_id }));

    // Only real changes are written and logged, each with its old and new value. The school is
    // logged only as "changed": its name is never stored or logged.
    const changed: Record<string, { old: unknown; new: unknown }> = {};
    for (const [k, v] of Object.entries(p) as [keyof typeof p, unknown][]) {
      if (v !== undefined && v !== before[k as keyof ParticipantRow]) changed[k] = { old: before[k as keyof ParticipantRow], new: v };
    }
    const schoolHmac = school === undefined ? undefined : schoolCodeHmac(app.deps.schoolHmacKey, school);
    const schoolChanged = schoolHmac !== undefined && schoolHmac !== before.school_code_hmac;
    if (Object.keys(changed).length === 0 && !schoolChanged) return { changed: [] };

    const sets: string[] = [];
    const values: unknown[] = [before.id];
    for (const [k, { new: v }] of Object.entries(changed)) {
      values.push(k === 'birth_year_month' ? `${v as string}-01` : v);
      sets.push(`${k} = $${values.length}`);
    }
    if (schoolChanged) {
      values.push(schoolHmac);
      sets.push(`school_code_hmac = $${values.length}`);
    }
    await db().query(`UPDATE participants SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
    const details: Record<string, unknown> = { study_code: before.study_code, changed: { ...changed, ...(schoolChanged ? { school: 'changed' } : {}) } };
    app.appLog.write({
      severity: 'INFO', event_type: 'participants.participant.updated', actor_user_id: user.sub, actor_role: user.role,
      domain_id: (p.domain_id ?? before.domain_id), region_id: p.region_id === undefined ? before.region_id : p.region_id,
      entity_type: 'participant', entity_id: before.id,
      message: `Participant ${before.study_code} ${changed.is_active?.new === false ? 'deactivated' : changed.is_active?.new === true ? 'reactivated' : 'updated'}`,
      details,
    });
    return { changed: [...Object.keys(changed), ...(schoolChanged ? ['school'] : [])] };
  });

  /** Records consent (FR-PART-4): the new record becomes current and the previous one is kept as superseded. */
  app.post<{ Params: { id: string } }>('/participants/:id/consent', { preHandler: staff }, async (req, reply) => {
    const body = Consent.safeParse(req.body);
    if (!body.success || !z.string().uuid().safeParse(req.params.id).success) return reply.status(400).send(bad(body.success ? {} : body.error.flatten()));
    const user = req.user as UserClaims;
    const p = await one<{ id: string; study_code: string; domain_id: number; region_id: number | null; is_active: boolean }>(db(),
      'SELECT id, study_code, domain_id, region_id, is_active FROM participants WHERE id = $1', [req.params.id]);
    if (!p) return reply.status(404).send(notFound);
    if (!p.is_active) return reply.status(409).send({ error: { code: 'PARTICIPANT_INACTIVE', message_key: 'participants.inactive', details: {} } });
    const c = body.data;
    const { previous, created } = await inTransaction(db(), async (q) => {
      const prev = await one<ConsentRow>(q,
        `UPDATE consent_records SET superseded_at = now() WHERE participant_id = $1 AND superseded_at IS NULL
         RETURNING consent_version, to_char(signed_on, 'YYYY-MM-DD') AS signed_on, allows_hand_video, allows_research_use, allows_open_science`, [p.id]);
      const row = await one<{ id: string }>(q,
        `INSERT INTO consent_records (participant_id, consent_version, signed_on, allows_hand_video, allows_research_use, allows_open_science, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [p.id, c.consent_version, c.signed_on, c.allows_hand_video, c.allows_research_use, c.allows_open_science, user.sub]);
      return { previous: prev ?? null, created: row! };
    });
    const flags = (x: Pick<ConsentRow, 'allows_hand_video' | 'allows_research_use' | 'allows_open_science'>) =>
      ({ hand_video: x.allows_hand_video, research_use: x.allows_research_use, open_science: x.allows_open_science });
    app.appLog.write({
      severity: 'INFO', event_type: 'participants.consent.recorded', actor_user_id: user.sub, actor_role: user.role,
      domain_id: p.domain_id, region_id: p.region_id, entity_type: 'consent', entity_id: created.id,
      message: `Consent ${c.consent_version} of ${c.signed_on} recorded for ${p.study_code}`,
      details: {
        study_code: p.study_code, consent_version: c.consent_version, signed_on: c.signed_on, new: flags(c),
        old: previous ? { consent_version: previous.consent_version, signed_on: previous.signed_on, ...flags(previous) } : null,
      },
    });
    return reply.status(201).send({ id: created.id });
  });
};
