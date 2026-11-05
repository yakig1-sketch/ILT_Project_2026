// Domains and Regions (FR-ORG-1/2, DDD §6.1, §14): two independent ways to group students.
// Everyone signed in reads the active ones; the System Administrator creates, renames and
// deactivates them. Codes never change, because settings and seed scripts refer to them.
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { UserClaims } from '../auth.js';
import { one, rows } from '../db.js';

const KINDS = {
  domains: { table: 'domains', entity: 'domain', label: 'Domain', text: true, created: 'organisation.domain.created', updated: 'organisation.domain.updated' },
  regions: { table: 'regions', entity: 'region', label: 'Region', text: false, created: 'organisation.region.created', updated: 'organisation.region.updated' },
} as const;

const Code = z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,30}$/);
const Name = z.string().trim().min(1).max(100);
const Description = z.string().trim().max(1000).nullable().transform((v) => v || null);

const Create = z.object({
  code: Code,
  name_he: Name,
  name_en: Name,
  description_he: Description.optional(),
  description_en: Description.optional(),
});
const Update = Create.omit({ code: true }).partial().extend({ is_active: z.boolean().optional() });

const bad = (details: unknown) => ({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details } });

export const organisationRoutes: FastifyPluginAsync = async (app) => {
  const admin = app.requireRole('ADMIN');

  for (const [path, kind] of Object.entries(KINDS)) {
    const columns = `id, code, name_he, name_en, ${kind.text ? 'description_he, description_en, ' : ''}is_active, created_at`;

    // ?all=true (administrators only) includes the deactivated ones.
    app.get<{ Querystring: { all?: string } }>(`/${path}`, { preHandler: app.requireRole() }, async (req, reply) => {
      const all = req.query.all === 'true';
      if (all && (req.user as UserClaims).role !== 'ADMIN') {
        return reply.status(403).send({ error: { code: 'FORBIDDEN', message_key: 'error.403', details: {} } });
      }
      return rows(app.deps.db, `SELECT ${columns} FROM ${kind.table} WHERE $1 OR is_active ORDER BY id`, [all]);
    });

    app.post(`/${path}`, { preHandler: admin }, async (req, reply) => {
      const body = Create.safeParse(req.body);
      if (!body.success) return reply.status(400).send(bad(body.error.flatten()));
      if (!kind.text && (body.data.description_he || body.data.description_en)) return reply.status(400).send(bad({ description: 'regions have no description' }));
      const user = req.user as UserClaims;
      const d = body.data;
      if (await one(app.deps.db, `SELECT 1 FROM ${kind.table} WHERE code = $1`, [d.code])) {
        return reply.status(409).send({ error: { code: 'CODE_TAKEN', message_key: 'admin.org.code_taken', details: {} } });
      }
      const created = await one<{ id: number }>(
        app.deps.db,
        kind.text
          ? `INSERT INTO ${kind.table} (code, name_he, name_en, description_he, description_en) VALUES ($1, $2, $3, $4, $5) RETURNING id`
          : `INSERT INTO ${kind.table} (code, name_he, name_en) VALUES ($1, $2, $3) RETURNING id`,
        kind.text ? [d.code, d.name_he, d.name_en, d.description_he ?? null, d.description_en ?? null] : [d.code, d.name_he, d.name_en],
      );
      app.appLog.write({
        severity: 'INFO', event_type: kind.created, actor_user_id: user.sub, actor_role: user.role,
        entity_type: kind.entity, entity_id: String(created!.id), message: `${kind.label} ${d.code} created`,
        details: { code: d.code, name_he: d.name_he, name_en: d.name_en },
      });
      return reply.status(201).send(await one(app.deps.db, `SELECT ${columns} FROM ${kind.table} WHERE id = $1`, [created!.id]));
    });

    app.patch<{ Params: { id: string } }>(`/${path}/:id`, { preHandler: admin }, async (req, reply) => {
      const id = Number(req.params.id);
      const body = Update.safeParse(req.body);
      if (!Number.isInteger(id) || !body.success) return reply.status(400).send(bad(body.success ? {} : body.error.flatten()));
      const changes = Object.entries(body.data).filter(([, v]) => v !== undefined);
      if (!kind.text && changes.some(([k]) => k.startsWith('description'))) return reply.status(400).send(bad({ description: 'regions have no description' }));
      const user = req.user as UserClaims;
      const before = await one<Record<string, unknown>>(app.deps.db, `SELECT ${columns} FROM ${kind.table} WHERE id = $1`, [id]);
      if (!before) return reply.status(404).send({ error: { code: 'NOT_FOUND', message_key: 'error.404', details: {} } });
      // Every participant needs a Domain, so the last active one stays.
      if (kind.entity === 'domain' && body.data.is_active === false && before.is_active) {
        const others = await one<{ n: number }>(app.deps.db, 'SELECT count(*)::int AS n FROM domains WHERE is_active AND id <> $1', [id]);
        if (!others?.n) return reply.status(409).send({ error: { code: 'LAST_DOMAIN', message_key: 'admin.org.last_domain', details: {} } });
      }
      if (changes.length === 0) return before;
      const after = await one<Record<string, unknown>>(
        app.deps.db,
        `UPDATE ${kind.table} SET ${changes.map(([k], i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING ${columns}`,
        [id, ...changes.map(([, v]) => v)],
      );
      const changed = Object.fromEntries(changes.filter(([k, v]) => before[k] !== v).map(([k, v]) => [k, { old: before[k], new: v }]));
      app.appLog.write({
        severity: 'INFO', event_type: kind.updated, actor_user_id: user.sub, actor_role: user.role,
        entity_type: kind.entity, entity_id: String(id),
        message: `${kind.label} ${String(before.code)} updated`, details: { code: before.code, changed },
      });
      return after;
    });
  }
};
