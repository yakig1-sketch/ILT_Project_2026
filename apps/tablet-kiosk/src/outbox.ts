// Local buffer of BATCH packets (FR-TAB-6, DDD §5.1). Every packet is kept in IndexedDB until the
// gateway acknowledges it, so a network drop or a page reload loses no data. Falls back to memory
// when IndexedDB is unavailable.
const DB_NAME = 'ilt-kiosk';
const STORE = 'outbox';

export interface OutboxEntry {
  key: string;
  session_id: string;
  step_index: number;
  attempt_number: number;
  sequence: number;
  bytes: Uint8Array;
}

export const outboxKey = (sessionId: string, step: number, attempt: number, sequence: number) =>
  `${sessionId}:${step}:${attempt}:${sequence}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

export class Outbox {
  private readonly memory = new Map<string, OutboxEntry>();
  private db: Promise<IDBDatabase | null>;

  constructor() {
    this.db = openDb().catch(() => null);
  }

  /** Loads entries left from before a reload. */
  async restore(sessionId: string): Promise<void> {
    const db = await this.db;
    if (!db) return;
    const all = await new Promise<OutboxEntry[]>((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as OutboxEntry[]);
      req.onerror = () => resolve([]);
    });
    for (const e of all) if (e.session_id === sessionId) this.memory.set(e.key, e);
  }

  async put(entry: OutboxEntry): Promise<void> {
    this.memory.set(entry.key, entry);
    const db = await this.db;
    if (db) db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry);
  }

  async remove(key: string): Promise<void> {
    this.memory.delete(key);
    const db = await this.db;
    if (db) db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
  }

  /** Unacknowledged entries in send order. */
  pending(sessionId: string, step?: number, attempt?: number): OutboxEntry[] {
    return [...this.memory.values()]
      .filter((e) => e.session_id === sessionId && (step === undefined || (e.step_index === step && e.attempt_number === attempt)))
      .sort((a, b) => a.step_index - b.step_index || a.attempt_number - b.attempt_number || a.sequence - b.sequence);
  }
}
