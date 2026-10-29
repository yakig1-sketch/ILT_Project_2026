import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseControlMessage } from './control-events.js';

const envelope = (event: string, payload: unknown) => ({
  message_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  protocol_version: PROTOCOL_VERSION,
  sent_at: '2026-10-28T08:30:00.123Z',
  event,
  payload,
});

describe('control events', () => {
  it('accepts a valid pairing request', () => {
    const msg = envelope('PAIRING_REQUEST', {
      pin: '849201',
      css_px_per_mm: 5.195,
      device_pixel_ratio: 1.75,
      screen_w_mm: 242,
      screen_h_mm: 158,
    });
    expect(() => parseControlMessage(msg)).not.toThrow();
  });

  it('rejects a 5-digit PIN', () => {
    const msg = envelope('PAIRING_REQUEST', {
      pin: '84920',
      css_px_per_mm: 5.195,
      device_pixel_ratio: 1.75,
      screen_w_mm: 242,
      screen_h_mm: 158,
    });
    expect(() => parseControlMessage(msg)).toThrow();
  });

  it('rejects an unknown event', () => {
    expect(() => parseControlMessage(envelope('SELF_DESTRUCT', {}))).toThrow();
  });
});
