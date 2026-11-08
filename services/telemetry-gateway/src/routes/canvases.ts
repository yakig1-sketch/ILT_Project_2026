// Canvas library for the System Administrator (FRS §5, FR-CAN-1…8; DDD §7): canvas sets per
// language and type, versioned canvases (Draft → Active → Retired) with their scoring profile,
// validation before activation, and Domain overrides of the profile.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { DTH_A116, type LogEventType } from '@ilt/shared-types';
import {
  CanvasGeometrySchema, isScoredCanvas, mergeProfile, profilePatch, starterProfile, validateCanvas, validateProfile,
  type CanvasGeometry, type CanvasIssue, type ScoringProfile,
} from '@ilt/template-schemas';
import type { UserClaims } from '../auth.js';
import { inTransaction, one, rows } from '../db.js';
import { directorApprovalOn, verifyDirector } from '../director.js';

const SET_TYPES = ['ILT', 'NOTEBOOK', 'INTERVENTION_LETTERS'] as const;
/** The canvas type each set type holds. */
const CANVAS_TYPE: Record<(typeof SET_TYPES)[number], CanvasGeometry['canvas_type']> = {
  ILT: 'ILT_GRID', NOTEBOOK: 'NOTEBOOK', INTERVENTION_LETTERS: 'INTERVENTION_SHEET',
};
/** Settings whose value is a canvas code (FR-CAN-12). */
const CANVAS_SETTING = /^language\.[a-z]+\.(ilt_canvas|notebook_canvas)$/;

const name = z.string().trim().min(1).max(100);
const Approval = z.object({
  director_email: z.string().email().optional(),
  director_pin: z.string().regex(/^\d{4,8}$/).optional(),
});
const SetBody = z.object({ language_code: z.string().min(2).max(8), set_type: z.enum(SET_TYPES), name_he: name, name_en: name });
const SetPatch = z.object({ name_he: name.optional(), name_en: name.optional(), is_active: z.boolean().optional() });
const CanvasBody = z.object({
  canvas_set_id: z.string().uuid(),
  code: z.string().trim().transform((s) => s.toUpperCase()).pipe(z.string().regex(/^[A-Z0-9_]{2,60}$/)),
  name_he: name,
  name_en: name,
  geometry: z.unknown(),
  profile: z.unknown().optional(),
});
const CanvasPatch = z.object({ name_he: name.optional(), name_en: name.optional(), geometry: z.unknown().optional(), profile: z.unknown().optional() });
const OverrideBody = Approval.and(z.union([z.object({ profile: z.unknown() }), z.object({ reset: z.literal(true) })]));

const bad = (code: string, messageKey: string, details: unknown = {}) => ({ error: { code, message_key: messageKey, details } });
const notFound = bad('NOT_FOUND', 'error.404');
const geometryError = (issues: z.ZodIssue[]) =>
  bad('BAD_GEOMETRY', 'admin.canvases.bad_geometry', { issues: issues.slice(0, 20).map((i) => `${i.path.join('.') || 'geometry'}: ${i.message}`) });

interface CanvasRow {
  id: string;
  canvas_set_id: string;
  code: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  canvas_type: string;
  name_he: string;
  name_en: string;
  geometry: CanvasGeometry;
  default_scoring_profile: ScoringProfile | null;
  language_code: string;
  set_type: (typeof SET_TYPES)[number];
}

const SCREEN = { width_mm: DTH_A116.SCREEN_W_MM, height_mm: DTH_A116.SCREEN_H_MM };

/** Everything that stops a canvas from being activated (FR-CAN-6, FR-CAN-7). */
export function canvasIssues(c: Pick<CanvasRow, 'geometry' | 'default_scoring_profile'>): CanvasIssue[] {
  // validateProfile checks the profile's fill order.
  return [...validateCanvas(c.geometry, SCREEN), ...validateProfile(c.geometry, c.default_scoring_profile)];
}

