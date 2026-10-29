// Sessions: planning, pairing with a 6-digit PIN, and step skipping (DDD §11.1, §14).
import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ControlPayloads, LANGUAGE_DIRECTION, type LanguageCode } from '@ilt/shared-types';
import {
  fillOrderFor,
  type CanvasGeometry,
  type FillDirection,
  type ProtocolStep,
  type ScoringProfile,
} from '@ilt/template-schemas';
import type { Queryable } from '../app-log.js';
import type { UserClaims } from '../auth.js';
import { inTransaction, one, rows } from '../db.js';
import { loadEffectiveSettings, setting, type SettingsSnapshot } from '../settings-store.js';

const PIN_TTL_MINUTES = 10;
const PAIR_MAX_FAILURES = 5;
const PAIR_LOCK_MS = 15 * 60_000;
const TABLET_TOKEN_TTL = '12h';

const CreateSession = z.object({
  participant_id: z.string().uuid(),
  session_type: z.enum(['DAY_1', 'DAY_2', 'DAY_14']),
  language_code: z.enum(['he', 'en']),
  region_id: z.number().int().positive().nullable().optional(),
});

const TEMPLATE_SETTING: Record<z.infer<typeof CreateSession>['session_type'], string> = {
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
  settings_snapshot: SettingsSnapshot;
  created_at: string;
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
  video_key: string | null;
  status: string;
}

export async function loadSession(db: Queryable, id: string): Promise<SessionRow | undefined> {
  return one<SessionRow>(
    db,
    `SELECT s.id, s.session_code, s.participant_id, p.study_code, s.evaluator_id, s.domain_id, s.region_id,
            s.language_code, s.session_type, s.status, s.css_px_per_mm, s.settings_snapshot, s.created_at
       FROM sessions s JOIN participants p ON p.id = s.participant_id WHERE s.id = $1`,
    [id],
  );
}

export async function loadSteps(db: Queryable, sessionId: string): Promise<StepRow[]> {
  return rows<StepRow>(
    db,
    `SELECT st.id, st.step_index, st.step_type, st.label_key, st.block_number, st.is_scored, st.canvas_id,
            c.code AS canvas_code, c.geometry, st.mirrored, st.fill_order, st.video_key, st.status
       FROM session_steps st LEFT JOIN canvases c ON c.id = st.canvas_id
      WHERE st.session_id = $1 ORDER BY st.step_index`,
    [sessionId],
  );
}

