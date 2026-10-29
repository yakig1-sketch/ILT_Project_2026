// Application log vocabulary (DDD §12). Add new event types here only.

export const LOG_EVENT_TYPES = [
  // auth
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.logout',
  'auth.account.locked',
  'auth.director_pin.verified',
  'auth.director_pin.failed',
  // users
  'users.user.created',
  'users.user.updated',
  'users.user.deactivated',
  // participants
  'participants.participant.created',
  'participants.participant.updated',
  'participants.consent.recorded',
  // sessions
  'session.created',
  'session.paired',
  'session.step.dispatched',
  'session.step.started',
  'session.step.skipped',
  'session.box.advanced',
  'session.inactivity.cue',
  'session.inactivity.amber',
  'session.paused',
  'session.resumed',
  'session.block.completed',
  'session.block.manual_finish',
  'session.block.repeated',
  'session.block.scored',
  'session.paper_page.timed',
  'session.completed',
  'session.aborted',
  'session.link.lost',
  'session.link.restored',
  // telemetry
  'telemetry.batch.rejected',
  'telemetry.integrity.failed',
  'telemetry.box_mismatch',
  // intervention
  'intervention.mark.suggested',
  'intervention.mark.changed',
  // settings
  'settings.value.changed',
  'settings.value.removed',
  'settings.override.changed',
  // canvases and videos
  'canvas.uploaded',
  'canvas.validated',
  'canvas.activated',
  'canvas.retired',
  'canvas.reference.recorded',
  'canvas.reference.accepted',
  'canvas.reference.cleared',
  'video.uploaded',
  'video.retired',
  // scores and data
  'scores.recomputed',
  'data.export.created',
  'data.replay.opened',
  'data.legacy.imported',
  'data.paper_scores.entered',
  // system
  'system.error',
  'system.service.started',
  'system.service.stopped',
] as const;

export type LogEventType = (typeof LOG_EVENT_TYPES)[number];

export const LOG_SEVERITIES = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'SECURITY'] as const;
export type LogSeverity = (typeof LOG_SEVERITIES)[number];

export interface AppEvent {
  occurred_at?: string;
  severity: LogSeverity;
  event_type: LogEventType;
  actor_user_id?: string | null;
  actor_role?: string | null;
  device_id?: string | null;
  domain_id?: number | null;
  region_id?: number | null;
  session_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  correlation_id?: string | null;
  client_ip?: string | null;
  /** English text, used for full-text search. The UI shows a translated label per event_type. */
  message: string;
  details?: Record<string, unknown>;
}
