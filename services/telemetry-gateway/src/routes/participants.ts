// Participants (DDD §14). No identity data: study code, grouping and demographics only (DDD §15).
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserClaims } from '../auth.js';
import { one, rows } from '../db.js';

const CreateParticipant = z.object({
  study_code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  domain_id: z.number().int().positive(),
  region_id: z.number().int().positive().nullable().default(null),
  grade_level: z.enum(['KINDERGARTEN', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6']),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dominant_hand: z.enum(['RIGHT', 'LEFT', 'AMBIDEXTROUS']),
});

export const participantRoutes: FastifyPluginAsync = async (app) => {
  const staff = app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN');

  app.get('/domains', { preHandler: app.requireRole() }, async () =>
    rows(app.deps.db, 'SELECT id, code, name_he, name_en FROM domains WHERE is_active ORDER BY id'),
  );
  app.get('/regions', { preHandler: app.requireRole() }, async () =>
    rows(app.deps.db, 'SELECT id, code, name_he, name_en FROM regions WHERE is_active ORDER BY id'),
  );

  app.get('/participants', { preHandler: staff }, async () =>
    rows(
      app.deps.db,
      `SELECT id, study_code, domain_id, region_id, grade_level, gender, dominant_hand, created_at
         FROM participants WHERE is_active ORDER BY created_at DESC LIMIT 500`,
    ),
  );

  app.post('/participants', { preHandler: staff }, async (req, reply) => {
    const body = CreateParticipant.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: body.error.flatten() } });
    }
    const user = req.user as UserClaims;
    const p = body.data;
    const exists = await one(app.deps.db, 'SELECT 1 FROM participants WHERE study_code = $1', [p.study_code]);
    if (exists) return reply.status(409).send({ error: { code: 'STUDY_CODE_TAKEN', message_key: 'participants.code_taken', details: {} } });
    const created = await one<{ id: string }>(
      app.deps.db,
      `INSERT INTO participants (study_code, domain_id, region_id, grade_level, gender, dominant_hand, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [p.study_code, p.domain_id, p.region_id, p.grade_level, p.gender, p.dominant_hand, user.sub],
    );
    app.appLog.write({
      severity: 'INFO', event_type: 'participants.participant.created', actor_user_id: user.sub, actor_role: user.role,
      domain_id: p.domain_id, region_id: p.region_id, entity_type: 'participant', entity_id: created!.id,
      message: `Participant ${p.study_code} created`, details: { study_code: p.study_code },
    });
    return reply.status(201).send({ id: created!.id, ...p });
  });
};
