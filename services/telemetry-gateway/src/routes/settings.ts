// Settings (FR-ORG-3…7, FR-CAN-12…14, DDD §6): the System Administrator reads and changes values at
// System level and, where the definition allows it, per Domain or per Region. Changes to clinically
// governed settings need a Research Director's PIN (FR-ROLE-3); every change is kept in
// setting_value_history and the application log. Sessions copy the effective values when created.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { resolveSettings, SETTING_DEFINITIONS, type SettingDefinition, type SettingValue, type StoredSettingValue } from '@ilt/shared-types';
import { fillOrderFor, type CanvasGeometry, type FillDirection } from '@ilt/template-schemas';
import type { UserClaims } from '../auth.js';
import type { Queryable } from '../app-log.js';
import { inTransaction, one, rows } from '../db.js';
import { directorApprovalOn, GOVERNANCE_KEY, NO_GROUP, verifyDirector } from '../director.js';
import { loadEffectiveSettings, setting } from '../settings-store.js';

type Scope = 'SYSTEM' | 'DOMAIN' | 'REGION';
type Definition = Pick<SettingDefinition, 'key' | 'category' | 'value_type' | 'default_value' | 'min_value' | 'max_value' | 'enum_values' | 'unit' | 'override_scope' | 'requires_director_approval' | 'description_he' | 'description_en'>;

const WEIGHTS = ['scoring.composite.weight_speed_pct', 'scoring.composite.weight_accuracy_pct', 'scoring.composite.weight_pen_lifts_pct'];

const Target = z.object({
  scope: z.enum(['SYSTEM', 'DOMAIN', 'REGION']),
  target_id: z.coerce.number().int().positive().optional(),
}).refine((t) => (t.scope === 'SYSTEM') === (t.target_id === undefined), { message: 'target_id is needed for DOMAIN and REGION only' });

/** Either a new `value`, or `reset: true` to remove the value stored at this scope so the inherited one applies. */
const Change = z.object({
  key: z.string().max(100),
  value: z.custom<SettingValue>((v) => v !== undefined).optional(),
  reset: z.literal(true).optional(),
}).refine((c) => (c.value === undefined) !== (c.reset === undefined), { message: 'give either value or reset' });
const Put = Target.and(z.object({
  changes: z.array(Change).min(1).max(100),
  director_email: z.string().email().optional(),
  director_pin: z.string().regex(/^\d{4,8}$/).optional(),
  reason: z.string().trim().max(500).optional(),
}));

const bad = (code: string, messageKey: string, details: unknown = {}) => ({ error: { code, message_key: messageKey, details } });

const loadDefinitions = (db: Queryable) =>
  rows<Definition>(
    db,
    `SELECT key, category, value_type, default_value, min_value::float8 AS min_value, max_value::float8 AS max_value, enum_values, unit,
            override_scope, requires_director_approval, description_he, description_en
       FROM setting_definitions ORDER BY key`,
  );
const loadValues = (db: Queryable) => rows<StoredSettingValue>(db, 'SELECT key, scope, domain_id, region_id, value FROM setting_values');

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const atTarget = (v: StoredSettingValue, scope: Scope, id: number | null) =>
  v.scope === scope && (scope !== 'DOMAIN' || v.domain_id === id) && (scope !== 'REGION' || v.region_id === id);

/** Why a value is not allowed for a definition, or null when it is (references are checked in `checkReferences`). */
function invalid(def: Definition, value: SettingValue): string | null {
  // Settings whose default is null ("not configured", "no letter set") may be set back to null.
  if (value === null) return def.default_value === null ? null : 'type';
  const inRange = (n: number) => (def.min_value == null || n >= def.min_value) && (def.max_value == null || n <= def.max_value);
  switch (def.value_type) {
    case 'integer':
      return typeof value !== 'number' || !Number.isInteger(value) ? 'type' : inRange(value) ? null : 'range';
    case 'decimal':
      return typeof value !== 'number' || !Number.isFinite(value) ? 'type' : inRange(value) ? null : 'range';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'type';
    case 'enum':
      return typeof value === 'string' && (def.enum_values ?? []).includes(value) ? null : 'enum';
    case 'string':
      return typeof value === 'string' && value.length > 0 && value.length <= 100 ? null : 'type';
    case 'uuid':
      return typeof value === 'string' && z.string().uuid().safeParse(value).success ? null : 'type';
    case 'json':
      return value !== null && typeof value === 'object' ? null : 'type';
  }
}