export const canvasRoutes: FastifyPluginAsync = async (app) => {
  const admin = app.requireRole('ADMIN');
  const db = () => app.deps.db;

  const loadCanvas = (id: string) =>
    one<CanvasRow>(db(),
      `SELECT c.id, c.canvas_set_id, c.code, c.version, c.status, c.canvas_type, c.name_he, c.name_en, c.geometry, c.default_scoring_profile,
              s.language_code, s.set_type
         FROM canvases c JOIN canvas_sets s ON s.id = c.canvas_set_id WHERE c.id = $1`, [id]);
  const uuid = (id: string) => z.string().uuid().safeParse(id).success;
  const log = (req: { user: unknown }, event_type: LogEventType, entity_type: string, entity_id: string, message: string, details: Record<string, unknown> = {}) => {
    const user = req.user as UserClaims;
    app.appLog.write({ severity: 'INFO', event_type, actor_user_id: user.sub, actor_role: user.role, entity_type, entity_id, message, details });
  };
  /** The geometry, checked against the schema and the set's canvas type. */
  const parseGeometry = (raw: unknown, setType: CanvasRow['set_type']) => {
    const g = CanvasGeometrySchema.safeParse(raw);
    if (!g.success) return { error: geometryError(g.error.issues) };
    if (g.data.canvas_type !== CANVAS_TYPE[setType]) {
      return { error: bad('WRONG_CANVAS_TYPE', 'admin.canvases.wrong_type', { expected: CANVAS_TYPE[setType], got: g.data.canvas_type }) };
    }
    return { geometry: g.data };
  };

  // ---- Canvas sets (FR-CAN-1) ----

  /** Every set with all its canvas versions (no geometry), for the library screen. */
  app.get('/canvas-sets', { preHandler: admin }, async () => {
    const sets = await rows<{ id: string } & Record<string, unknown>>(db(),
      `SELECT id, language_code, set_type, name_he, name_en, is_active, sort_order FROM canvas_sets ORDER BY language_code DESC, set_type, sort_order, name_en`);
    const canvases = await rows<{ canvas_set_id: string } & Record<string, unknown>>(db(),
      `SELECT c.id, c.canvas_set_id, c.code, c.version, c.status, c.canvas_type, c.name_he, c.name_en, c.created_at, c.activated_at,
              (SELECT count(*)::int FROM canvas_scoring_overrides o WHERE o.canvas_id = c.id) AS overrides
         FROM canvases c ORDER BY c.code, c.version DESC`);
    return sets.map((s) => ({ ...s, canvases: canvases.filter((c) => c.canvas_set_id === s.id).map(({ canvas_set_id: _s, ...c }) => c) }));
  });

  app.post('/canvas-sets', { preHandler: admin }, async (req, reply) => {
    const body = SetBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400', body.error.flatten()));
    const b = body.data;
    if (!(await one(db(), 'SELECT 1 FROM languages WHERE code = $1', [b.language_code]))) return reply.status(400).send(bad('BAD_LANGUAGE', 'error.400'));
    if (await one(db(), 'SELECT 1 FROM canvas_sets WHERE language_code = $1 AND set_type = $2 AND lower(name_en) = lower($3::text)', [b.language_code, b.set_type, b.name_en])) {
      return reply.status(409).send(bad('NAME_TAKEN', 'admin.canvases.set_name_taken'));
    }
    const user = req.user as UserClaims;
    const created = await one<{ id: string }>(db(),
      `INSERT INTO canvas_sets (language_code, set_type, name_he, name_en, sort_order, created_by)
       VALUES ($1::text, $2::text, $3, $4, (SELECT coalesce(max(sort_order), 0) + 1 FROM canvas_sets WHERE language_code = $1::text AND set_type = $2::text), $5) RETURNING id`,
      [b.language_code, b.set_type, b.name_he, b.name_en, user.sub]);
    log(req, 'canvas.set.created', 'canvas_set', created!.id, `Canvas set ${b.name_en} (${b.language_code}, ${b.set_type}) created`, b);
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { id: string } }>('/canvas-sets/:id', { preHandler: admin }, async (req, reply) => {
    const body = SetPatch.safeParse(req.body);
    if (!body.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400', body.error.flatten()));
    if (!uuid(req.params.id)) return reply.status(404).send(notFound);
    const before = await one<{ name_he: string; name_en: string; is_active: boolean; language_code: string; set_type: string }>(db(),
      'SELECT name_he, name_en, is_active, language_code, set_type FROM canvas_sets WHERE id = $1', [req.params.id]);
    if (!before) return reply.status(404).send(notFound);
    const changed = Object.fromEntries(Object.entries(body.data).filter(([k, v]) => v !== undefined && before[k as keyof typeof before] !== v)
      .map(([k, v]) => [k, { old: before[k as keyof typeof before], new: v }]));
    if (!Object.keys(changed).length) return { changed: 0 };
    if (body.data.name_en && await one(db(),
      'SELECT 1 FROM canvas_sets WHERE language_code = $1 AND set_type = $2 AND lower(name_en) = lower($3::text) AND id <> $4',
      [before.language_code, before.set_type, body.data.name_en, req.params.id])) {
      return reply.status(409).send(bad('NAME_TAKEN', 'admin.canvases.set_name_taken'));
    }
    await db().query(
      `UPDATE canvas_sets SET name_he = coalesce($2, name_he), name_en = coalesce($3, name_en), is_active = coalesce($4, is_active) WHERE id = $1`,
      [req.params.id, body.data.name_he ?? null, body.data.name_en ?? null, body.data.is_active ?? null]);
    log(req, 'canvas.set.updated', 'canvas_set', req.params.id, `Canvas set ${before.name_en} updated`, { changed });
    return { changed: Object.keys(changed).length };
  });

  // ---- Canvases (FR-CAN-2…7) ----

  /** One canvas with its geometry, profile, problems, versions, Domain overrides and the settings that use its code. */
  app.get<{ Params: { id: string } }>('/canvases/:id/detail', { preHandler: admin }, async (req, reply) => {
    if (!uuid(req.params.id)) return reply.status(404).send(notFound);
    const c = await loadCanvas(req.params.id);
    if (!c) return reply.status(404).send(notFound);
    return {
      ...c,
      issues: canvasIssues(c),
      versions: await rows(db(), 'SELECT id, version, status, created_at, activated_at FROM canvases WHERE code = $1 ORDER BY version DESC', [c.code]),
      overrides: await rows(db(),
        `SELECT o.domain_id, d.code AS domain_code, d.name_he AS domain_name_he, d.name_en AS domain_name_en, o.profile_patch, o.set_at,
                su.full_name AS set_by, au.full_name AS approved_by
           FROM canvas_scoring_overrides o JOIN domains d ON d.id = o.domain_id
           JOIN users su ON su.id = o.set_by LEFT JOIN users au ON au.id = o.approved_by
          WHERE o.canvas_id = $1 ORDER BY d.code`, [c.id]),
      used_by: await settingUses(c.code),
      sessions: (await one<{ n: number }>(db(), 'SELECT count(*)::int AS n FROM session_steps WHERE canvas_id = $1', [c.id]))!.n,
      // Reference recordings (FR-CAN-9/10/11): derived values and who recorded and decided; never the raw samples.
      recordings: await rows(db(),
        `SELECT r.id, r.kind, r.domain_id, d.code AS domain_code, r.status, r.derived, r.writer_label, r.rows_recorded, r.sample_count,
                r.recorded_at, r.decided_at, ru.full_name AS recorded_by, du.full_name AS decided_by, au.full_name AS approved_by
           FROM reference_recordings r JOIN users ru ON ru.id = r.recorded_by LEFT JOIN users du ON du.id = r.decided_by
           LEFT JOIN users au ON au.id = r.approved_by LEFT JOIN domains d ON d.id = r.domain_id
          WHERE r.canvas_id = $1 ORDER BY r.recorded_at DESC LIMIT 50`, [c.id]),
    };
  });

  /** Settings at any scope (and catalogue defaults) that name this canvas code. */
  async function settingUses(code: string) {
    const stored = await rows<{ key: string; scope: string; domain_id: number | null; region_id: number | null }>(db(),
      `SELECT key, scope, domain_id, region_id FROM setting_values WHERE value = to_jsonb($1::text) AND key ~ '^language\\.[a-z]+\\.(ilt|notebook)_canvas$'`, [code]);
    const defaults = await rows<{ key: string }>(db(),
      `SELECT key FROM setting_definitions WHERE default_value = to_jsonb($1::text)`, [code]);
    return [...defaults.filter((d) => CANVAS_SETTING.test(d.key)).map((d) => ({ key: d.key, scope: 'DEFAULT', domain_id: null, region_id: null })), ...stored];
  }

  /** Loads a new canvas as a Draft, version 1 of a new code (FR-CAN-2). Without a profile, a starter profile is made. */
  app.post('/canvases', { preHandler: admin }, async (req, reply) => {
    const body = CanvasBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400', body.error.flatten()));
    const b = body.data;
    const set = await one<{ set_type: CanvasRow['set_type']; language_code: string }>(db(), 'SELECT set_type, language_code FROM canvas_sets WHERE id = $1', [b.canvas_set_id]);
    if (!set) return reply.status(404).send(notFound);
    const g = parseGeometry(b.geometry, set.set_type);
    if (g.error) return reply.status(400).send(g.error);
    if (await one(db(), 'SELECT 1 FROM canvases WHERE code = $1', [b.code])) return reply.status(409).send(bad('CODE_TAKEN', 'admin.org.code_taken'));
    const profile = b.profile === undefined ? starterProfile(g.geometry) : b.profile;
    const user = req.user as UserClaims;
    const created = await one<{ id: string }>(db(),
      `INSERT INTO canvases (canvas_set_id, code, version, status, canvas_type, name_he, name_en, geometry, default_scoring_profile, created_by)
       VALUES ($1, $2, 1, 'DRAFT', $3, $4, $5, $6, $7, $8) RETURNING id`,
      [b.canvas_set_id, b.code, g.geometry.canvas_type, b.name_he, b.name_en, JSON.stringify(g.geometry), profile == null ? null : JSON.stringify(profile), user.sub]);
    log(req, 'canvas.uploaded', 'canvas', created!.id, `Canvas ${b.code} v1 loaded as a draft`, { code: b.code, version: 1, language_code: set.language_code });
    return reply.status(201).send(created);
  });

  /** Edits a Draft: names, geometry, profile. An Active or Retired canvas never changes (FR-CAN-3). */
  app.patch<{ Params: { id: string } }>('/canvases/:id', { preHandler: admin }, async (req, reply) => {
    const body = CanvasPatch.safeParse(req.body);
    if (!body.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400', body.error.flatten()));
    if (!uuid(req.params.id)) return reply.status(404).send(notFound);
    const c = await loadCanvas(req.params.id);
    if (!c) return reply.status(404).send(notFound);
    if (c.status !== 'DRAFT') return reply.status(409).send(bad('NOT_DRAFT', 'admin.canvases.not_draft'));
    let geometry = c.geometry;
    if (body.data.geometry !== undefined) {
      const g = parseGeometry(body.data.geometry, c.set_type);
      if (g.error) return reply.status(400).send(g.error);
      geometry = g.geometry;
    }
    const profile = body.data.profile === undefined ? c.default_scoring_profile : body.data.profile;
    await db().query(
      `UPDATE canvases SET name_he = coalesce($2, name_he), name_en = coalesce($3, name_en), geometry = $4, default_scoring_profile = $5 WHERE id = $1`,
      [c.id, body.data.name_he ?? null, body.data.name_en ?? null, JSON.stringify(geometry), profile == null ? null : JSON.stringify(profile)]);
    const fields = Object.keys(body.data).filter((k) => body.data[k as keyof typeof body.data] !== undefined);
    log(req, 'canvas.updated', 'canvas', c.id, `Draft ${c.code} v${c.version} edited (${fields.join(', ')})`, { code: c.code, version: c.version, fields });
    return { issues: canvasIssues({ geometry, default_scoring_profile: profile as ScoringProfile | null }) };
  });

  /** A new Draft version copied from any version of the code; only one Draft per code at a time. */
  app.post<{ Params: { id: string } }>('/canvases/:id/versions', { preHandler: admin }, async (req, reply) => {
    if (!uuid(req.params.id)) return reply.status(404).send(notFound);
    const c = await loadCanvas(req.params.id);
    if (!c) return reply.status(404).send(notFound);
    const draft = await one<{ id: string }>(db(), "SELECT id FROM canvases WHERE code = $1 AND status = 'DRAFT'", [c.code]);
    if (draft) return reply.status(409).send(bad('DRAFT_EXISTS', 'admin.canvases.draft_exists', { id: draft.id }));
    const user = req.user as UserClaims;
    const created = await one<{ id: string; version: number }>(db(),
      `INSERT INTO canvases (canvas_set_id, code, version, status, canvas_type, name_he, name_en, geometry, default_scoring_profile, sort_order, created_by)
       SELECT canvas_set_id, code, (SELECT max(version) + 1 FROM canvases WHERE code = $2), 'DRAFT', canvas_type, name_he, name_en, geometry,
              default_scoring_profile, sort_order, $3
         FROM canvases WHERE id = $1 RETURNING id, version`, [c.id, c.code, user.sub]);
    log(req, 'canvas.version.created', 'canvas', created!.id, `Draft ${c.code} v${created!.version} created from v${c.version}`,
      { code: c.code, version: created!.version, from_version: c.version });
    return reply.status(201).send(created);
  });

  /** Deletes a Draft that no session used. */
  app.delete<{ Params: { id: string } }>('/canvases/:id', { preHandler: admin }, async (req, reply) => {
    if (!uuid(req.params.id)) return reply.status(404).send(notFound);
    const c = await loadCanvas(req.params.id);
    if (!c) return reply.status(404).send(notFound);
    if (c.status !== 'DRAFT') return reply.status(409).send(bad('NOT_DRAFT', 'admin.canvases.not_draft'));
    if (await one(db(), 'SELECT 1 FROM session_steps WHERE canvas_id = $1 LIMIT 1', [c.id])) {
      return reply.status(409).send(bad('CANVAS_USED', 'admin.canvases.used_by_sessions'));
    }
    // Reference recordings keep their raw data and the canvas they were drawn on (FR-CAN-11).
    if (await one(db(), 'SELECT 1 FROM reference_recordings WHERE canvas_id = $1 LIMIT 1', [c.id])) {
      return reply.status(409).send(bad('HAS_RECORDINGS', 'admin.reference.has_recordings'));
    }
    await inTransaction(db(), async (q) => {
      await q.query('DELETE FROM canvas_scoring_overrides WHERE canvas_id = $1', [c.id]);
      await q.query('DELETE FROM canvases WHERE id = $1', [c.id]);
    });
    log(req, 'canvas.deleted', 'canvas', c.id, `Draft ${c.code} v${c.version} deleted`, { code: c.code, version: c.version });
    return { deleted: true };
  });

  /** The problems that stop activation (FR-CAN-6); an empty list means the canvas can be activated. */
  app.post<{ Params: { id: string } }>('/canvases/:id/validate', { preHandler: admin }, async (req, reply) => {
    if (!uuid(req.params.id)) return reply.status(404).send(notFound);
    const c = await loadCanvas(req.params.id);
    if (!c) return reply.status(404).send(notFound);
    const issues = canvasIssues(c);
    log(req, 'canvas.validated', 'canvas', c.id, `${c.code} v${c.version}: ${issues.length ? `${issues.length} problem(s)` : 'valid'}`,
      { code: c.code, version: c.version, issues: issues.map((i) => i.code) });
    return { issues };
  });

  /**
   * Activates a valid Draft. The previous Active version of the code is retired and its Domain
   * overrides carry over. A scored canvas puts a new scoring profile into use, so a Research
   * Director approves it when director approval is on.
   */
  app.post<{ Params: { id: string } }>('/canvases/:id/activate', { preHandler: admin }, async (req, reply) => {
    const body = Approval.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400', body.error.flatten()));
    if (!uuid(req.params.id)) return reply.status(404).send(notFound);
    const c = await loadCanvas(req.params.id);
    if (!c) return reply.status(404).send(notFound);
    if (c.status !== 'DRAFT') return reply.status(409).send(bad('NOT_DRAFT', 'admin.canvases.not_draft'));
    const issues = canvasIssues(c);
    if (issues.length) return reply.status(400).send(bad('CANVAS_INVALID', 'admin.canvases.invalid', { issues }));
    let approvedBy: string | null = null;
    if (isScoredCanvas(c.geometry) && (await directorApprovalOn(app))) {
      approvedBy = await verifyDirector(app, req, body.data, { entity_type: 'canvas', entity_id: c.id, what: `activating ${c.code} v${c.version}` });
      if (!approvedBy) return reply.status(403).send(bad('DIRECTOR_PIN', 'summary.director_pin_failed'));
    }
    const previous = await inTransaction(db(), async (q) => {
      const prev = await one<{ id: string; version: number }>(q, "SELECT id, version FROM canvases WHERE code = $1 AND status = 'ACTIVE'", [c.code]);
      if (prev) {
        await q.query("UPDATE canvases SET status = 'RETIRED' WHERE id = $1", [prev.id]);
        await q.query(
          `INSERT INTO canvas_scoring_overrides (canvas_id, domain_id, profile_patch, set_by, approved_by, set_at)
           SELECT $2, domain_id, profile_patch, set_by, approved_by, set_at FROM canvas_scoring_overrides WHERE canvas_id = $1
           ON CONFLICT (canvas_id, domain_id) DO NOTHING`, [prev.id, c.id]);
      }
      await q.query("UPDATE canvases SET status = 'ACTIVE', activated_at = now() WHERE id = $1", [c.id]);
      return prev;
    });
    log(req, 'canvas.activated', 'canvas', c.id, `${c.code} v${c.version} activated${previous ? `; v${previous.version} retired` : ''}`,
      { code: c.code, version: c.version, retired_version: previous?.version ?? null, approved_by: approvedBy });
    return { activated: true, retired_version: previous?.version ?? null };
  });

  /** Retires the Active version. Refused while a setting still names the code, so new sessions never lose their canvas. */
  app.post<{ Params: { id: string } }>('/canvases/:id/retire', { preHandler: admin }, async (req, reply) => {
    if (!uuid(req.params.id)) return reply.status(404).send(notFound);
    const c = await loadCanvas(req.params.id);
    if (!c) return reply.status(404).send(notFound);
    if (c.status !== 'ACTIVE') return reply.status(409).send(bad('NOT_ACTIVE', 'admin.canvases.not_active'));
    const uses = await settingUses(c.code);
    if (uses.length) return reply.status(409).send(bad('CANVAS_IN_USE', 'admin.canvases.in_use', { uses }));
    await db().query("UPDATE canvases SET status = 'RETIRED' WHERE id = $1", [c.id]);
    log(req, 'canvas.retired', 'canvas', c.id, `${c.code} v${c.version} retired`, { code: c.code, version: c.version });
    return { retired: true };
  });

  // ---- Domain overrides of the scoring profile (FR-CAN-8) ----

  /**
   * Sets a Domain's profile: the body gives the whole profile the Domain should use and only the
   * values that differ from the canvas profile are stored. `reset: true` (or no difference)
   * removes the override. Approved by a Research Director when director approval is on.
   */
  app.put<{ Params: { id: string; domainId: string } }>('/canvases/:id/overrides/:domainId', { preHandler: admin }, async (req, reply) => {
    const body = OverrideBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400', body.error.flatten()));
    const domainId = Number(req.params.domainId);
    if (!uuid(req.params.id) || !Number.isInteger(domainId)) return reply.status(404).send(notFound);
    const c = await loadCanvas(req.params.id);
    const domain = await one<{ code: string }>(db(), 'SELECT code FROM domains WHERE id = $1', [domainId]);
    if (!c || !domain) return reply.status(404).send(notFound);
    if (c.status === 'RETIRED') return reply.status(409).send(bad('RETIRED', 'admin.canvases.retired'));
    if (!isScoredCanvas(c.geometry) || !c.default_scoring_profile) return reply.status(409).send(bad('NOT_SCORED', 'admin.canvases.not_scored'));

    const patch = 'reset' in body.data ? undefined : profilePatch(c.default_scoring_profile, body.data.profile);
    if (patch !== undefined) {
      const issues = validateProfile(c.geometry, mergeProfile(c.default_scoring_profile, patch));
      if (issues.length) return reply.status(400).send(bad('CANVAS_INVALID', 'admin.canvases.invalid', { issues }));
    }
    const before = await one<{ profile_patch: unknown }>(db(), 'SELECT profile_patch FROM canvas_scoring_overrides WHERE canvas_id = $1 AND domain_id = $2', [c.id, domainId]);
    if (JSON.stringify(before?.profile_patch) === JSON.stringify(patch)) return { changed: 0 };

    let approvedBy: string | null = null;
    if (await directorApprovalOn(app)) {
      approvedBy = await verifyDirector(app, req, body.data, { entity_type: 'canvas', entity_id: c.id, what: `the ${domain.code} profile of ${c.code}` });
      if (!approvedBy) return reply.status(403).send(bad('DIRECTOR_PIN', 'summary.director_pin_failed'));
    }
    const user = req.user as UserClaims;
    if (patch === undefined) {
      await db().query('DELETE FROM canvas_scoring_overrides WHERE canvas_id = $1 AND domain_id = $2', [c.id, domainId]);
    } else {
      await db().query(
        `INSERT INTO canvas_scoring_overrides (canvas_id, domain_id, profile_patch, set_by, approved_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (canvas_id, domain_id) DO UPDATE SET profile_patch = EXCLUDED.profile_patch, set_by = EXCLUDED.set_by,
           approved_by = EXCLUDED.approved_by, set_at = now()`,
        [c.id, domainId, JSON.stringify(patch), user.sub, approvedBy]);
    }
    log(req, 'canvas.override.changed', 'canvas', c.id,
      `${c.code} v${c.version} profile for ${domain.code}: ${patch === undefined ? 'follows the canvas' : JSON.stringify(patch)}`,
      { code: c.code, version: c.version, domain_id: domainId, old_patch: before?.profile_patch ?? null, new_patch: patch ?? null, removed: patch === undefined, approved_by: approvedBy });
    return { changed: 1 };
  });
};
