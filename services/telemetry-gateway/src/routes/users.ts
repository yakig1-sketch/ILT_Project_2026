// User management for the System Administrator (FR-ROLE, DDD §14, §15): accounts, roles, the
// Research Director PIN, deactivation, password reset and unlocking. Password and PIN hashes are
// never returned or logged; the log records only that they changed.
import { hash } from '@node-rs/argon2';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ROLES } from '@ilt/shared-types';
import type { UserClaims } from '../auth.js';
import { likeAny, one, rows } from '../db.js';

const MIN_PASSWORD = 12;
const Password = z.string().min(MIN_PASSWORD).max(200);
/** A 6-digit Research Director PIN; null removes it. */
const DirectorPin = z.string().regex(/^\d{6}$/).nullable();

const Create = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  full_name: z.string().trim().min(1).max(100),
  role: z.enum(ROLES),
  ui_language: z.enum(['he', 'en']).default('he'),
  domain_id: z.number().int().positive().nullable().default(null),
  region_id: z.number().int().positive().nullable().default(null),
  password: Password,
  director_pin: DirectorPin.default(null),
});

const Update = z.object({
  full_name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  ui_language: z.enum(['he', 'en']).optional(),
  domain_id: z.number().int().positive().nullable().optional(),
  region_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
  password: Password.optional(),
  director_pin: DirectorPin.optional(),
  /** Clears a lock after failed logins. */
  unlock: z.literal(true).optional(),
});

const Filter = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  active: z.enum(['true', 'false']).optional(),
});

const COLUMNS = `id, email, full_name, role, ui_language, domain_id, region_id, is_active,
  director_pin_hash IS NOT NULL AS has_director_pin, COALESCE(locked_until > now(), false) AS locked, created_at, updated_at`;

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  role: string;
  ui_language: string;
  domain_id: number | null;
  region_id: number | null;
  is_active: boolean;
  has_director_pin: boolean;
  locked: boolean;
}

const error = (code: string, message_key: string, details: unknown = {}) => ({ error: { code, message_key, details } });

