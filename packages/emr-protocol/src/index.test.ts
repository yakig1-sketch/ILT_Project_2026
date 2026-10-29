import { describe, expect, it } from 'vitest';
import { StrokeFlag, type PenSample } from '@ilt/shared-types';
import {
  HEADER_BYTES,
  PacketError,
  PacketType,
  SAMPLE_BYTES,
  TRAILER_BYTES,
  crc16,
  decodePacket,
  encodePacket,
  encodeSampleRecords,
} from './index.js';

const sample = (seq: number): PenSample => ({
  sample_seq: seq,
  t_us: seq * 4167,
  x_mm: 14.5 + seq * 0.25,
  y_mm: 2.6 + seq * 0.5,
  pressure: 0.6123,
  tilt_x: -41,
  tilt_y: 54,
  flags: StrokeFlag.CONTACT | (seq === 0 ? StrokeFlag.STROKE_START : 0),
  box_id: 4,
});

const packet = {
  packet_type: PacketType.BATCH,
  session_id: 'c7a8b3d4-1e2f-4a5b-9c8d-7e6f5a4b3c2d',
  step_index: 3,
  attempt_number: 2,
  sequence: 4_000_000_000,
  samples: Array.from({ length: 50 }, (_, i) => sample(i)),
};

describe('emr-protocol', () => {
  it('uses the documented sizes', () => {
    expect(HEADER_BYTES).toBe(28);
    expect(SAMPLE_BYTES).toBe(24);
    expect(encodePacket(packet).length).toBe(HEADER_BYTES + 50 * SAMPLE_BYTES + TRAILER_BYTES);
  });

  it('round-trips a batch packet', () => {
    const decoded = decodePacket(encodePacket(packet));
    expect(decoded.session_id).toBe(packet.session_id);
    expect(decoded.step_index).toBe(3);
    expect(decoded.attempt_number).toBe(2);
    expect(decoded.sequence).toBe(4_000_000_000);
    expect(decoded.samples).toHaveLength(50);
    const s = decoded.samples[10]!;
    expect(s.sample_seq).toBe(10);
    expect(s.t_us).toBe(41670);
    expect(s.x_mm).toBeCloseTo(17.0, 5);
    expect(s.pressure).toBeCloseTo(0.6123, 6);
    expect(s.tilt_x).toBe(-41);
    expect(s.box_id).toBe(4);
  });

  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x29b1);
  });

  it('rejects a corrupted packet', () => {
    const bytes = encodePacket(packet);
    bytes[HEADER_BYTES + 5] ^= 0xff;
    expect(() => decodePacket(bytes)).toThrow(PacketError);
  });

  it('rejects a truncated packet', () => {
    const bytes = encodePacket(packet).subarray(0, 100);
    expect(() => decodePacket(bytes)).toThrowError(/Expected/);
  });

  it('serialises sample records in sample_seq order', () => {
    const shuffled = [sample(2), sample(0), sample(1)];
    const bytes = encodeSampleRecords(shuffled);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(20, true)).toBe(0);
    expect(view.getUint32(SAMPLE_BYTES * 2 + 20, true)).toBe(2);
  });
});
