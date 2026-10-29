// Block attempts and raw pen samples (DDD §5.1, §9). Samples are idempotent by
// (block_attempt_id, sample_seq): sample_time is derived from the attempt start, so a resent
// batch maps to the same primary key and is ignored.
import { createHash } from 'node:crypto';
import { encodeSampleRecords } from '@ilt/emr-protocol';
import type { PenSample } from '@ilt/shared-types';
import type { Queryable } from './app-log.js';
import { one, rows } from './db.js';

export interface AttemptRef {
  id: string;
  started_at: Date;
}

export async function findAttempt(db: Queryable, sessionId: string, stepIndex: number, attempt: number): Promise<AttemptRef | undefined> {
  return one<AttemptRef>(
    db,
    `SELECT ba.id, ba.started_at FROM block_attempts ba JOIN session_steps st ON st.id = ba.session_step_id
      WHERE st.session_id = $1 AND st.step_index = $2 AND ba.attempt_number = $3`,
    [sessionId, stepIndex, attempt],
  );
}

/** Creates the attempt when the tablet reports STEP_STARTED; returns the existing one on a resend. */
export async function startAttempt(
  db: Queryable,
  sessionId: string,
  stepIndex: number,
  attempt: number,
  startedAt: string,
): Promise<AttemptRef | undefined> {
  await db.query(
    `INSERT INTO block_attempts (session_step_id, attempt_number, status, started_at)
     SELECT id, $3, 'ACTIVE', $4 FROM session_steps WHERE session_id = $1 AND step_index = $2
     ON CONFLICT (session_step_id, attempt_number) DO NOTHING`,
    [sessionId, stepIndex, attempt, startedAt],
  );
  return findAttempt(db, sessionId, stepIndex, attempt);
}

export async function insertSamples(db: Queryable, attempt: AttemptRef, samples: readonly PenSample[]): Promise<void> {
  if (samples.length === 0) return;
  const col = <K extends keyof PenSample>(k: K) => samples.map((s) => s[k]);
  await db.query(
    `INSERT INTO pen_samples (block_attempt_id, sample_seq, sample_time, t_us, x_mm, y_mm, pressure, tilt_x, tilt_y, flags, box_id)
     SELECT $1, u.seq, $2::timestamptz + u.t_us * interval '1 microsecond', u.t_us, u.x, u.y, u.p, u.tx, u.ty, u.f, u.b
       FROM unnest($3::int[], $4::int[], $5::real[], $6::real[], $7::real[], $8::smallint[], $9::smallint[], $10::smallint[], $11::smallint[])
            AS u(seq, t_us, x, y, p, tx, ty, f, b)
     ON CONFLICT DO NOTHING`,
    [attempt.id, attempt.started_at, col('sample_seq'), col('t_us'), col('x_mm'), col('y_mm'), col('pressure'),
      col('tilt_x'), col('tilt_y'), col('flags'), col('box_id')],
  );
}

export async function storedSampleCount(db: Queryable, attemptId: string): Promise<number> {
  const r = await one<{ n: string }>(db, 'SELECT count(*) AS n FROM pen_samples WHERE block_attempt_id = $1', [attemptId]);
  return Number(r?.n ?? 0);
}

export async function loadSamples(db: Queryable, attemptId: string): Promise<PenSample[]> {
  return rows<PenSample>(
    db,
    `SELECT sample_seq, t_us, x_mm, y_mm, pressure, tilt_x, tilt_y, flags, box_id
       FROM pen_samples WHERE block_attempt_id = $1 ORDER BY sample_seq`,
    [attemptId],
  );
}

/** SHA-256 over the 24-byte sample records in sample_seq order (DDD §5.3 BLOCK_COMPLETE). */
export function samplesSha256(samples: readonly PenSample[]): string {
  return createHash('sha256').update(encodeSampleRecords(samples)).digest('hex');
}

const END_STATUS = { LAST_BOX: 'COMPLETED', MANUAL: 'MANUAL_FINISH', TIMEOUT: 'TIMED_OUT' } as const;

/** Closes the attempt and its step once every sample is stored; returns whether the SHA-256 matched. */
export async function finishAttempt(
  db: Queryable,
  attemptId: string,
  complete: { end_reason: keyof typeof END_STATUS; sample_count: number; sha256: string },
): Promise<{ integrity_ok: boolean; stored: number }> {
  const samples = await loadSamples(db, attemptId);
  const integrity_ok = samples.length === complete.sample_count && samplesSha256(samples) === complete.sha256;
  await db.query(
    `UPDATE block_attempts SET status = $2, ended_at = now(), sample_count = $3, sha256 = $4, integrity_ok = $5
      WHERE id = $1`,
    [attemptId, END_STATUS[complete.end_reason], samples.length, complete.sha256, integrity_ok],
  );
  await db.query(
    `UPDATE session_steps SET status = 'DONE', completed_at = now()
      WHERE id = (SELECT session_step_id FROM block_attempts WHERE id = $1)`,
    [attemptId],
  );
  return { integrity_ok, stored: samples.length };
}
