// Database helpers. The gateway runs as the ilt_app role (append-only on samples and the log).
import type { Queryable } from './app-log.js';

export interface Rows<T> {
  rows: T[];
  rowCount?: number | null;
}

export async function rows<T>(db: Queryable, text: string, values?: unknown[]): Promise<T[]> {
  return ((await db.query(text, values)) as Rows<T>).rows;
}

export async function one<T>(db: Queryable, text: string, values?: unknown[]): Promise<T | undefined> {
  return (await rows<T>(db, text, values))[0];
}

interface PoolLike extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}

/** Runs fn in a transaction when db is a pool; a plain Queryable (tests) runs fn directly. */
export async function inTransaction<T>(db: Queryable, fn: (q: Queryable) => Promise<T>): Promise<T> {
  if (!('connect' in db)) return fn(db);
  const client = await (db as PoolLike).connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
