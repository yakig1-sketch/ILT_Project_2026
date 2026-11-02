// Creates (or resets) one user account, until the administration screens exist. Used to bootstrap
// the first System Administrator on a production install, where the seed creates no accounts.
// Input comes from the environment so passwords never appear on the command line:
//   ILT_USER_EMAIL, ILT_USER_NAME, ILT_USER_ROLE (ADMIN | RESEARCHER | EVALUATOR | ANALYST),
//   ILT_USER_PASSWORD (at least 12 characters), ILT_USER_PIN (Research Director PIN, 6 digits; RESEARCHER only).
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { loadEnv, required } from './env.js';

loadEnv();
const ROLES = ['ADMIN', 'RESEARCHER', 'EVALUATOR', 'ANALYST'];

async function main(): Promise<void> {
  const email = required('ILT_USER_EMAIL').trim().toLowerCase();
  const name = required('ILT_USER_NAME').trim();
  const role = required('ILT_USER_ROLE').trim().toUpperCase();
  const password = required('ILT_USER_PASSWORD');
  const pin = process.env.ILT_USER_PIN?.trim() || null;
  if (!ROLES.includes(role)) throw new Error(`ILT_USER_ROLE must be one of ${ROLES.join(', ')}`);
  if (password.length < 12) throw new Error('ILT_USER_PASSWORD must have at least 12 characters');
  if (pin !== null && !/^\d{6}$/.test(pin)) throw new Error('ILT_USER_PIN must be 6 digits');
  if (pin !== null && role !== 'RESEARCHER') throw new Error('ILT_USER_PIN is only for the Research Director (role RESEARCHER)');

  const client = new pg.Client({ connectionString: required('DATABASE_URL') });
  await client.connect();
  try {
    const res = await client.query<{ inserted: boolean }>(
      `INSERT INTO users (email, password_hash, full_name, role, director_pin_hash, domain_id)
       VALUES ($1, $2, $3, $4, $5, (SELECT id FROM domains WHERE code = 'GENERAL'))
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name,
         role = EXCLUDED.role, director_pin_hash = EXCLUDED.director_pin_hash, is_active = TRUE,
         failed_logins = 0, locked_until = NULL, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [email, await hash(password), name, role, pin === null ? null : await hash(pin)],
    );
    console.log(`${res.rows[0]!.inserted ? 'Created' : 'Updated'} ${role} account ${email}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
