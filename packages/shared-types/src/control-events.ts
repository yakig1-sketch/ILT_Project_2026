// Control-event contracts (DDD §5.3), validated with zod on both ends.
import { z } from 'zod';
import { STEP_TYPES } from './domain.js';

// Web Crypto is global in browsers and Node 19+; this package compiles without DOM or Node types.
declare const crypto: { randomUUID(): string };

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
    /** Position among the session's steps of the same type ("Block 2 of 4" on the tablet). */
    block_number: z.number().int().min(1).optional(),
    block_count: z.number().int().min(1).optional(),
    /** Sent by the gateway after [Next block]: the tablet starts the block without the transition countdown. */
    immediate: z.boolean().optional(),
    /** Canvas scoring profile (dot radii, order); the cockpit uses it for the live telemetry preview. */
    profile: z.unknown().optional(),
    /**
     * Reference mode (FR-TAB-8): the tablet shows the "reference recording" banner and a [Done]
     * button that is always available; `free_order` lifts the forward-only box lock (sample block).
     */
    reference: z.object({ kind: z.enum(['PREVIEW', 'SAMPLE_BLOCK_FILL', 'NORMAL_SPEED']), free_order: z.boolean(), rows: z.number().int().optional() }).optional(),
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
    /** NEXT_BLOCK: the [Next block] button on the tablet; the gateway then dispatches the next writing block. */
    end_reason: z.enum(['LAST_BOX', 'MANUAL', 'TIMEOUT', 'NEXT_BLOCK']),
    sample_count: z.number().int().min(0),
    last_sample_seq: z.number().int().min(-1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  /** Gateway → cockpit after BLOCK_STORED: the block's measures and, for scored blocks, score version 1. */
  BLOCK_SCORED: z.object({
    block_attempt_id: uuid,
    step_index: z.number().int(),
    attempt_number: z.number().int(),
    /** null for blocks that are measured but not scored (warm-up, notebook pages). */
    score_version: z.number().int().nullable(),
    scores: z.record(z.unknown()),
  }),
  /** Cockpit → gateway: the last attempt becomes REPEATED and the step is sent again as attempt + 1. */
  REPEAT_BLOCK: z.object({ step_index: z.number().int(), reason: z.string().max(200) }),
  /**
   * Cockpit → gateway with step_index only; the gateway resolves the session-language video and
   * forwards it to the tablet with video_key, language and url.
   */
  VIDEO_PLAY: z.object({
    step_index: z.number().int(),
    video_key: z.string().optional(),
    language: z.string().optional(),
    url: z.string().optional(),
  }),
  /** Tablet → gateway when the video ends (ENDED), or cockpit → gateway to stop it (STOPPED). */
  VIDEO_ENDED: z.object({ step_index: z.number().int(), reason: z.enum(['ENDED', 'STOPPED']) }),
  ABORT_SESSION: z.object({ reason: z.string().max(200), save_partial: z.boolean() }),
  SESSION_COMPLETE: z.object({ session_id: uuid, completed_steps: z.number().int() }),
  /**
   * Administrator → gateway in reference mode (FR-CAN-6/9/10): show a canvas at true size on the
   * paired tablet (PREVIEW, nothing is stored) or record a sample. The gateway sends the tablet a
   * DISPATCH_STEP carrying `reference`. `domain_id` null: the canvas's own profile.
   */
  REFERENCE_START: z.object({
    canvas_id: uuid,
    kind: z.enum(['PREVIEW', 'SAMPLE_BLOCK_FILL', 'NORMAL_SPEED']),
    rows: z.number().int().min(1).max(10).optional(),
    domain_id: z.number().int().nullable().optional(),
    writer_label: z.string().trim().max(100).optional(),
  }),
  /** Gateway → administrator: the stored recording and the values derived from it. */
  REFERENCE_RESULT: z.object({ recording_id: uuid, kind: z.enum(['SAMPLE_BLOCK_FILL', 'NORMAL_SPEED']).optional(), canvas_id: uuid.optional(), derived: z.record(z.unknown()) }),
  REFERENCE_DECISION: z.object({ recording_id: uuid, decision: z.enum(['ACCEPT', 'CLEAR']) }),
  /** Gateway → tablet: a BATCH packet is stored (application ACK, DDD §5.1). */
  BATCH_ACK: z.object({
    step_index: z.number().int(),
    attempt_number: z.number().int(),
    sequence: z.number().int().min(0),
  }),
  /** Gateway → cockpit: every sample of a completed block is stored and its SHA-256 checked. */
  BLOCK_STORED: z.object({
    block_attempt_id: uuid,
    step_index: z.number().int(),
    attempt_number: z.number().int(),
    sample_count: z.number().int().min(0),
    integrity_ok: z.boolean(),
  }),
  /** Gateway → tablet and cockpit: which ends of the session are connected. */
  PEER_STATUS: z.object({ tablet: z.boolean(), cockpit: z.boolean() }),
  /** Tablet → gateway after every (re)connect: the block it holds (dispatched, writing or saving), or none. */
  TABLET_STATUS: z.object({
    block: z.object({ step_index: z.number().int(), attempt_number: z.number().int() }).nullable(),
  }),
  /** Gateway → cockpit: the tablet restarted and lost the running block; the attempt is closed and the step can be sent again. */
  BLOCK_INTERRUPTED: z.object({
    step_index: z.number().int(),
    attempt_number: z.number().int(),
    reason: z.enum(['TABLET_RESTARTED']),
  }),
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
export const UNACKED_EVENTS: ReadonlySet<ControlEventName> = new Set([
  'ACK', 'ERROR', 'HEARTBEAT', 'BATCH_ACK', 'PEER_STATUS',
  // Sent fresh on every connect / state change, so a resend after a reconnect would be stale.
  'TABLET_STATUS', 'BLOCK_INTERRUPTED',
]);

/** Builds an envelope for an event; the payload type is checked against the event's schema. */
export function controlMessage<E extends ControlEventName>(
  event: E,
  payload: ControlPayload<E>,
  messageId: string = crypto.randomUUID(),
): ControlEnvelope {
  return { message_id: messageId, protocol_version: PROTOCOL_VERSION, sent_at: new Date().toISOString(), event, payload };
}

/** WebRTC signalling relayed by the gateway between the cockpit and the tablet (not a control event). */
export const SignalMessage = z.object({
  signal: z.object({
    description: z.object({ type: z.enum(['offer', 'answer']), sdp: z.string() }).optional(),
    candidate: z.record(z.unknown()).nullable().optional(),
  }),
});
export type SignalMessage = z.infer<typeof SignalMessage>;

/** Parses an envelope and validates its payload against the event's schema. */
export function parseControlMessage(raw: unknown): { envelope: ControlEnvelope; payload: unknown } {
  const envelope = ControlEnvelope.parse(raw);
  const payload = ControlPayloads[envelope.event].parse(envelope.payload);
  return { envelope, payload };
}