/** Canvas, letter-set, template and language values must name things that exist and are active. */
async function checkReferences(db: Queryable, key: string, value: SettingValue): Promise<boolean> {
  const lang = /^language\.([a-z]{2,8})\.(ilt_canvas|notebook_canvas|letter_set)$/.exec(key);
  if (lang) {
    const [, code, kind] = lang;
    if (kind === 'letter_set') {
      return value === null || !!(await one(db,
        "SELECT 1 FROM canvas_sets WHERE id = $1 AND language_code = $2 AND set_type = 'INTERVENTION_LETTERS' AND is_active", [value, code]));
    }
    return !!(await one(db,
      `SELECT 1 FROM canvases c JOIN canvas_sets s ON s.id = c.canvas_set_id
        WHERE c.code = $1 AND c.status = 'ACTIVE' AND s.language_code = $2 AND c.canvas_type = $3`,
      [value, code, kind === 'ilt_canvas' ? 'ILT_GRID' : 'NOTEBOOK']));
  }
  if (key.startsWith('ilt.protocol.')) {
    return !!(await one(db, 'SELECT 1 FROM protocol_templates WHERE code = $1 AND is_active', [value]));
  }
  if (key === 'language.enabled' || key === 'language.default') {
    const known = (await rows<{ code: string }>(db, 'SELECT code FROM languages WHERE is_enabled')).map((l) => l.code);
    const list = key === 'language.enabled' ? value : [value];
    return Array.isArray(list) && list.length > 0 && new Set(list).size === list.length && list.every((c) => typeof c === 'string' && known.includes(c));
  }
  return true;
}

/** Rules across settings, checked for System and for every Domain that has its own values. */
function checkConsistency(defs: Definition[], values: StoredSettingValue[]): { code: string; message_key: string; details: unknown } | null {
  const domains = [NO_GROUP, ...new Set(values.filter((v) => v.scope === 'DOMAIN').map((v) => v.domain_id!))];
  for (const domainId of domains) {
    const eff = resolveSettings(defs, values, domainId, null);
    const total = WEIGHTS.reduce((sum, k) => sum + Number(eff[k]?.value ?? 0), 0);
    if (Math.abs(total - 100) > 0.001) {
      return { code: 'WEIGHTS_TOTAL', message_key: 'admin.settings.weights_total', details: { total, domain_id: domainId === NO_GROUP ? null : domainId } };
    }
    const enabled = eff['language.enabled']?.value;
    if (Array.isArray(enabled) && !enabled.includes(eff['language.default']?.value as string)) {
      return { code: 'DEFAULT_LANGUAGE', message_key: 'admin.settings.default_language', details: { domain_id: domainId === NO_GROUP ? null : domainId } };
    }
  }
  return null;
}

/**
 * FR-CAN-14: which fill direction a canvas's recorded fill order follows ('OTHER' when neither), or null
 * when it has none. The recorded order wins, so the setup screen warns when it disagrees with the language.
 */
