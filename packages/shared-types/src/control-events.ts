// Control-event contracts (DDD §5.3), validated with zod on both ends.
import { z } from 'zod';
import { STEP_TYPES } from './domain.js';

export const PROTOCOL_VERSION = '2.0';

const uuid = z.string().uuid();
const timers = z.object({
  in_transition_sec: z.number().int().min(0),
  inactivity_sec: z.number().int().min(1),
  inactivity_last_box_sec: z.number().int().min(1),
  amber_grace_sec: z.number().int().min(0),
});
const pauseReason = z.enum(['STUDENT_FATIGUE', 'HARDWARE', 'EVALUATOR_INTERVENTION', 'OTHER']);

export const ControlPayloads = {
  PAIRING_REQUEST: z.object({
    pin: z.string().regex(/^\d{6}$/),
    device_id: uuid.optional(),
    css_px_per_mm: z.number().positive(),
    device_pixel_ratio: z.number().positive(),
    screen_w_mm: z.number().positive(),
    screen_h_mm: z.number().positive(),
  }),
  PAIRING_RESPONSE: z.object({
    status: z.enum(['ACCEPTED', 'REJECTED']),
    session_id: uuid.optional(),
    language: z.string().optional(),
    direction: z.enum(['rtl', 'ltr']).optional(),
    mode: z.enum(['SESSION', 'REFERENCE']).optional(),
  }),
  DISPATCH_STEP: z.object({
    step_index: z.number().int().min(0).max(254),
    step_type: z.enum(STEP_TYPES),
    attempt_number: z.number().int().min(1).max(255),
    canvas: z.unknown().optional(),
    fill_order: z.array(z.number().int()).optional(),
    timers: timers.optional(),
  }),
  STEP_STARTED: z.object({
    step_index: z.number().int(),
    attempt_number: z.number().int(),
    block_started_at: z.string().datetime(),
  }),
  BOX_ADVANCED: z.object({
    box_id: z.number().int(),
    fill_position: z.number().int(),
    skipped_box_ids: z.array(z.number().int()),
  }),
  INACTIVITY_ALERT: z.object({
    level: z.enum(['CUE', 'AMBER']),
    idle_ms: z.number().int(),
    box_id: z.number().int(),
  }),
  PAUSE_SESSION: z.object({ reason: pauseReason, note: z.string().max(500).optional() }),
  RESUME_SESSION: z.object({ note: z.string().max(500).optional() }),
  MANUAL_FINISH: z.object({ reason: z.string().max(200) }),
  BLOCK_COMPLETE: z.object({
    step_index: z.number().int(),
    attempt_number: z.number().int(),
    end_reason: z.enum(['LAST_BOX', 'MANUAL', 'TIMEOUT']),
    sample_count: z.number().int().min(0),
    last_sample_seq: z.number().int().min(-1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  BLOCK_SCORED: z.object({
    block_attempt_id: uuid,
    score_version: z.number().int(),
    scores: z.record(z.unknown()),
  }),
  REPEAT_BLOCK: z.object({ step_index: z.number().int(), reason: z.string().max(200) }),
  VIDEO_PLAY: z.object({ video_key: z.string(), language: z.string(), url: z.string() }),
  VIDEO_ENDED: z.object({ video_key: z.string() }),
  ABORT_SESSION: z.object({ reason: z.string().max(200), save_partial: z.boolean() }),
  SESSION_COMPLETE: z.object({ session_id: uuid, completed_steps: z.number().int() }),
  REFERENCE_START: z.object({
    canvas_id: uuid,
    kind: z.enum(['SAMPLE_BLOCK_FILL', 'NORMAL_SPEED']),
    rows: z.number().int().min(1).optional(),
  }),
  REFERENCE_RESULT: z.object({ recording_id: uuid, derived: z.record(z.unknown()) }),
  REFERENCE_DECISION: z.object({ recording_id: uuid, decision: z.enum(['ACCEPT', 'CLEAR']) }),
  HEARTBEAT: z.object({ t: z.number() }),
  ACK: z.object({ ack_of: uuid }),
  ERROR: z.object({ ref: uuid.optional(), code: z.string(), message: z.string() }),
} as const;

export type ControlEventName = keyof typeof ControlPayloads;
export type ControlPayload<E extends ControlEventName> = z.infer<(typeof ControlPayloads)[E]>;

export const ControlEnvelope = z.object({
  message_id: uuid,
  protocol_version: z.literal(PROTOCOL_VERSION),
  sent_at: z.string().datetime(),
  event: z.enum(Object.keys(ControlPayloads) as [ControlEventName, ...ControlEventName[]]),
  payload: z.unknown(),
});
export type ControlEnvelope = z.infer<typeof ControlEnvelope>;

/** Events that are not acknowledged with ACK. */
export const UNACKED_EVENTS: ReadonlySet<ControlEventName> = new Set(['ACK', 'ERROR', 'HEARTBEAT']);

/** Parses an envelope and validates its payload against the event's schema. */
export function parseControlMessage(raw: unknown): { envelope: ControlEnvelope; payload: unknown } {
  const envelope = ControlEnvelope.parse(raw);
  const payload = ControlPayloads[envelope.event].parse(envelope.payload);
  return { envelope, payload };
}
