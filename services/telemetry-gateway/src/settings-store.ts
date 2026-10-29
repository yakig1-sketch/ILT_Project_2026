// Loads setting definitions and stored values and resolves them for a domain and region (DDD §6.1).
import { resolveSettings, type ResolvedSetting, type SettingValue, type StoredSettingValue } from '@ilt/shared-types';
import type { Queryable } from './app-log.js';
import { rows } from './db.js';

export type SettingsSnapshot = Record<string, ResolvedSetting>;

export async function loadEffectiveSettings(db: Queryable, domainId: number, regionId: number | null): Promise<SettingsSnapshot> {
  const definitions = await rows<{ key: string; default_value: SettingValue; override_scope: 'NONE' | 'DOMAIN' | 'REGION' }>(
    db,
    'SELECT key, default_value, override_scope FROM setting_definitions',
  );
  const values = await rows<StoredSettingValue>(
    db,
    `SELECT key, scope, domain_id, region_id, value FROM setting_values
      WHERE scope = 'SYSTEM' OR domain_id = $1 OR region_id = $2`,
    [domainId, regionId],
  );
  return resolveSettings(definitions, values, domainId, regionId);
}

/** Reads one value from a snapshot, falling back when the key is missing (older snapshots). */
export function setting<T extends SettingValue>(snapshot: SettingsSnapshot, key: string, fallback: T): T {
  const v = snapshot[key]?.value;
  return v === undefined || v === null ? fallback : (v as T);
}
