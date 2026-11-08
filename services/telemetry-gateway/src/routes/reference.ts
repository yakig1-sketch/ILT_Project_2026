// Reference mode for the System Administrator (FR-CAN-6/9/10/11, FR-TAB-8; DDD §7.3, §14): a
// reference station pairs a tablet with a 6-digit PIN; on it the administrator shows canvases at
// true size and records the sample block and the normal speed. The recording runs over the hub
// (REFERENCE_START); [Accept] and [Clear] are these routes, so a Domain profile can carry the
// Research Director's approval.
import { randomInt, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LANGUAGES, type ControlPayload } from '@ilt/shared-types';
import { mergeProfile, profilePatch, validateProfile, type CanvasGeometry, type ScoringProfile } from '@ilt/template-schemas';
import type { UserClaims } from '../auth.js';
import { inTransaction, one, rows } from '../db.js';
import { directorApprovalOn, verifyDirector } from '../director.js';
import { profileValues, type RecordingKind } from '../reference-store.js';

const PIN_TTL_MINUTES = 10;
const TABLET_TOKEN_TTL = '12h';

const bad = (code: string, messageKey: string, details: unknown = {}) => ({ error: { code, message_key: messageKey, details } });
const notFound = bad('NOT_FOUND', 'error.404');
const isUuid = (id: string) => z.string().uuid().safeParse(id).success;
const Approval = z.object({ director_email: z.string().email().optional(), director_pin: z.string().regex(/^\d{4,8}$/).optional() });

/**
 * Tablet pairing with a reference station's PIN (called by POST /sessions/pair when no session
 * holds the PIN). Returns the pairing response, or null when no open station matches.
 */
export async function pairReferenceStation(
  app: FastifyInstance, pin: string, d: ControlPayload<'PAIRING_REQUEST'>, ip: string,
): Promise<Record<string, unknown> | null> {
  const open = await rows<{ id: string; pairing_pin_hash: string; language_code: string; created_by: string }>(app.deps.db,
    `SELECT id, pairing_pin_hash, language_code, created_by FROM reference_stations
      WHERE pairing_pin_hash IS NOT NULL AND pairing_expires_at > now() AND closed_at IS NULL`);
  let station: (typeof open)[number] | undefined;
  for (const row of open) {
    if (await verify(row.pairing_pin_hash, pin)) {
      station = row;
      break;
    }
  }
  if (!station) return null;
  const tokenId = randomUUID();
  await app.deps.db.query(
    `UPDATE reference_stations SET pairing_pin_hash = NULL, pairing_expires_at = NULL, tablet_token_id = $2,
            css_px_per_mm = $3, device_pixel_ratio = $4, paired_at = now() WHERE id = $1`,
    [station.id, tokenId, d.css_px_per_mm, d.device_pixel_ratio]);
  app.appLog.write({
    severity: 'INFO', event_type: 'canvas.reference.paired', actor_user_id: station.created_by, actor_role: 'ADMIN', client_ip: ip,
    entity_type: 'reference_station', entity_id: station.id, message: 'Tablet paired in reference mode',
    details: { css_px_per_mm: d.css_px_per_mm, device_pixel_ratio: d.device_pixel_ratio, screen_w_mm: d.screen_w_mm, screen_h_mm: d.screen_h_mm },
  });
  app.hub.notifyPeers(station.id);
  return {
    status: 'ACCEPTED',
    session_id: station.id,
    session_code: 'REF',
    language: station.language_code,
    mode: 'REFERENCE',
    token: app.jwt.sign({ typ: 'tablet', session_id: station.id, tid: tokenId, ref: true }, { expiresIn: TABLET_TOKEN_TTL }),
  };
}

