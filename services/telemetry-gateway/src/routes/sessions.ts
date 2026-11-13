// Sessions: planning, pairing with a 6-digit PIN, step skipping and paper notebook pages (DDD §11.1, §14).
import { randomInt, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ControlPayloads, LANGUAGE_DIRECTION, type LanguageCode } from '@ilt/shared-types';
import {
  fillOrderFor,
  mergeProfile,
  type CanvasGeometry,
  type FillDirection,
  type ProtocolStep,
  type ScoringProfile,
} from '@ilt/template-schemas';
import type { Queryable } from '../app-log.js';
import type { UserClaims } from '../auth.js';
import { currentConsent, researchCheck } from './participants.js';
import { pairReferenceStation } from './reference.js';
import { inTransaction, likeAny, one, rows } from '../db.js';
import { scoringSettingsFrom } from '../scoring-store.js';
import { loadEffectiveSettings, setting, type SettingsSnapshot } from '../settings-store.js';

const PIN_TTL_MINUTES = 10;
const PAIR_MAX_FAILURES = 5;
const PAIR_LOCK_MS = 15 * 60_000;
const TABLET_TOKEN_TTL = '12h';

const CreateSession = z.object({
  participant_id: z.string().uuid(),
  session_type: z.enum(['DAY_1', 'DAY_2', 'DAY_14', 'INTERVENTION']),
  language_code: z.enum(['he', 'en']),
  region_id: z.number().int().positive().nullable().optional(),
  /** FR-PLAN-1: RESEARCH needs the research setting, a valid research approval and research consent. */
  purpose: z.enum(['INTERVENTION', 'RESEARCH']).default('INTERVENTION'),
  /** Intervention sessions (Phase 5b): the target letter's canvas and what the session does with it. */
  letter_canvas_id: z.string().uuid().optional(),
  intervention_kind: z.enum(['TRAINING', 'RETENTION']).optional(),
}).refine((b) => (b.session_type === 'INTERVENTION') === (!!b.letter_canvas_id && !!b.intervention_kind), {
  message: 'An intervention session needs letter_canvas_id and intervention_kind (and only it does)',
});

