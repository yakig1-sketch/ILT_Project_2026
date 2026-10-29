// Applies infra/db/migrations/*.sql in order, each in its own transaction, as the owner role.
// Then sets LOGIN passwords for the service roles from the environment.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadEnv, required } from './env.js';

loadEnv();
const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
const client = new pg.Client({ connectionString: required('DATABASE_URL') });

const quoteLiteral = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main(): Promise<void> {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(`${dir}${file}`, 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('done');
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      throw err;
    }
  }

  // Service roles: passwords come from .env, never from the migrations.
  for (const [role, envName] of [['ilt_app', 'ILT_APP_DB_PASSWORD'], ['ilt_analyst', 'ILT_ANALYST_DB_PASSWORD']] as const) {
    await client.query(`ALTER ROLE ${role} LOGIN PASSWORD ${quoteLiteral(required(envName))}`);
  }
  console.log('Migrations up to date; service roles enabled.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
