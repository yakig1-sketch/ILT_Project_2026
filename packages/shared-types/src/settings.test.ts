import { describe, expect, it } from 'vitest';
import { resolveSettings, type StoredSettingValue } from './settings.js';

const defs = [
  { key: 'scoring.x', default_value: 1, override_scope: 'DOMAIN' as const },
  { key: 'ilt.timer.y', default_value: 20, override_scope: 'REGION' as const },
  { key: 'log.z', default_value: 5, override_scope: 'NONE' as const },
];
const v = (key: string, scope: StoredSettingValue['scope'], value: number, domain_id: number | null = null, region_id: number | null = null): StoredSettingValue => ({
  key, scope, value, domain_id, region_id,
});

describe('settings resolution (DDD §6.1)', () => {
  it('uses the default when nothing is stored', () => {
    const r = resolveSettings(defs, [], 1, null);
    expect(r['scoring.x']).toEqual({ value: 1, source: 'DEFAULT' });
    expect(r['ilt.timer.y']).toEqual({ value: 20, source: 'DEFAULT' });
  });

  it('a system value replaces the default', () => {
    const r = resolveSettings(defs, [v('scoring.x', 'SYSTEM', 2), v('log.z', 'SYSTEM', 9)], 1, null);
    expect(r['scoring.x']).toEqual({ value: 2, source: 'SYSTEM' });
    expect(r['log.z']).toEqual({ value: 9, source: 'SYSTEM' });
  });

  it('a domain value wins for a domain-scoped setting, only in that domain', () => {
    const values = [v('scoring.x', 'SYSTEM', 2), v('scoring.x', 'DOMAIN', 3, 7)];
    expect(resolveSettings(defs, values, 7, null)['scoring.x']).toEqual({ value: 3, source: 'DOMAIN' });
    expect(resolveSettings(defs, values, 8, null)['scoring.x']).toEqual({ value: 2, source: 'SYSTEM' });
  });

  it('a region value wins for a region-scoped setting, only when the session has that region', () => {
    const values = [v('ilt.timer.y', 'REGION', 30, null, 4)];
    expect(resolveSettings(defs, values, 1, 4)['ilt.timer.y']).toEqual({ value: 30, source: 'REGION' });
    expect(resolveSettings(defs, values, 1, 5)['ilt.timer.y']).toEqual({ value: 20, source: 'DEFAULT' });
    expect(resolveSettings(defs, values, 1, null)['ilt.timer.y']).toEqual({ value: 20, source: 'DEFAULT' });
  });

  it('ignores a value stored at a scope the definition does not allow', () => {
    // The database trigger rejects these; resolution must not use one either.
    const values = [v('scoring.x', 'REGION', 9, null, 4), v('ilt.timer.y', 'DOMAIN', 9, 1), v('log.z', 'DOMAIN', 9, 1)];
    const r = resolveSettings(defs, values, 1, 4);
    expect(r['scoring.x']!.source).toBe('DEFAULT');
    expect(r['ilt.timer.y']!.source).toBe('DEFAULT');
    expect(r['log.z']!.source).toBe('DEFAULT');
  });
});