function recordedDirection(geometry: CanvasGeometry, fillOrder: number[] | null): FillDirection | 'OTHER' | null {
  if (!fillOrder?.length) return null;
  const directions: FillDirection[] = ['RTL_ROWS', 'LTR_ROWS'];
  return directions.find((d) => sameValue(fillOrder, fillOrderFor(geometry.boxes, d))) ?? 'OTHER';
}

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const admin = app.requireRole('ADMIN');

  async function targetExists(scope: Scope, id: number | undefined) {
    if (scope === 'SYSTEM') return true;
    return !!(await one(app.deps.db, `SELECT 1 FROM ${scope === 'DOMAIN' ? 'domains' : 'regions'} WHERE id = $1`, [id]));
  }

  /** Definitions and the choices the setup screen offers (canvases, letter sets, templates, languages). */
  const catalogueOrder = new Map(SETTING_DEFINITIONS.map((d, i) => [d.key, i]));
  app.get('/settings/catalogue', { preHandler: admin }, async () => ({
    definitions: (await loadDefinitions(app.deps.db)).sort((a, b) => (catalogueOrder.get(a.key) ?? 999) - (catalogueOrder.get(b.key) ?? 999)),
    languages: await rows(app.deps.db, 'SELECT code, name_native, name_en, direction FROM languages WHERE is_enabled ORDER BY code DESC'),
    canvases: (await rows<{ geometry: CanvasGeometry; fill_order: number[] | null } & Record<string, unknown>>(app.deps.db,
      `SELECT c.code, c.canvas_type, s.language_code, c.name_he, c.name_en, c.geometry, c.default_scoring_profile->'fill_order' AS fill_order
         FROM canvases c JOIN canvas_sets s ON s.id = c.canvas_set_id WHERE c.status = 'ACTIVE' ORDER BY c.sort_order, c.code`))
      .map(({ geometry, fill_order, ...c }) => ({ ...c, recorded_direction: recordedDirection(geometry, fill_order) })),
    letter_sets: await rows(app.deps.db,
      "SELECT id, language_code, name_he, name_en FROM canvas_sets WHERE set_type = 'INTERVENTION_LETTERS' AND is_active ORDER BY sort_order"),
    templates: await rows(app.deps.db,
      'SELECT DISTINCT ON (code) code, session_type, name_he, name_en FROM protocol_templates WHERE is_active ORDER BY code, version DESC'),
  }));

  /**
   * Values at one scope: what is stored there, what applies without it (inherited) and what applies
   * (effective), for each definition that can be set at that scope.
   */
  app.get<{ Querystring: { scope?: string; target_id?: string } }>('/settings/values', { preHandler: admin }, async (req, reply) => {
    const t = Target.safeParse(req.query);
    if (!t.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400', t.error.flatten()));
    const { scope, target_id } = t.data;
    if (!(await targetExists(scope, target_id))) return reply.status(404).send(bad('NOT_FOUND', 'error.404'));
    const id = target_id ?? null;
    const defs = (await loadDefinitions(app.deps.db)).filter((d) => scope === 'SYSTEM' || d.override_scope === scope);
    const values = await loadValues(app.deps.db);
    const at = (domainId: number, regionId: number | null, vals: StoredSettingValue[]) => resolveSettings(defs, vals, domainId, regionId);
    const domainId = scope === 'DOMAIN' ? id! : NO_GROUP;
    const regionId = scope === 'REGION' ? id : null;
    const effective = at(domainId, regionId, values);
    const inherited = at(domainId, regionId, values.filter((v) => !atTarget(v, scope, id)));
    return {
      scope,
      target_id: id,
      values: Object.fromEntries(defs.map((d) => {
        const stored = values.find((v) => v.key === d.key && atTarget(v, scope, id));
        return [d.key, { ...(stored ? { stored: stored.value } : {}), inherited: inherited[d.key], effective: effective[d.key] }];
      })),
    };
  });

  /** Changes several values at one scope together, approved once with the director PIN when needed. */
  app.put('/settings', { preHandler: admin }, async (req, reply) => {
    const body = Put.safeParse(req.body);
    if (!body.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400', body.error.flatten()));
    const { scope, target_id, changes, reason } = body.data;
    const user = req.user as UserClaims;
    if (!(await targetExists(scope, target_id))) return reply.status(404).send(bad('NOT_FOUND', 'error.404'));
    const id = target_id ?? null;

    const defs = await loadDefinitions(app.deps.db);
    const byKey = new Map(defs.map((d) => [d.key, d]));
    const errors: { key: string; reason: string }[] = [];
    for (const { key, value } of changes) {
      const def = byKey.get(key);
      if (!def) errors.push({ key, reason: 'unknown' });
      else if (scope !== 'SYSTEM' && def.override_scope !== scope) errors.push({ key, reason: 'scope' });
      else if (value !== undefined) {
        const why = invalid(def, value) ?? (value === null || (await checkReferences(app.deps.db, key, value)) ? null : 'reference');
        if (why) errors.push({ key, reason: why });
      }
    }
    if (new Set(changes.map((c) => c.key)).size !== changes.length) errors.push({ key: '', reason: 'duplicate' });
    if (errors.length) return reply.status(400).send(bad('INVALID_SETTING', 'admin.settings.invalid', { errors }));

    const before = await loadValues(app.deps.db);
    const stored = (key: string) => before.find((v) => v.key === key && atTarget(v, scope, id));
    const real = changes.filter(({ key, value, reset }) => (reset ? !!stored(key) : !stored(key) || !sameValue(stored(key)!.value, value)));
    if (!real.length) return { changed: 0 };

    const after = [
      ...before.filter((v) => !real.some((c) => c.key === v.key && atTarget(v, scope, id))),
      ...real.filter((c) => !c.reset).map((c) => ({
        key: c.key, scope, domain_id: scope === 'DOMAIN' ? id : null, region_id: scope === 'REGION' ? id : null, value: c.value as SettingValue,
      })),
    ];
    const conflict = checkConsistency(defs, after);
    if (conflict) return reply.status(400).send(bad(conflict.code, conflict.message_key, conflict.details));

    const governed = real.filter((c) => byKey.get(c.key)!.requires_director_approval || c.key === GOVERNANCE_KEY).map((c) => c.key);
    const needsDirector = governed.length > 0 && (governed.includes(GOVERNANCE_KEY) || (await directorApprovalOn(app)));
    const entity = real.length === 1 ? real[0]!.key : `${real.length} settings`;

    let approvedBy: string | null = null;
    if (needsDirector) {
      approvedBy = await verifyDirector(app, req, body.data, { entity_type: 'setting', entity_id: entity, what: governed.join(', '), details: { keys: governed } });
      if (!approvedBy) return reply.status(403).send(bad('DIRECTOR_PIN', 'summary.director_pin_failed', { keys: governed }));
    }

    await inTransaction(app.deps.db, async (q) => {
      for (const { key, value, reset } of real) {
        const where = `key = $1 AND scope = $2 AND domain_id IS NOT DISTINCT FROM $3 AND region_id IS NOT DISTINCT FROM $4`;
        const params = [key, scope, scope === 'DOMAIN' ? id : null, scope === 'REGION' ? id : null];
        if (reset) {
          await q.query(`DELETE FROM setting_values WHERE ${where}`, params);
        } else {
          await q.query(
            `INSERT INTO setting_values (key, scope, domain_id, region_id, value, set_by, approved_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (key, scope, domain_id, region_id) DO UPDATE SET value = EXCLUDED.value, set_by = EXCLUDED.set_by,
               approved_by = EXCLUDED.approved_by, set_at = now()`,
            [...params, JSON.stringify(value), user.sub, approvedBy],
          );
        }
        await q.query(
          `INSERT INTO setting_value_history (key, scope, domain_id, region_id, old_value, new_value, changed_by, approved_by, reason)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [...params, stored(key) ? JSON.stringify(stored(key)!.value) : null, reset ? null : JSON.stringify(value), user.sub, approvedBy, reason ?? null],
        );
      }
    });

    for (const { key, value, reset } of real) {
      const removed = !!reset;
      const old = stored(key)?.value ?? null;
      app.appLog.write({
        severity: 'INFO',
        event_type: scope !== 'SYSTEM' ? 'settings.override.changed' : removed ? 'settings.value.removed' : 'settings.value.changed',
        actor_user_id: user.sub, actor_role: user.role, entity_type: 'setting', entity_id: key,
        message: `${key} at ${scope}${id ? ` ${id}` : ''}: ${JSON.stringify(old)} → ${removed ? 'inherited' : JSON.stringify(value)}`,
        details: { key, scope, domain_id: scope === 'DOMAIN' ? id : null, region_id: scope === 'REGION' ? id : null, old_value: old, new_value: removed ? null : value, removed, approved_by: approvedBy, reason: reason ?? null },
      });
    }
    return { changed: real.length, approved_by: approvedBy };
  });

  /** Change history (FR-ORG-7, DDD §6.1), newest first; optionally for one key or one scope. */
  app.get<{ Querystring: { scope?: string; target_id?: string; key?: string } }>('/settings/history', { preHandler: admin }, async (req, reply) => {
    const t = Target.safeParse(req.query);
    if (req.query.scope && !t.success) return reply.status(400).send(bad('BAD_REQUEST', 'error.400', t.error.flatten()));
    const scope = req.query.scope ? t.data!.scope : null;
    const id = req.query.scope ? (t.data!.target_id ?? null) : null;
    return rows(app.deps.db,
      `SELECT h.id, h.key, h.scope, h.domain_id, h.region_id, h.old_value, h.new_value, h.reason, h.changed_at,
              c.full_name AS changed_by, a.full_name AS approved_by
         FROM setting_value_history h JOIN users c ON c.id = h.changed_by LEFT JOIN users a ON a.id = h.approved_by
        WHERE ($1::text IS NULL OR (h.scope = $1 AND h.domain_id IS NOT DISTINCT FROM (CASE WHEN $1 = 'DOMAIN' THEN $2::int END)
                                                 AND h.region_id IS NOT DISTINCT FROM (CASE WHEN $1 = 'REGION' THEN $2::int END)))
          AND ($3::text IS NULL OR h.key = $3)
        ORDER BY h.id DESC LIMIT 200`,
      [scope, id, req.query.key ?? null]);
  });

  /** The languages a new session for this participant may use, from their Domain's settings (FR-LANG-5). */
  app.get<{ Params: { id: string } }>('/participants/:id/languages', { preHandler: app.requireRole('EVALUATOR', 'RESEARCHER', 'ADMIN') }, async (req, reply) => {
    if (!z.string().uuid().safeParse(req.params.id).success) return reply.status(404).send(bad('NOT_FOUND', 'error.404'));
    const p = await one<{ domain_id: number; region_id: number | null }>(app.deps.db, 'SELECT domain_id, region_id FROM participants WHERE id = $1', [req.params.id]);
    if (!p) return reply.status(404).send(bad('NOT_FOUND', 'error.404'));
    const eff = await loadEffectiveSettings(app.deps.db, p.domain_id, p.region_id);
    return { enabled: setting<string[]>(eff, 'language.enabled', ['he', 'en']), default: setting(eff, 'language.default', 'he') };
  });
};