/** Session code: S + yymmdd + 4 characters without look-alikes. */
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

  app.get('/sessions', { preHandler: evaluator }, async (req) => {
    const user = req.user as UserClaims;
    return rows(
      app.deps.db,
      `SELECT s.id, s.session_code, p.study_code, s.session_type, s.language_code, s.status, s.created_at
         FROM sessions s JOIN participants p ON p.id = s.participant_id
        WHERE ($1::uuid IS NULL OR s.evaluator_id = $1) ORDER BY s.created_at DESC LIMIT 200`,
      [user.role === 'EVALUATOR' ? user.sub : null],
    );
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', { preHandler: evaluator }, async (req, reply) => {
    const s = await ownSession(req);
    if (!s) return reply.status(404).send(notFound);
    const steps = await loadSteps(app.deps.db, s.id);
    const attempts = await rows(
      app.deps.db,
      `SELECT ba.id, st.step_index, ba.attempt_number, ba.status, ba.sample_count, ba.integrity_ok, ba.started_at, ba.ended_at
         FROM block_attempts ba JOIN session_steps st ON st.id = ba.session_step_id
        WHERE st.session_id = $1 ORDER BY st.step_index, ba.attempt_number`,
      [s.id],
    );
    const { settings_snapshot, ...session } = s;
    return { ...session, timers: timersFrom(settings_snapshot), steps, attempts };
  });

  app.post('/sessions', { preHandler: evaluator }, async (req, reply) => {
    const body = CreateSession.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: body.error.flatten() } });
    }
    const user = req.user as UserClaims;
    const { participant_id, session_type, language_code } = body.data;
    const participant = await one<{ domain_id: number; region_id: number | null; study_code: string }>(
      app.deps.db,
      'SELECT domain_id, region_id, study_code FROM participants WHERE id = $1 AND is_active',
      [participant_id],
    );
    if (!participant) return reply.status(404).send(notFound);
    const regionId = body.data.region_id === undefined ? participant.region_id : body.data.region_id;
    const settings = await loadEffectiveSettings(app.deps.db, participant.domain_id, regionId);

    const templateCode = setting(settings, TEMPLATE_SETTING[session_type], session_type);
    const template = await one<{ id: string; steps: ProtocolStep[] }>(
      app.deps.db,
      'SELECT id, steps FROM protocol_templates WHERE code = $1 AND is_active ORDER BY version DESC LIMIT 1',
      [templateCode],
    );
    if (!template) return reply.status(409).send({ error: { code: 'NO_TEMPLATE', message_key: 'sessions.no_template', details: { templateCode } } });

    const canvasFor = async (role: 'ILT' | 'NOTEBOOK'): Promise<CanvasRow | undefined> => {
      const code = setting(settings, `language.${language_code}.${role === 'ILT' ? 'ilt_canvas' : 'notebook_canvas'}`, '');
      return one<CanvasRow>(
        app.deps.db,
        "SELECT id, code, geometry, default_scoring_profile FROM canvases WHERE code = $1 AND status = 'ACTIVE'",
        [code],
      );
    };
    const canvases = { ILT: await canvasFor('ILT'), NOTEBOOK: await canvasFor('NOTEBOOK') };
    const mirrored = setting(settings, `language.${language_code}.mirrored`, false);
    const fillDirection = setting<FillDirection>(settings, `language.${language_code}.fill_direction`, LANGUAGE_DIRECTION[language_code] === 'rtl' ? 'RTL_ROWS' : 'LTR_ROWS');
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

    const created = await inTransaction(app.deps.db, async (q) => {
      const session = await one<{ id: string; session_code: string }>(
        q,
        `INSERT INTO sessions (session_code, participant_id, evaluator_id, domain_id, region_id, language_code, session_type,
           protocol_template_id, settings_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, session_code`,
        [newSessionCode(), participant_id, user.sub, participant.domain_id, regionId, language_code, session_type,
          template.id, JSON.stringify(settings)],
      );
      for (const [index, st] of steps.entries()) {
        const canvas = st.canvas_role === 'ILT' || st.canvas_role === 'NOTEBOOK' ? canvases[st.canvas_role]! : undefined;
        const profile = canvas?.default_scoring_profile ?? null;
        const fillOrder = canvas ? (profile?.fill_order.length ? profile.fill_order : fillOrderFor(canvas.geometry.boxes, fillDirection)) : null;
        await q.query(
          `INSERT INTO session_steps (session_id, step_index, step_type, label_key, block_number, is_scored, canvas_id,
             mirrored, fill_order, canvas_profile_snapshot, video_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [session!.id, index, st.step_type, st.label_key, st.block_number ?? null, st.is_scored, canvas?.id ?? null,
            canvas ? mirrored : false, fillOrder ? JSON.stringify(fillOrder) : null, profile ? JSON.stringify(profile) : null,
            st.video_key ?? null],
        );
      }
      return session!;
    });

    app.appLog.write({
      severity: 'INFO', event_type: 'session.created', actor_user_id: user.sub, actor_role: user.role,
      domain_id: participant.domain_id, region_id: regionId, session_id: created.id, entity_type: 'session', entity_id: created.id,
      message: `Session ${created.session_code} (${session_type}, ${language_code}) created for ${participant.study_code}`,
      details: { session_type, language_code, template: templateCode, steps: steps.length },
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
      const count = (lock && lock.until <= Date.now() ? 0 : (lock?.count ?? 0)) + 1;
      pairFailures.set(ip, { count: count >= PAIR_MAX_FAILURES ? 0 : count, until: count >= PAIR_MAX_FAILURES ? Date.now() + PAIR_LOCK_MS : 0 });
      app.appLog.write({ severity: 'SECURITY', event_type: 'auth.login.failed', client_ip: ip, entity_type: 'tablet', message: 'Tablet pairing failed: wrong or expired PIN', details: { reason: 'PAIRING_PIN', failures: count } });
      return reply.status(401).send({ status: 'REJECTED', error: { code: 'BAD_PIN', message_key: 'kiosk.pin_wrong', details: {} } });
    }
    pairFailures.delete(ip);

    const d = body.data;
    await app.deps.db.query(
      `UPDATE sessions SET status = CASE WHEN status = 'PLANNED' THEN 'PAIRED' ELSE status END,
              css_px_per_mm = $2, device_pixel_ratio = $3, device_model = 'DTH-A116', device_id = $4,
              pairing_pin_hash = NULL, pairing_expires_at = NULL
        WHERE id = $1`,
      [sessionId, d.css_px_per_mm, d.device_pixel_ratio, d.device_id ?? null],
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
      token: app.jwt.sign({ typ: 'tablet', session_id: s.id }, { expiresIn: TABLET_TOKEN_TTL }),
    };
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

  /** Video and paper steps run in Phase 2; until then the evaluator can skip them (logged). */
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
