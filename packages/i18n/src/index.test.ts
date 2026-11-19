import { describe, expect, it } from 'vitest';
import { directionOf, flattenKeys, resources } from './index.js';

describe('translations', () => {
  it('Hebrew and English have exactly the same keys', () => {
    const he = flattenKeys(resources.he.translation).sort();
    const en = flattenKeys(resources.en.translation).sort();
    expect(en).toEqual(he);
  });

  it('Japanese has the same keys, and translates every text the child sees on the tablet (Phase 6b″)', () => {
    expect(flattenKeys(resources.ja.translation).sort()).toEqual(flattenKeys(resources.he.translation).sort());
    const childFacing = ['waiting', 'get_ready', 'paused', 'uploading', 'session_done', 'task_title', 'block_of', 'warmup_of',
      'page_of', 'sheet_of', 'next_block', 'next_page', 'pen_down_note', 'video_loading', 'video_failed', 'tap_to_play', 'enter_pin', 'connect'] as const;
    for (const k of childFacing) expect(resources.ja.translation.kiosk[k], k).not.toBe(resources.en.translation.kiosk[k]);
    expect(resources.ja.translation.kiosk.next_page).toBe('つぎのページ');
    // Hebrew and English notebook pages keep their Next block label.
    expect(resources.he.translation.kiosk.next_page).toBe(resources.he.translation.kiosk.next_block);
    expect(resources.en.translation.kiosk.next_page).toBe(resources.en.translation.kiosk.next_block);
    // The staff screens stay in English for a Japanese key.
    expect(resources.ja.translation.auth).toEqual(resources.en.translation.auth);
  });

  it('no translation is empty', () => {
    for (const lang of ['he', 'en', 'ja'] as const) {
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
    expect(directionOf('ja')).toBe('ltr');
  });
});
