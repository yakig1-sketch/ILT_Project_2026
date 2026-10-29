import { describe, expect, it } from 'vitest';
import { directionOf, flattenKeys, resources } from './index.js';

describe('translations', () => {
  it('Hebrew and English have exactly the same keys', () => {
    const he = flattenKeys(resources.he.translation).sort();
    const en = flattenKeys(resources.en.translation).sort();
    expect(en).toEqual(he);
  });

  it('no translation is empty', () => {
    for (const lang of ['he', 'en'] as const) {
      const t = resources[lang].translation;
      for (const key of flattenKeys(t)) {
        const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], t);
        expect(value, `${lang}:${key}`).not.toBe('');
      }
    }
  });

  it('Hebrew is right-to-left', () => {
    expect(directionOf('he')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });
});
