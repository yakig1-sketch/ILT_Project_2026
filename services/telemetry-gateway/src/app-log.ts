// Application log writer (DDD §12): one JSON line to stdout (via the Fastify/pino logger) and one
// row in app_events. Database writes are batched and flushed at most every second.
import type { FastifyBaseLogger } from 'fastify';
import type { AppEvent } from '@ilt/shared-types';

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

const COLUMNS = [
  'severity', 'event_type', 'actor_user_id', 'actor_role', 'device_id', 'domain_id', 'region_id',
  'session_id', 'entity_type', 'entity_id', 'correlation_id', 'client_ip', 'message', 'details',
] as const;

export class AppLog {
  private queue: AppEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Queryable,
    private readonly logger: FastifyBaseLogger,
    private readonly flushMs = 1000,
  ) {}

  write(event: AppEvent): void {
    const level = event.severity === 'ERROR' ? 'error' : event.severity === 'WARN' || event.severity === 'SECURITY' ? 'warn' : 'info';
    this.logger[level]({ app_event: event }, event.message);
    this.queue.push(event);
    this.timer ??= setTimeout(() => void this.flush(), this.flushMs);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.queue.splice(0);
    if (batch.length === 0) return;
    const values: unknown[] = [];
    const rows = batch.map((e, i) => {
      const row = { ...e, details: JSON.stringify(e.details ?? {}) } as Record<string, unknown>;
      COLUMNS.forEach((c) => values.push(row[c] ?? null));
      return `(${COLUMNS.map((_, j) => `$${i * COLUMNS.length + j + 1}`).join(', ')})`;
    });
    try {
      await this.db.query(`INSERT INTO app_events (${COLUMNS.join(', ')}) VALUES ${rows.join(', ')}`, values);
    } catch (err) {
      // Never lose the event silently: it is already on stdout; report the database failure too.
      this.logger.error({ err, lost_events: batch.length }, 'Failed to write app_events');
    }
  }
}
