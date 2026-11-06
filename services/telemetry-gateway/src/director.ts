// Research Director approval (FR-ROLE-3): a director's email and PIN approve a clinically governed
// change. Shared by the settings and canvas routes; both outcomes are logged.
import { verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { UserClaims } from './auth.js';
import { one } from './db.js';
import { loadEffectiveSettings, setting } from './settings-store.js';

export const GOVERNANCE_KEY = 'governance.require_director_approval';
/** No Domain or Region has this id; resolving with it gives the System value. */
export const NO_GROUP = -1;

/** True when governed changes need a director's PIN (the System governance switch). */
export async function directorApprovalOn(app: FastifyInstance): Promise<boolean> {
  return setting(await loadEffectiveSettings(app.deps.db, NO_GROUP, null), GOVERNANCE_KEY, true);
}

/**
 * Checks the director's email and PIN. Returns the director's user id, or null when the check
 * fails; logs `auth.director_pin.verified` or `auth.director_pin.failed` (never the PIN).
 */
export async function verifyDirector(
  app: FastifyInstance,
  req: FastifyRequest,
  input: { director_email?: string; director_pin?: string },
  subject: { entity_type: string; entity_id: string; what: string; details?: Record<string, unknown> },
): Promise<string | null> {
  const user = req.user as UserClaims;
  const director = input.director_email
    ? await one<{ id: string; director_pin_hash: string | null }>(
      app.deps.db, "SELECT id, director_pin_hash FROM users WHERE email = $1 AND role = 'RESEARCHER' AND is_active", [input.director_email.toLowerCase()],
    )
    : undefined;
  const ok = !!director?.director_pin_hash && !!input.director_pin && (await verify(director.director_pin_hash, input.director_pin));
  app.appLog.write({
    severity: ok ? 'INFO' : 'SECURITY',
    event_type: ok ? 'auth.director_pin.verified' : 'auth.director_pin.failed',
    actor_user_id: user.sub, actor_role: user.role, ...(ok ? {} : { client_ip: req.ip }),
    entity_type: subject.entity_type, entity_id: subject.entity_id,
    message: `Director PIN ${ok ? 'verified' : 'check failed'} for ${subject.what}`,
    details: { ...(ok ? { director_id: director!.id } : {}), ...subject.details },
  });
  return ok ? director!.id : null;
}
