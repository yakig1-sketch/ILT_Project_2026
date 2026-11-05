// Participants (DDD §14). No identity data: study code, grouping and demographics only (DDD §15).
// The school is stored only as a keyed HMAC and the birth date only as month and year (FR-PART-2).
import { createHmac } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserClaims } from '../auth.js';
import { likeAny, one, rows } from '../db.js';

const CreateParticipant = z.object({
  study_code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  domain_id: z.number().int().positive(),
  region_id: z.number().int().positive().nullable().default(null),
  school: z.string().trim().min(1).max(120),
  /** YYYY-MM; not in the future. */
  birth_year_month: z.string().regex(/^(19|20)\d\d-(0[1-9]|1[0-2])$/).refine((v) => v <= new Date().toISOString().slice(0, 7)),
  grade_level: z.enum(['KINDERGARTEN', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6']),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dominant_hand: z.enum(['RIGHT', 'LEFT', 'AMBIDEXTROUS']),
});

const ParticipantFilter = z.object({
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

/** Same school, same code: case, spacing and Unicode form are normalised before hashing. */
export function schoolCodeHmac(key: string, school: string): string {
  const normalised = school.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return createHmac('sha256', key).update(normalised).digest('hex');
}

export const participantRoutes: FastifyPluginAsync = async (app) => {
  const staff = app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN');

  // ?q= narrows the list to study codes containing the text (the cockpit's participant search).
  app.get('/participants', { preHandler: staff }, async (req, reply) => {
    const f = ParticipantFilter.safeParse(req.query);
    if (!f.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: f.error.flatten() } });
    return rows(
      app.deps.db,
      `SELECT id, study_code, domain_id, region_id, grade_level, gender, dominant_hand,
              to_char(birth_year_month, 'YYYY-MM') AS birth_year_month, created_at
         FROM participants WHERE is_active AND ($1::text IS NULL OR study_code ILIKE $1)
        ORDER BY created_at DESC LIMIT $2`,
      [f.data.q ? likeAny(f.data.q) : null, f.data.limit],
    );
  });

  app.post('/participants', { preHandler: staff }, async (req, reply) => {
    const body = CreateParticipant.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: body.error.flatten() } });
    }
    const user = req.user as UserClaims;
    const { school, ...p } = body.data;
    const exists = await one(app.deps.db, 'SELECT 1 FROM participants WHERE study_code = $1', [p.study_code]);
    if (exists) return reply.status(409).send({ error: { code: 'STUDY_CODE_TAKEN', message_key: 'participants.code_taken', details: {} } });
    const created = await one<{ id: string }>(
      app.deps.db,
      `INSERT INTO participants (study_code, domain_id, region_id, school_code_hmac, grade_level, gender, dominant_hand,
         birth_year_month, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [p.study_code, p.domain_id, p.region_id, schoolCodeHmac(app.deps.schoolHmacKey, school), p.grade_level, p.gender,
        p.dominant_hand, `${p.birth_year_month}-01`, user.sub],
    );
    app.appLog.write({
      severity: 'INFO', event_type: 'participants.participant.created', actor_user_id: user.sub, actor_role: user.role,
      domain_id: p.domain_id, region_id: p.region_id, entity_type: 'participant', entity_id: created!.id,
      message: `Participant ${p.study_code} created`, details: { study_code: p.study_code },
    });
    return reply.status(201).send({ id: created!.id, ...p });
  });
};
