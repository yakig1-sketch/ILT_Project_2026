// Binary telemetry packet codec (DDD §5.2). Little-endian.
//
// Header (28 bytes): magic u16 | protocol_version u8 | packet_type u8 | session_id 16B |
//                    step_index u8 | attempt_number u8 | sequence u32 | sample_count u16
// Sample (24 bytes): t_us i32 | x_mm f32 | y_mm f32 | pressure f32 | tilt_x i8 | tilt_y i8 |
//                    flags u8 | box_id u8 | sample_seq u32
// Trailer (2 bytes): CRC-16/CCITT-FALSE over header + samples
import type { PenSample } from '@ilt/shared-types';

export const MAGIC = 0xaa55;
export const WIRE_PROTOCOL_VERSION = 2;
export const HEADER_BYTES = 28;
export const SAMPLE_BYTES = 24;
export const TRAILER_BYTES = 2;
export const MAX_SAMPLES_PER_PACKET = 512;

export const PacketType = { LIVE: 0x01, BATCH: 0x02 } as const;
export type PacketType = (typeof PacketType)[keyof typeof PacketType];

export interface PacketHeader {
  packet_type: PacketType;
  session_id: string;
  step_index: number;
  attempt_number: number;
  sequence: number;
}

export interface Packet extends PacketHeader {
  samples: PenSample[];
}

export class PacketError extends Error {
  constructor(
    readonly code: 'TOO_SHORT' | 'BAD_MAGIC' | 'BAD_VERSION' | 'BAD_TYPE' | 'BAD_LENGTH' | 'BAD_CRC' | 'TOO_MANY_SAMPLES',
    message: string,
  ) {
    super(message);
    this.name = 'PacketError';
  }
}

/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no final XOR. */
export function crc16(bytes: Uint8Array, end = bytes.length): number {
  let crc = 0xffff;
  for (let i = 0; i < end; i++) {
    crc ^= bytes[i]! << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function uuidToBytes(uuid: string, out: Uint8Array, offset: number): void {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new TypeError(`Invalid UUID: ${uuid}`);
  for (let i = 0; i < 16; i++) out[offset + i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
}

function bytesToUuid(bytes: Uint8Array, offset: number): string {
  let hex = '';
  for (let i = 0; i < 16; i++) hex += bytes[offset + i]!.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function encodePacket(packet: Packet): Uint8Array {
  const n = packet.samples.length;
  if (n > MAX_SAMPLES_PER_PACKET) {
    throw new PacketError('TOO_MANY_SAMPLES', `${n} samples exceeds ${MAX_SAMPLES_PER_PACKET}`);
  }
  const bytes = new Uint8Array(HEADER_BYTES + n * SAMPLE_BYTES + TRAILER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, MAGIC, true);
  view.setUint8(2, WIRE_PROTOCOL_VERSION);
  view.setUint8(3, packet.packet_type);
  uuidToBytes(packet.session_id, bytes, 4);
  view.setUint8(20, packet.step_index);
  view.setUint8(21, packet.attempt_number);
  view.setUint32(22, packet.sequence >>> 0, true);
  view.setUint16(26, n, true);

  let o = HEADER_BYTES;
  for (const s of packet.samples) {
    writeSample(view, o, s);
    o += SAMPLE_BYTES;
  }
  view.setUint16(o, crc16(bytes, o), true);
  return bytes;
}

export function decodePacket(bytes: Uint8Array): Packet {
  if (bytes.length < HEADER_BYTES + TRAILER_BYTES) {
    throw new PacketError('TOO_SHORT', `Packet of ${bytes.length} bytes is too short`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== MAGIC) throw new PacketError('BAD_MAGIC', 'Bad magic');
  if (view.getUint8(2) !== WIRE_PROTOCOL_VERSION) {
    throw new PacketError('BAD_VERSION', `Unsupported protocol version ${view.getUint8(2)}`);
  }
  const packetType = view.getUint8(3);
  if (packetType !== PacketType.LIVE && packetType !== PacketType.BATCH) {
    throw new PacketError('BAD_TYPE', `Unknown packet type ${packetType}`);
  }
  const n = view.getUint16(26, true);
  if (n > MAX_SAMPLES_PER_PACKET) throw new PacketError('TOO_MANY_SAMPLES', `${n} samples`);
  const expected = HEADER_BYTES + n * SAMPLE_BYTES + TRAILER_BYTES;
  if (bytes.length !== expected) {
    throw new PacketError('BAD_LENGTH', `Expected ${expected} bytes for ${n} samples, got ${bytes.length}`);
  }
  const crcAt = expected - TRAILER_BYTES;
  if (view.getUint16(crcAt, true) !== crc16(bytes.subarray(0, crcAt))) {
    throw new PacketError('BAD_CRC', 'CRC mismatch');
  }

  const samples: PenSample[] = new Array(n);
  let o = HEADER_BYTES;
  for (let i = 0; i < n; i++) {
    samples[i] = {
      t_us: view.getInt32(o, true),
      x_mm: view.getFloat32(o + 4, true),
      y_mm: view.getFloat32(o + 8, true),
      pressure: view.getFloat32(o + 12, true),
      tilt_x: view.getInt8(o + 16),
      tilt_y: view.getInt8(o + 17),
      flags: view.getUint8(o + 18),
      box_id: view.getUint8(o + 19),
      sample_seq: view.getUint32(o + 20, true),
    };
    o += SAMPLE_BYTES;
  }
  return {
    packet_type: packetType as PacketType,
    session_id: bytesToUuid(bytes, 4),
    step_index: view.getUint8(20),
    attempt_number: view.getUint8(21),
    sequence: view.getUint32(22, true),
    samples,
  };
}

/** Serialises samples (in sample_seq order) to the 24-byte records used for the block SHA-256. */
export function encodeSampleRecords(samples: readonly PenSample[]): Uint8Array {
  const sorted = [...samples].sort((a, b) => a.sample_seq - b.sample_seq);
  const bytes = new Uint8Array(sorted.length * SAMPLE_BYTES);
  const view = new DataView(bytes.buffer);
  sorted.forEach((s, i) => writeSample(view, i * SAMPLE_BYTES, s));
  return bytes;
}

function writeSample(view: DataView, o: number, s: PenSample): void {
  view.setInt32(o, s.t_us, true);
  view.setFloat32(o + 4, s.x_mm, true);
  view.setFloat32(o + 8, s.y_mm, true);
  view.setFloat32(o + 12, s.pressure, true);
  view.setInt8(o + 16, s.tilt_x);
  view.setInt8(o + 17, s.tilt_y);
  view.setUint8(o + 18, s.flags);
  view.setUint8(o + 19, s.box_id);
  view.setUint32(o + 20, s.sample_seq >>> 0, true);
}