export const referenceRoutes: FastifyPluginAsync = async (app) => {
  const admin = app.requireRole('ADMIN');
  const db = () => app.deps.db;
  const ownStation = (req: { params: { id: string }; user: unknown }) =>
    isUuid(req.params.id)
      ? one<{ id: string; tablet_token_id: string | null; css_px_per_mm: string | null; language_code: string }>(db(),
        'SELECT id, tablet_token_id, css_px_per_mm, language_code FROM reference_stations WHERE id = $1 AND created_by = $2 AND closed_at IS NULL',
        [req.params.id, (req.user as UserClaims).sub])
      : Promise.resolve(undefined);

  /** Opens a reference station with a pairing PIN (valid 10 minutes, stored only as a hash). */
  app.post('/reference/stations', { preHandler: admin }, async (req, reply) => {
    const body = z.object({ language_code: z.enum(LANGUAGES).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400'));
    const user = req.user as UserClaims;
    const lang = body.data.language_code
      ?? (await one<{ ui_language: string }>(db(), 'SELECT ui_language FROM users WHERE id = $1', [user.sub]))?.ui_language ?? 'he';
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + PIN_TTL_MINUTES * 60_000);
    const s = await one<{ id: string }>(db(),
      `INSERT INTO reference_stations (created_by, language_code, pairing_pin_hash, pairing_expires_at) VALUES ($1, $2, $3, $4) RETURNING id`,
      [user.sub, lang, await hash(pin), expiresAt]);
    return reply.status(201).send({ id: s!.id, pin, expires_at: expiresAt.toISOString() });
  });

  /** A new PIN for the station (pair again, or another tablet in place of the first). */
  app.post<{ Params: { id: string } }>('/reference/stations/:id/pin', { preHandler: admin }, async (req, reply) => {
    const s = await ownStation(req);
    if (!s) return reply.status(404).send(notFound);
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(Date.now() + PIN_TTL_MINUTES * 60_000);
    await db().query('UPDATE reference_stations SET pairing_pin_hash = $2, pairing_expires_at = $3 WHERE id = $1', [s.id, await hash(pin), expiresAt]);
    return { pin, expires_at: expiresAt.toISOString() };
  });

  app.get<{ Params: { id: string } }>('/reference/stations/:id', { preHandler: admin }, async (req, reply) => {
    const s = await ownStation(req);
    if (!s) return reply.status(404).send(notFound);
    return { id: s.id, paired: !!s.tablet_token_id, css_px_per_mm: s.css_px_per_mm === null ? null : Number(s.css_px_per_mm), language_code: s.language_code };
  });

  /** Closes the station: the tablet's token stops working and it returns to the PIN screen. */
  app.delete<{ Params: { id: string } }>('/reference/stations/:id', { preHandler: admin }, async (req, reply) => {
    const s = await ownStation(req);
    if (!s) return reply.status(404).send(notFound);
    await db().query('UPDATE reference_stations SET closed_at = now(), tablet_token_id = NULL, pairing_pin_hash = NULL WHERE id = $1', [s.id]);
    app.hub.closeReferenceStation(s.id);
    return { closed: true };
  });

  /** One recording with its derived values (no raw samples). */
  const loadRecording = (id: string) =>
    one<{ id: string; canvas_id: string; kind: RecordingKind; domain_id: number | null; status: string; derived: Record<string, unknown> }>(db(),
      'SELECT id, canvas_id, kind, domain_id, status, derived FROM reference_recordings WHERE id = $1', [id]);

  /**
   * [Accept] (FR-CAN-9/10): the derived values go into the profile the recording was made for. The
   * canvas's own profile changes only in a Draft (activation then needs the director's approval);
   * a Domain's profile is an override and needs the director's PIN now, as any override does.
   */
  app.post<{ Params: { id: string } }>('/reference-recordings/:id/accept', { preHandler: admin }, async (req, reply) => {
    if (!isUuid(req.params.id)) return reply.status(404).send(notFound);
    const body = Approval.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400'));
    const rec = await loadRecording(req.params.id);
    if (!rec) return reply.status(404).send(notFound);
    if (rec.status !== 'PENDING') return reply.status(409).send(bad('NOT_PENDING', 'admin.reference.not_pending'));
    const values = profileValues(rec.kind, rec.derived);
    if (!values) return reply.status(409).send(bad('INCOMPLETE', 'admin.reference.incomplete'));
    const c = await one<{ id: string; code: string; version: number; status: string; geometry: CanvasGeometry; default_scoring_profile: ScoringProfile | null }>(db(),
      'SELECT id, code, version, status, geometry, default_scoring_profile FROM canvases WHERE id = $1', [rec.canvas_id]);
    if (!c?.default_scoring_profile) return reply.status(409).send(bad('NOT_SCORED', 'admin.canvases.not_scored'));
    if (c.status === 'RETIRED') return reply.status(409).send(bad('RETIRED', 'admin.canvases.retired'));
    if (rec.domain_id === null && c.status !== 'DRAFT') return reply.status(409).send(bad('NOT_DRAFT', 'admin.reference.not_draft'));

    const user = req.user as UserClaims;
    let approvedBy: string | null = null;
    let domainCode: string | null = null;
    if (rec.domain_id !== null) {
      domainCode = (await one<{ code: string }>(db(), 'SELECT code FROM domains WHERE id = $1', [rec.domain_id]))?.code ?? null;
      if (await directorApprovalOn(app)) {
        approvedBy = await verifyDirector(app, req, body.data, { entity_type: 'canvas', entity_id: c.id, what: `the ${domainCode} profile of ${c.code} (reference recording)` });
        if (!approvedBy) return reply.status(403).send(bad('DIRECTOR_PIN', 'summary.director_pin_failed'));
      }
    }

    const result = await inTransaction(db(), async (q) => {
      if (rec.domain_id === null) {
        const next = { ...c.default_scoring_profile!, ...values };
        const issues = validateProfile(c.geometry, next);
        if (issues.length) return { issues };
        await q.query('UPDATE canvases SET default_scoring_profile = $2 WHERE id = $1', [c.id, JSON.stringify(next)]);
        return { before: c.default_scoring_profile, after: next };
      }
      const old = await one<{ profile_patch: unknown }>(q, 'SELECT profile_patch FROM canvas_scoring_overrides WHERE canvas_id = $1 AND domain_id = $2', [c.id, rec.domain_id]);
      const merged = { ...mergeProfile(c.default_scoring_profile!, old?.profile_patch ?? {}), ...values };
      const issues = validateProfile(c.geometry, merged);
      if (issues.length) return { issues };
      const patch = profilePatch(c.default_scoring_profile, merged) ?? {};
      await q.query(
        `INSERT INTO canvas_scoring_overrides (canvas_id, domain_id, profile_patch, set_by, approved_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (canvas_id, domain_id) DO UPDATE SET profile_patch = EXCLUDED.profile_patch, set_by = EXCLUDED.set_by,
           approved_by = EXCLUDED.approved_by, set_at = now()`,
        [c.id, rec.domain_id, JSON.stringify(patch), user.sub, approvedBy]);
      return { before: old?.profile_patch ?? null, after: patch };
    });
    if ('issues' in result) return reply.status(400).send(bad('CANVAS_INVALID', 'admin.canvases.invalid', { issues: result.issues }));
    await db().query(
      "UPDATE reference_recordings SET status = 'ACCEPTED', decided_at = now(), decided_by = $2, approved_by = $3 WHERE id = $1",
      [rec.id, user.sub, approvedBy]);
    const target = domainCode ? `the ${domainCode} profile` : 'the canvas profile';
    app.appLog.write({
      severity: 'INFO', event_type: 'canvas.reference.accepted', actor_user_id: user.sub, actor_role: user.role,
      entity_type: 'reference_recording', entity_id: rec.id,
      message: `${rec.kind === 'SAMPLE_BLOCK_FILL' ? 'Sample block' : 'Normal speed'} accepted into ${target} of ${c.code} v${c.version}: ${JSON.stringify(values)}`,
      details: { canvas_id: c.id, code: c.code, version: c.version, domain_id: rec.domain_id, values, old: result.before, new: result.after, approved_by: approvedBy },
    });
    return { accepted: true, values };
  });

  /** [Clear]: the recording is kept for audit (CLEARED) and never used. */
  app.post<{ Params: { id: string } }>('/reference-recordings/:id/clear', { preHandler: admin }, async (req, reply) => {
    if (!isUuid(req.params.id)) return reply.status(404).send(notFound);
    const rec = await loadRecording(req.params.id);
    if (!rec) return reply.status(404).send(notFound);
    if (rec.status !== 'PENDING') return reply.status(409).send(bad('NOT_PENDING', 'admin.reference.not_pending'));
    const user = req.user as UserClaims;
    await db().query("UPDATE reference_recordings SET status = 'CLEARED', decided_at = now(), decided_by = $2 WHERE id = $1", [rec.id, user.sub]);
    app.appLog.write({
      severity: 'INFO', event_type: 'canvas.reference.cleared', actor_user_id: user.sub, actor_role: user.role,
      entity_type: 'reference_recording', entity_id: rec.id, message: `Reference recording cleared (${rec.kind})`, details: { canvas_id: rec.canvas_id, kind: rec.kind },
    });
    return { cleared: true };
  });
};
