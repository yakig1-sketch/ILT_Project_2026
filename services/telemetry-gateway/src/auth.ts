// Authentication (DDD §14, §15): JWT access token 15 min + refresh token 8 h. Five failed logins
// lock the account for 15 minutes. Tablets get a session-bound token when they pair.
import jwt from '@fastify/jwt';
import { verify } from '@node-rs/argon2';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import type { Role } from '@ilt/shared-types';
import { one } from './db.js';

export interface UserClaims {
  typ: 'access' | 'refresh';
  sub: string;
  role: Role;
}

export type TokenClaims = UserClaims | { typ: 'tablet'; session_id: string };

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenClaims;
    user: TokenClaims;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

interface UserRow {
  id: string;
  password_hash: string;
  full_name: string;
  role: Role;
  ui_language: string;
  is_active: boolean;
  failed_logins: number;
  locked_until: Date | null;
}

export const authPlugin = fp<{ secret: string }>(async (app, { secret }) => {
  await app.register(jwt, { secret });

  app.decorate('requireRole', (...roles: Role[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message_key: 'error.401', details: {} } });
    }
    const claims = req.user;
    if (claims.typ !== 'access' || (roles.length > 0 && !roles.includes(claims.role))) {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message_key: 'error.403', details: {} } });
    }
  });
});

const issueTokens = (app: Parameters<FastifyPluginAsync>[0], sub: string, role: Role) => ({
  access_token: app.jwt.sign({ typ: 'access', sub, role }, { expiresIn: '15m' }),
  refresh_token: app.jwt.sign({ typ: 'refresh', sub, role }, { expiresIn: '8h' }),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/login', async (req, reply) => {
    const body = LoginBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: { code: 'BAD_REQUEST', message_key: 'error.400', details: {} } });
    const email = body.data.email.toLowerCase();
    const user = await one<UserRow>(
      app.deps.db,
      `SELECT id, password_hash, full_name, role, ui_language, is_active, failed_logins, locked_until
         FROM users WHERE email = $1`,
      [email],
    );
    const fail = (code: string, status = 401) =>
      reply.status(status).send({ error: { code, message_key: `auth.${code.toLowerCase()}`, details: {} } });

    if (!user || !user.is_active) {
      app.appLog.write({ severity: 'SECURITY', event_type: 'auth.login.failed', client_ip: req.ip, message: 'Login failed: unknown or inactive account', details: { reason: 'UNKNOWN' } });
      return fail('INVALID_CREDENTIALS');
    }
    if (user.locked_until && user.locked_until > new Date()) {
      app.appLog.write({ severity: 'SECURITY', event_type: 'auth.login.failed', actor_user_id: user.id, client_ip: req.ip, message: 'Login refused: account locked', details: { reason: 'LOCKED' } });
      return fail('ACCOUNT_LOCKED', 423);
    }
    if (!(await verify(user.password_hash, body.data.password))) {
      const failed = user.failed_logins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await app.deps.db.query(
        `UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END
          WHERE id = $1`,
        [user.id, lock ? 0 : failed, lock, LOCK_MINUTES],
      );
      app.appLog.write({ severity: 'SECURITY', event_type: 'auth.login.failed', actor_user_id: user.id, client_ip: req.ip, message: 'Login failed: wrong password', details: { reason: 'PASSWORD', failed } });
      if (lock) app.appLog.write({ severity: 'SECURITY', event_type: 'auth.account.locked', actor_user_id: user.id, client_ip: req.ip, message: `Account locked for ${LOCK_MINUTES} minutes` });
      return fail('INVALID_CREDENTIALS');
    }
    await app.deps.db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
    app.appLog.write({ severity: 'INFO', event_type: 'auth.login.succeeded', actor_user_id: user.id, actor_role: user.role, client_ip: req.ip, message: 'Login succeeded' });
    return {
      ...issueTokens(app, user.id, user.role),
      user: { id: user.id, full_name: user.full_name, role: user.role, ui_language: user.ui_language },
    };
  });

  app.post('/auth/refresh', async (req, reply) => {
    const token = z.object({ refresh_token: z.string() }).safeParse(req.body);
    try {
      if (!token.success) throw new Error('missing');
      const claims = app.jwt.verify<TokenClaims>(token.data.refresh_token);
      if (claims.typ !== 'refresh') throw new Error('wrong type');
      const user = await one<{ is_active: boolean }>(app.deps.db, 'SELECT is_active FROM users WHERE id = $1', [claims.sub]);
      if (!user?.is_active) throw new Error('inactive');
      return issueTokens(app, claims.sub, claims.role);
    } catch {
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message_key: 'error.401', details: {} } });
    }
  });

  app.post('/auth/logout', { preHandler: app.requireRole() }, async (req) => {
    const claims = req.user as UserClaims;
    app.appLog.write({ severity: 'INFO', event_type: 'auth.logout', actor_user_id: claims.sub, actor_role: claims.role, message: 'Logout' });
    return { ok: true };
  });
};