/** The letter video played before the training sheets: `letter_` + the canvas code without its LETTER_ prefix (LETTER_HE_HE → letter_he_he). */
export const letterVideoKey = (canvasCode: string) => `letter_${canvasCode.toLowerCase().replace(/^letter_/, '')}`.slice(0, 50);
const OPEN_STATUSES = ['PLANNED', 'PAIRED', 'IN_PROGRESS', 'PAUSED'];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Session list filters (cockpit). Dates are the creation day, both ends included. */
const SessionFilter = z.object({
  q: z.string().trim().max(40).optional(),
  status: z.enum(['PLANNED', 'PAIRED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'ABORTED']).optional(),
  session_type: z.enum(['DAY_1', 'DAY_2', 'DAY_14', 'INTERVENTION']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** The evaluator's time zone (IANA name), so a day is the evaluator's day. */
  tz: z.string().max(64).refine(validTimeZone).default('UTC'),
});

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const TEMPLATE_SETTING: Record<Exclude<z.infer<typeof CreateSession>['session_type'], 'INTERVENTION'>, string> = {
  DAY_1: 'ilt.protocol.day1_template',
  DAY_2: 'ilt.protocol.day2_template',
  DAY_14: 'ilt.protocol.day14_template',
};

interface CanvasRow {
  id: string;
  code: string;
  geometry: CanvasGeometry;
  default_scoring_profile: ScoringProfile | null;
}

export interface SessionRow {
  id: string;
  session_code: string;
  participant_id: string;
  study_code: string;
  evaluator_id: string;
  domain_id: number;
  region_id: number | null;
  language_code: LanguageCode;
  session_type: string;
  status: string;
  css_px_per_mm: string | null;
  /** A tablet holds a valid pairing for this session (connected or not); released tablets do not count. */
  tablet_paired: boolean;
  settings_snapshot: SettingsSnapshot;
  purpose: 'INTERVENTION' | 'RESEARCH';
  video_enabled: boolean;
  created_at: string;
  /** Intervention sessions only: TRAINING or RETENTION, and the target letter. */
  intervention_kind: 'TRAINING' | 'RETENTION' | null;
  letter: { canvas_id: string; code: string; letter: string | null } | null;
}

export interface StepRow {
  id: string;
  step_index: number;
  step_type: z.infer<typeof ControlPayloads.DISPATCH_STEP>['step_type'];
  label_key: string;
  block_number: number | null;
  is_scored: boolean;
  canvas_id: string | null;
  canvas_code: string | null;
  geometry: CanvasGeometry | null;
  mirrored: boolean;
  fill_order: number[] | null;
  /** Canvas scoring profile copied at session creation; null for notebook pages and videos. */
  profile: ScoringProfile | null;
  video_key: string | null;
  status: string;
  paper_duration_ms: number | null;
  notes: string | null;
}

export async function loadSession(db: Queryable, id: string): Promise<SessionRow | undefined> {
  return one<SessionRow>(
    db,
    `SELECT s.id, s.session_code, s.participant_id, p.study_code, s.evaluator_id, s.domain_id, s.region_id,
            s.language_code, s.session_type, s.status, s.css_px_per_mm, s.tablet_token_id IS NOT NULL AS tablet_paired,
            s.settings_snapshot, s.purpose, s.video_enabled, s.created_at, s.intervention_kind,
            CASE WHEN lc.id IS NULL THEN NULL
                 ELSE json_build_object('canvas_id', lc.id, 'code', lc.code, 'letter', lc.geometry->'letters'->0->>'letter') END AS letter
       FROM sessions s JOIN participants p ON p.id = s.participant_id
       LEFT JOIN canvases lc ON lc.id = s.intervention_canvas_id
      WHERE s.id = $1`,
    [id],
  );
}

export async function loadSteps(db: Queryable, sessionId: string): Promise<StepRow[]> {
  return rows<StepRow>(
    db,
    `SELECT st.id, st.step_index, st.step_type, st.label_key, st.block_number, st.is_scored, st.canvas_id,
            c.code AS canvas_code, c.geometry, st.mirrored, st.fill_order, st.canvas_profile_snapshot AS profile, st.video_key, st.status,
            st.paper_duration_ms, st.notes
       FROM session_steps st LEFT JOIN canvases c ON c.id = st.canvas_id
      WHERE st.session_id = $1 ORDER BY st.step_index`,
    [sessionId],
  );
}

/** Session code: S + yymmdd + 4 characters without look-alikes. */
/** Age in whole months on the session date, from the birth month (FR-PART-3); null when unknown. */
export function ageInMonths(birthYearMonth: string | null, on: Date): number | null {
  if (!birthYearMonth) return null;
  const [y, m] = birthYearMonth.split('-').map(Number) as [number, number];
  return (on.getFullYear() - y) * 12 + (on.getMonth() + 1 - m);
}

function newSessionCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += alphabet[randomInt(alphabet.length)];
  return `S${d}-${suffix}`;
}

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  const evaluator = app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN');
  const pairFailures = new Map<string, { count: number; until: number }>();

  /** Evaluators reach only their own sessions; researchers and admins reach all. */
  async function ownSession(req: FastifyRequest<{ Params: { id: string } }>): Promise<SessionRow | undefined> {
    const user = req.user as UserClaims;
    if (!z.string().uuid().safeParse(req.params.id).success) return undefined;
    const s = await loadSession(app.deps.db, req.params.id);
    if (!s || (user.role === 'EVALUATOR' && s.evaluator_id !== user.sub)) return undefined;
    return s;
  }
  const notFound = { error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } };

  app.get('/sessions', { preHandler: evaluator }, async (req, reply) => {
    const user = req.user as UserClaims;
    const f = SessionFilter.safeParse(req.query);
    if (!f.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: f.error.flatten() } });
    const { q, status, session_type, from, to, tz } = f.data;
    return rows(
      app.deps.db,
      `SELECT s.id, s.session_code, s.participant_id, p.study_code, s.session_type, s.language_code, s.status, s.purpose, s.created_at
         FROM sessions s JOIN participants p ON p.id = s.participant_id
        WHERE ($1::uuid IS NULL OR s.evaluator_id = $1)
          AND ($2::text IS NULL OR s.session_code ILIKE $2 OR p.study_code ILIKE $2)
          AND ($3::text IS NULL OR s.status = $3)
          AND ($4::text IS NULL OR s.session_type = $4)
          AND ($5::date IS NULL OR (s.created_at AT TIME ZONE $7)::date >= $5::date)
          AND ($6::date IS NULL OR (s.created_at AT TIME ZONE $7)::date <= $6::date)
        ORDER BY s.created_at DESC LIMIT 200`,
      [user.role === 'EVALUATOR' ? user.sub : null, q ? likeAny(q) : null, status ?? null, session_type ?? null, from ?? null, to ?? null, tz],
    );
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    const steps = await loadSteps(app.deps.db, s.id);
    const attempts = await rows(
      app.deps.db,
      `SELECT ba.id, st.step_index, ba.attempt_number, ba.status, ba.sample_count, ba.integrity_ok, ba.started_at, ba.ended_at,
              ba.total_time_ms, ba.repeat_reason, sv.version AS score_version, coalesce(sv.pen_lifts, ba.pen_lifts) AS pen_lifts,
              (SELECT json_build_object('total', count(*), 'correct', count(*) FILTER (WHERE im.final_error IS FALSE),
                      'error', count(*) FILTER (WHERE im.final_error IS TRUE), 'open', count(*) FILTER (WHERE im.final_error IS NULL))
                 FROM intervention_marks im WHERE im.block_attempt_id = ba.id HAVING count(*) > 0) AS marks,
              sv.accurate_letters, sv.accuracy_score,
              sv.avg_speed_mm_s, sv.speed_score, sv.pen_lift_score, sv.composite_score, sv.pass
         FROM block_attempts ba JOIN session_steps st ON st.id = ba.session_step_id
         LEFT JOIN score_versions sv ON sv.block_attempt_id = ba.id AND sv.is_current
        WHERE st.session_id = $1 ORDER BY st.step_index, ba.attempt_number`,
      [s.id],
    );
    // Videos available in the session language: the cockpit warns about the others (FR-PLAN-8).
    const videos = await rows<{ video_key: string }>(
      app.deps.db, "SELECT video_key FROM instruction_videos WHERE language_code = $1 AND status = 'ACTIVE'", [s.language_code],
    );
    const { settings_snapshot, ...session } = s;
    const scoring = scoringSettingsFrom(settings_snapshot);
    return {
      ...session,
      timers: timersFrom(settings_snapshot),
      scoring: {
        pass_threshold: scoring.pass_threshold, weight_speed_pct: scoring.weight_speed_pct, weight_accuracy_pct: scoring.weight_accuracy_pct, weight_pen_lifts_pct: scoring.weight_pen_lifts_pct,
        // Phase 5c: whether row 3 of a letter sheet shows the similarity hint (FR-COCK-6).
        similarity_hint: setting(settings_snapshot, 'scoring.similarity_hint.enabled', true),
      },
      steps: steps.map(({ geometry: _g, profile: _p, ...st }) => st),
      attempts,
      available_videos: videos.map((v) => v.video_key),
    };
  });

  app.post('/sessions', { preHandler: evaluator }, async (req, reply) => {
    const body = CreateSession.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: body.error.flatten() } });
    }
    const user = req.user as UserClaims;
    const { participant_id, session_type, language_code, purpose } = body.data;
    const participant = await one<{ domain_id: number; region_id: number | null; study_code: string; birth_year_month: string | null }>(
      app.deps.db,
      "SELECT domain_id, region_id, study_code, to_char(birth_year_month, 'YYYY-MM') AS birth_year_month FROM participants WHERE id = $1 AND is_active",
      [participant_id],
    );
    if (!participant) return reply.status(404).send(notFound);
    const regionId = body.data.region_id === undefined ? participant.region_id : body.data.region_id;
    const settings = await loadEffectiveSettings(app.deps.db, participant.domain_id, regionId);
    if (!setting<string[]>(settings, 'language.enabled', ['he', 'en']).includes(language_code)) {
      return reply.status(409).send({ error: { code: 'LANGUAGE_DISABLED', message_key: 'sessions.language_disabled', details: { language_code } } });
    }

    let researchApprovalId: number | null = null;
    if (purpose === 'RESEARCH') {
      const research = await researchCheck(app.deps.db, participant_id);
      if (!research.allowed) return reply.status(409).send({ error: { code: research.reason, message_key: `sessions.${research.reason.toLowerCase()}`, details: {} } });
      researchApprovalId = research.approval_id;
    }
    // Hand video only when the setting allows it and the participant's consent does (FR-PRIV-2).
    const videoEnabled = setting(settings, 'ilt.video.recording_enabled', false) && !!(await currentConsent(app.deps.db, participant_id))?.allows_hand_video;

    const templateCode = session_type === 'INTERVENTION' ? 'INTERVENTION' : setting(settings, TEMPLATE_SETTING[session_type], session_type);
    const template = await one<{ id: string; steps: ProtocolStep[] }>(
      app.deps.db,
      'SELECT id, steps FROM protocol_templates WHERE code = $1 AND is_active ORDER BY version DESC LIMIT 1',
      [templateCode],
    );
    if (!template) return reply.status(409).send({ error: { code: 'NO_TEMPLATE', message_key: 'sessions.no_template', details: { templateCode } } });

    /** An Active canvas with the participant's Domain override merged into its profile (FR-CAN-8). */
    const loadCanvas = async (where: string, param: string): Promise<CanvasRow | undefined> => {
      const c = await one<CanvasRow & { profile_patch: unknown }>(
        app.deps.db,
        `SELECT c.id, c.code, c.geometry, c.default_scoring_profile, o.profile_patch
           FROM canvases c JOIN canvas_sets cs ON cs.id = c.canvas_set_id
           LEFT JOIN canvas_scoring_overrides o ON o.canvas_id = c.id AND o.domain_id = $2
          WHERE ${where} AND c.status = 'ACTIVE'`,
        [param, participant.domain_id, language_code],
      );
      if (!c) return undefined;
      const { profile_patch, ...canvas } = c;
      return { ...canvas, default_scoring_profile: canvas.default_scoring_profile && mergeProfile(canvas.default_scoring_profile, profile_patch) };
    };
    /** The language's Active canvas for the role (FR-CAN-12). */
    const canvasFor = (role: 'ILT' | 'NOTEBOOK') =>
      loadCanvas('c.code = $1 AND $3::text IS NOT NULL', setting(settings, `language.${language_code}.${role === 'ILT' ? 'ilt_canvas' : 'notebook_canvas'}`, ''));
    const mirrored = setting(settings, `language.${language_code}.mirrored`, false);
    const fillDirection = setting<FillDirection>(settings, `language.${language_code}.fill_direction`, LANGUAGE_DIRECTION[language_code] === 'rtl' ? 'RTL_ROWS' : 'LTR_ROWS');

    // Each step to create with its canvas (none for videos and paper pages).
    let planned: { st: ProtocolStep; canvas?: CanvasRow }[];
    let letter: CanvasRow | undefined;
    const kind = body.data.intervention_kind ?? null;
    if (session_type === 'INTERVENTION') {
      // Phase 5b: one target letter, an Active letter sheet of the session language (FR-PLAN-3, FR-PLAN-4).
      letter = await loadCanvas(
        "c.id = $1::uuid AND c.canvas_type = 'INTERVENTION_SHEET' AND cs.set_type = 'INTERVENTION_LETTERS' AND cs.is_active AND cs.language_code = $3",
        body.data.letter_canvas_id!,
      );
      if (!letter) return reply.status(409).send({ error: { code: 'NO_LETTER', message_key: 'sessions.no_letter', details: {} } });
      const open = await one(app.deps.db,
        `SELECT 1 FROM sessions WHERE participant_id = $1 AND session_type = 'INTERVENTION' AND status = ANY($2)`, [participant_id, OPEN_STATUSES]);
      if (open) return reply.status(409).send({ error: { code: 'INTERVENTION_OPEN', message_key: 'sessions.intervention_open', details: {} } });
      if (kind === 'RETENTION') {
        // The retention check comes the set number of days after the letter's last completed training.
        const days = Number(setting(settings, 'ilt.intervention.retention_days', 14));
        const last = await one<{ due_on: string; due: boolean }>(app.deps.db,
          `SELECT to_char(max(s.completed_at) + make_interval(days => $3::int), 'YYYY-MM-DD') AS due_on,
                  max(s.completed_at) + make_interval(days => $3::int) <= now() AS due
             FROM sessions s JOIN canvases c ON c.id = s.intervention_canvas_id
            WHERE s.participant_id = $1 AND s.session_type = 'INTERVENTION' AND s.intervention_kind = 'TRAINING'
              AND s.status = 'COMPLETED' AND c.code = $2`,
          [participant_id, letter.code, days]);
        if (!last?.due_on) return reply.status(409).send({ error: { code: 'NOT_TRAINED', message_key: 'sessions.not_trained', details: {} } });
        if (!last.due) return reply.status(409).send({ error: { code: 'RETENTION_NOT_DUE', message_key: 'sessions.retention_not_due', details: { due_on: last.due_on } } });
      }
      const sheet = template.steps.find((st) => st.step_type === 'INTERVENTION_SHEET') ?? { step_type: 'INTERVENTION_SHEET', label_key: 'step.intervention_sheet', is_scored: true };
      const count = kind === 'TRAINING' ? Number(setting(settings, 'ilt.intervention.training_sheets', 4)) : 1;
      planned = [
        // Training starts with the letter's video; the cockpit offers to skip it when the library has none (FR-PLAN-8).
        ...(kind === 'TRAINING' ? [{ st: { step_type: 'VIDEO' as const, video_key: letterVideoKey(letter.code), label_key: 'step.video_letter', is_scored: false } }] : []),
        ...Array.from({ length: count }, (_, i) => ({ st: { ...sheet, canvas_role: 'LETTER' as const, block_number: i + 1 }, canvas: letter })),
      ];
    } else {
      const canvases = { ILT: await canvasFor('ILT'), NOTEBOOK: await canvasFor('NOTEBOOK') };
      const warmup = setting(settings, 'ilt.warmup.enabled', true);
      const steps = template.steps.filter((st) => warmup || st.step_type !== 'WARMUP_BLOCK');
      for (const st of steps) {
        if ((st.canvas_role === 'ILT' || st.canvas_role === 'NOTEBOOK') && !canvases[st.canvas_role]) {
          return reply.status(409).send({ error: { code: 'NO_CANVAS', message_key: 'sessions.no_canvas', details: { role: st.canvas_role } } });
        }
        if (st.canvas_role === 'LETTER') {
          return reply.status(409).send({ error: { code: 'NO_LETTER_SET', message_key: 'sessions.no_letter_set', details: {} } });
        }
      }
      planned = steps.map((st) => ({ st, canvas: st.canvas_role === 'ILT' || st.canvas_role === 'NOTEBOOK' ? canvases[st.canvas_role] : undefined }));
    }

    const created = await inTransaction(app.deps.db, async (q) => {
      const session = await one<{ id: string; session_code: string }>(
        q,
        `INSERT INTO sessions (session_code, participant_id, evaluator_id, domain_id, region_id, language_code, session_type,
           protocol_template_id, settings_snapshot, age_months, purpose, research_approval_id, video_enabled, intervention_kind, intervention_canvas_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id, session_code`,
        [newSessionCode(), participant_id, user.sub, participant.domain_id, regionId, language_code, session_type,
          template.id, JSON.stringify(settings), ageInMonths(participant.birth_year_month, new Date()), purpose, researchApprovalId, videoEnabled,
          kind, letter?.id ?? null],
      );
      for (const [index, { st, canvas }] of planned.entries()) {
        const profile = canvas?.default_scoring_profile ?? null;
        const fillOrder = canvas ? (profile?.fill_order.length ? profile.fill_order : fillOrderFor(canvas.geometry.boxes, fillDirection)) : null;
        await q.query(
          `INSERT INTO session_steps (session_id, step_index, step_type, label_key, block_number, is_scored, canvas_id,
             mirrored, fill_order, canvas_profile_snapshot, video_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          // Real letters are never mirrored (FR-CAN-13 is about the invented ILT letter).
          [session!.id, index, st.step_type, st.label_key, st.block_number ?? null, st.is_scored, canvas?.id ?? null,
            canvas && st.canvas_role !== 'LETTER' ? mirrored : false, fillOrder ? JSON.stringify(fillOrder) : null, profile ? JSON.stringify(profile) : null,
            st.video_key ?? null],
        );
      }
      return session!;
    });

    const what = letter ? `, ${kind === 'TRAINING' ? 'training' : 'retention'} of ${letter.code}` : '';
    app.appLog.write({
      severity: 'INFO', event_type: 'session.created', actor_user_id: user.sub, actor_role: user.role,
      domain_id: participant.domain_id, region_id: regionId, session_id: created.id, entity_type: 'session', entity_id: created.id,
      message: `Session ${created.session_code} (${session_type}, ${language_code}${purpose === 'RESEARCH' ? ', research' : ''}${what}) created for ${participant.study_code}`,
      details: {
        session_type, language_code, purpose, research_approval_id: researchApprovalId, video_enabled: videoEnabled, template: templateCode, steps: planned.length,
        ...(letter && { intervention_kind: kind, letter: letter.code }),
      },
    });
    return reply.status(201).send(created);
  });

  /** Opens the pairing room: a new 6-digit PIN, valid for 10 minutes, stored only as a hash. */
  app.post<{ Params: { id: string } }>('/sessions/:id/pairing', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    if (s.status === 'COMPLETED' || s.status === 'ABORTED') {
      return reply.status(409).send({ error: { code: 'SESSION_CLOSED', message_key: 'sessions.closed', details: {} } });
    }
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + PIN_TTL_MINUTES * 60_000);
    await app.deps.db.query('UPDATE sessions SET pairing_pin_hash = $2, pairing_expires_at = $3 WHERE id = $1', [s.id, await hash(pin), expiresAt]);
    return { pin, expires_at: expiresAt.toISOString() };
  });

  /** Whether a PIN is the latest code of an open session or reference station that expired in the last day. */
  async function isExpiredPin(pin: string): Promise<boolean> {
    const expired = await rows<{ pairing_pin_hash: string }>(
      app.deps.db,
      `SELECT pairing_pin_hash FROM sessions
        WHERE pairing_pin_hash IS NOT NULL AND pairing_expires_at <= now() AND pairing_expires_at > now() - interval '1 day'
          AND status NOT IN ('COMPLETED', 'ABORTED')
       UNION ALL
       SELECT pairing_pin_hash FROM reference_stations
        WHERE pairing_pin_hash IS NOT NULL AND pairing_expires_at <= now() AND pairing_expires_at > now() - interval '1 day' AND closed_at IS NULL`,
    );
    for (const row of expired) if (await verify(row.pairing_pin_hash, pin)) return true;
    return false;
  }

  /** Tablet pairing (FR-TAB-1). Public: the PIN is the credential. */
  app.post('/sessions/pair', async (req, reply) => {
    const ip = req.ip;
    const lock = pairFailures.get(ip);
    if (lock && lock.until > Date.now()) {
      return reply.status(429).send({ error: { code: 'TOO_MANY_ATTEMPTS', message_key: 'kiosk.pin_locked', details: {} } });
    }
    const body = ControlPayloads.PAIRING_REQUEST.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: {} } });

    const open = await rows<{ id: string; pairing_pin_hash: string }>(
      app.deps.db,
      `SELECT id, pairing_pin_hash FROM sessions
        WHERE pairing_pin_hash IS NOT NULL AND pairing_expires_at > now() AND status NOT IN ('COMPLETED', 'ABORTED')`,
    );
    let sessionId: string | undefined;
    for (const row of open) {
      if (await verify(row.pairing_pin_hash, body.data.pin)) {
        sessionId = row.id;
        break;
      }
    }
    if (!sessionId) {
      // A reference station's PIN (Administrator cockpit, reference mode).
      const ref = await pairReferenceStation(app, body.data.pin, body.data, ip);
      if (ref) {
        pairFailures.delete(ip);
        return ref;
      }
      const count = (lock && lock.until <= Date.now() ? 0 : (lock?.count ?? 0)) + 1;
      pairFailures.set(ip, { count: count >= PAIR_MAX_FAILURES ? 0 : count, until: count >= PAIR_MAX_FAILURES ? Date.now() + PAIR_LOCK_MS : 0 });
      // A code that was real but ran out gets its own message, so the evaluator knows to make a new one.
      // Only the latest code of an open session or station counts; nothing about the session is returned.
      const expired = await isExpiredPin(body.data.pin);
      app.appLog.write({
        severity: 'SECURITY', event_type: 'auth.login.failed', client_ip: ip, entity_type: 'tablet',
        message: expired ? 'Tablet pairing failed: expired PIN' : 'Tablet pairing failed: wrong PIN',
        details: { reason: expired ? 'PAIRING_PIN_EXPIRED' : 'PAIRING_PIN', failures: count },
      });
      return reply.status(401).send(expired
        ? { status: 'REJECTED', error: { code: 'PIN_EXPIRED', message_key: 'kiosk.pin_expired', details: {} } }
        : { status: 'REJECTED', error: { code: 'BAD_PIN', message_key: 'kiosk.pin_wrong', details: {} } });
    }
    pairFailures.delete(ip);

    const d = body.data;
    // A new token id: a tablet still holding an older pairing of this session is turned away.
    const tokenId = randomUUID();
    await app.deps.db.query(
      `UPDATE sessions SET status = CASE WHEN status = 'PLANNED' THEN 'PAIRED' ELSE status END,
              css_px_per_mm = $2, device_pixel_ratio = $3, device_model = 'DTH-A116', device_id = $4,
              pairing_pin_hash = NULL, pairing_expires_at = NULL, tablet_token_id = $5
        WHERE id = $1`,
      [sessionId, d.css_px_per_mm, d.device_pixel_ratio, d.device_id ?? null, tokenId],
    );
    const s = (await loadSession(app.deps.db, sessionId))!;
    app.appLog.write({
      severity: 'INFO', event_type: 'session.paired', session_id: s.id, domain_id: s.domain_id, region_id: s.region_id,
      client_ip: ip, entity_type: 'session', entity_id: s.id,
      message: `Tablet paired with session ${s.session_code}`,
      details: { css_px_per_mm: d.css_px_per_mm, device_pixel_ratio: d.device_pixel_ratio, screen_w_mm: d.screen_w_mm, screen_h_mm: d.screen_h_mm },
    });
    app.hub.notifyPeers(s.id);
    return {
      status: 'ACCEPTED',
      session_id: s.id,
      session_code: s.session_code,
      language: s.language_code,
      direction: LANGUAGE_DIRECTION[s.language_code],
      mode: 'SESSION',
      token: app.jwt.sign({ typ: 'tablet', session_id: s.id, tid: tokenId }, { expiresIn: TABLET_TOKEN_TTL }),
    };
  });

  /**
   * Releases the tablet from an unfinished session (Phase 2 QA): the tablet returns to the PIN screen
   * and its token stops working. The session stays open and can be resumed with a new pairing code.
   */
  app.post<{ Params: { id: string } }>('/sessions/:id/release-tablet', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    if (s.status === 'COMPLETED' || s.status === 'ABORTED') {
      return reply.status(409).send({ error: { code: 'SESSION_CLOSED', message_key: 'sessions.closed', details: {} } });
    }
    const result = await app.hub.releaseTablet(s.id, req.user as UserClaims);
    if (result === 'STEP_RUNNING') {
      return reply.status(409).send({ error: { code: 'STEP_RUNNING', message_key: 'sessions.release_step_running', details: {} } });
    }
    return { ok: true };
  });

  /** Closes the session when every step is done or skipped. */
  app.post<{ Params: { id: string } }>('/sessions/:id/complete', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    if (s.status === 'COMPLETED' || s.status === 'ABORTED') {
      return reply.status(409).send({ error: { code: 'SESSION_CLOSED', message_key: 'sessions.closed', details: {} } });
    }
    if (!(await app.hub.completeSession(s.id))) {
      return reply.status(409).send({ error: { code: 'STEPS_LEFT', message_key: 'sessions.steps_left', details: {} } });
    }
    return { ok: true };
  });

  /** Paper notebook page (FR-COCK-4): the evaluator times the page in the cockpit and may add notes. */
  const PaperBody = z.object({ duration_ms: z.number().int().min(0).max(3_600_000), notes: z.string().trim().max(2000).optional() });
  app.post<{ Params: { id: string; index: string } }>('/sessions/:id/steps/:index/paper', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    if (s.status === 'COMPLETED' || s.status === 'ABORTED') {
      return reply.status(409).send({ error: { code: 'SESSION_CLOSED', message_key: 'sessions.closed', details: {} } });
    }
    const body = PaperBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: body.error.flatten() } });
    const user = req.user as UserClaims;
    const index = Number(req.params.index);
    const updated = await one<{ id: string }>(
      app.deps.db,
      `UPDATE session_steps SET status = 'DONE', paper_duration_ms = $3, notes = $4, started_at = coalesce(started_at, now()), completed_at = now()
        WHERE session_id = $1 AND step_index = $2 AND step_type = 'PAPER_NOTEBOOK_PAGE' AND status IN ('PENDING', 'ACTIVE') RETURNING id`,
      [s.id, index, body.data.duration_ms, body.data.notes || null],
    );
    if (!updated) return reply.status(409).send({ error: { code: 'STEP_NOT_PENDING', message_key: 'sessions.step_not_pending', details: {} } });
    await app.deps.db.query(
      "UPDATE sessions SET status = 'IN_PROGRESS', started_at = coalesce(started_at, now()) WHERE id = $1 AND status IN ('PLANNED', 'PAIRED', 'PAUSED')",
      [s.id],
    );
    app.appLog.write({
      severity: 'INFO', event_type: 'session.paper_page.timed', actor_user_id: user.sub, actor_role: user.role, session_id: s.id,
      entity_type: 'session_step', entity_id: updated.id,
      message: `Paper notebook page timed: step ${index}, ${(body.data.duration_ms / 1000).toFixed(1)} s`,
      details: { step_index: index, duration_ms: body.data.duration_ms, has_notes: !!body.data.notes },
    });
    return { ok: true };
  });

  /** The evaluator can skip a pending step, for example a video with no version in the session language (logged). */
  app.patch<{ Params: { id: string; index: string } }>('/sessions/:id/steps/:index', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    const body = z.object({ status: z.literal('SKIPPED') }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: {} } });
    const user = req.user as UserClaims;
    const updated = await one<{ step_type: string }>(
      app.deps.db,
      `UPDATE session_steps SET status = 'SKIPPED', completed_at = now()
        WHERE session_id = $1 AND step_index = $2 AND status = 'PENDING' RETURNING step_type`,
      [s.id, Number(req.params.index)],
    );
    if (!updated) return reply.status(409).send({ error: { code: 'STEP_NOT_PENDING', message_key: 'sessions.step_not_pending', details: {} } });
    app.appLog.write({
      severity: 'INFO', event_type: 'session.step.skipped', actor_user_id: user.sub, actor_role: user.role, session_id: s.id,
      entity_type: 'session_step', entity_id: `${s.id}:${req.params.index}`,
      message: `Step ${req.params.index} (${updated.step_type}) skipped`, details: { step_index: Number(req.params.index) },
    });
    return { ok: true };
  });
};

export function timersFrom(snapshot: SettingsSnapshot) {
  return {
    in_transition_sec: setting(snapshot, 'ilt.timer.in_transition_sec', 20),
    inactivity_sec: setting(snapshot, 'ilt.timer.inactivity_sec', 20),
    inactivity_last_box_sec: setting(snapshot, 'ilt.timer.inactivity_last_box_sec', 30),
    amber_grace_sec: setting(snapshot, 'ilt.timer.amber_grace_sec', 10),
  };
}
