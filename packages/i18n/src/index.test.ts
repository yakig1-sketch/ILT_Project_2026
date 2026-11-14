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

  it('every count has a Hebrew "two" form', () => {
    // Hebrew plural rules give 2 its own category; without a _two key a count of 2 shows the raw key.
    const keys = new Set(flattenKeys(resources.he.translation));
    const missing = [...keys].filter((k) => k.endsWith('_other') && !keys.has(k.replace(/_other$/, '_two')));
    expect(missing).toEqual([]);
  });

  it('Hebrew is right-to-left', () => {
    expect(directionOf('he')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });
});