export const userRoutes: FastifyPluginAsync = async (app) => {
  const admin = app.requireRole('ADMIN');

  /** 400 unless the Domain and Region exist and are active (null is allowed). */
  const checkGrouping = async (domainId: number | null | undefined, regionId: number | null | undefined) => {
    if (domainId != null && !(await one(app.deps.db, 'SELECT 1 FROM domains WHERE id = $1 AND is_active', [domainId]))) return false;
    if (regionId != null && !(await one(app.deps.db, 'SELECT 1 FROM regions WHERE id = $1 AND is_active', [regionId]))) return false;
    return true;
  };

  app.get('/users', { preHandler: admin }, async (req, reply) => {
    const f = Filter.safeParse(req.query);
    if (!f.success) return reply.status(400).send(error('BAD_REQUEST', 'error.400', f.error.flatten()));
    return rows(
      app.deps.db,
      `SELECT ${COLUMNS} FROM users
        WHERE ($1::text IS NULL OR email ILIKE $1 OR full_name ILIKE $1)
          AND ($2::text IS NULL OR role = $2)
          AND ($3::boolean IS NULL OR is_active = $3)
        ORDER BY is_active DESC, full_name, email`,
      [f.data.q ? likeAny(f.data.q) : null, f.data.role ?? null, f.data.active ? f.data.active === 'true' : null],
    );
  });

  app.post('/users', { preHandler: admin }, async (req, reply) => {
    const body = Create.safeParse(req.body);
    if (!body.success) return reply.status(400).send(error('BAD_REQUEST', 'error.400', body.error.flatten()));
    const u = body.data;
    if (u.director_pin && u.role !== 'RESEARCHER') return reply.status(400).send(error('PIN_NOT_DIRECTOR', 'admin.users.pin_researcher_only'));
    if (!(await checkGrouping(u.domain_id, u.region_id))) return reply.status(400).send(error('BAD_REQUEST', 'error.400', { grouping: 'unknown or inactive' }));
    if (await one(app.deps.db, 'SELECT 1 FROM users WHERE email = $1', [u.email])) {
      return reply.status(409).send(error('EMAIL_TAKEN', 'admin.users.email_taken'));
    }
    const actor = req.user as UserClaims;
    const created = await one<UserRow>(
      app.deps.db,
      `INSERT INTO users (email, password_hash, full_name, role, director_pin_hash, ui_language, domain_id, region_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
      [u.email, await hash(u.password), u.full_name, u.role, u.director_pin ? await hash(u.director_pin) : null, u.ui_language, u.domain_id, u.region_id],
    );
    app.appLog.write({
      severity: 'SECURITY', event_type: 'users.user.created', actor_user_id: actor.sub, actor_role: actor.role,
      entity_type: 'user', entity_id: created!.id, message: `User ${u.email} created as ${u.role}`,
      details: { email: u.email, role: u.role, director_pin: !!u.director_pin },
    });
    return reply.status(201).send(created);
  });

  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: admin }, async (req, reply) => {
    const body = Update.safeParse(req.body);
    if (!body.success || !z.string().uuid().safeParse(req.params.id).success) {
      return reply.status(400).send(error('BAD_REQUEST', 'error.400', body.success ? {} : body.error.flatten()));
    }
    const actor = req.user as UserClaims;
    const before = await one<UserRow>(app.deps.db, `SELECT ${COLUMNS} FROM users WHERE id = $1`, [req.params.id]);
    if (!before) return reply.status(404).send(error('NOT_FOUND', 'error.404'));
    const p = body.data;
    // An administrator can't lock themselves out: no self-deactivation or role change.
    if (before.id === actor.sub && ((p.is_active === false) || (p.role !== undefined && p.role !== 'ADMIN'))) {
      return reply.status(409).send(error('SELF_CHANGE', 'admin.users.self_change'));
    }
    const role = p.role ?? before.role;
    if (p.director_pin && role !== 'RESEARCHER') return reply.status(400).send(error('PIN_NOT_DIRECTOR', 'admin.users.pin_researcher_only'));
    // Only a new Domain or Region must be active; a user may keep one that was deactivated since.
    const newDomain = p.domain_id !== before.domain_id ? p.domain_id : undefined;
    const newRegion = p.region_id !== before.region_id ? p.region_id : undefined;
    if (!(await checkGrouping(newDomain, newRegion))) return reply.status(400).send(error('BAD_REQUEST', 'error.400', { grouping: 'unknown or inactive' }));

    const sets: string[] = [];
    const values: unknown[] = [before.id];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    const changed: Record<string, unknown> = {};
    for (const key of ['full_name', 'role', 'ui_language', 'domain_id', 'region_id', 'is_active'] as const) {
      if (p[key] !== undefined && p[key] !== before[key]) {
        set(key, p[key]);
        changed[key] = { old: before[key], new: p[key] };
      }
    }
    if (p.password) {
      set('password_hash', await hash(p.password));
      changed.password = 'reset';
    }
    // The director PIN belongs to the RESEARCHER role only (database check); a role change drops it.
    const pin = role === 'RESEARCHER' ? p.director_pin : null;
    if (pin || (pin === null && before.has_director_pin)) {
      set('director_pin_hash', pin ? await hash(pin) : null);
      changed.director_pin = pin ? (before.has_director_pin ? 'changed' : 'set') : 'removed';
    }
    if (p.unlock || p.password) {
      sets.push('failed_logins = 0', 'locked_until = NULL');
      if (before.locked) changed.unlocked = true;
    }
    if (Object.keys(changed).length === 0) return before;
    sets.push('updated_at = now()');
    const after = await one<UserRow>(app.deps.db, `UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLUMNS}`, values);

    const deactivated = changed.is_active !== undefined && p.is_active === false;
    app.appLog.write({
      severity: 'SECURITY', event_type: deactivated ? 'users.user.deactivated' : 'users.user.updated',
      actor_user_id: actor.sub, actor_role: actor.role, entity_type: 'user', entity_id: before.id,
      message: `User ${before.email} ${deactivated ? 'deactivated' : 'updated'}`, details: { email: before.email, changed },
    });
    return after;
  });
};
