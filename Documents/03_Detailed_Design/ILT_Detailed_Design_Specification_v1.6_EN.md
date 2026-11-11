# ILT Research System: Detailed Design Specification (DDD v1.6)

| | |
|---|---|
| **Document ID** | ILT-DDD-V1.6-EN |
| **Date** | 2026-10-28 |
| **Supersedes** | DDD v1.5 CODING-READY. Self-contained: everything needed to code is here or in the linked repo files |
| **Functional baseline** | [FRS v3.5](../01_Requirements/ILT_Functional_Requirements_Specification_v3.5_EN.md) |
| **Architecture** | [Architecture v5.6](../02_System_Architecture/ILT_System_Architecture_and_Specifications_v5.6_EN.md) |
| **Clinical source of truth** | [Clinical Decisions Register](../04_Development_Plan/ILT_Clinical_Decisions_2026-10-25.md) (round 3, 2026-10-28) |
| **Device** | Wacom DTH-A116, Chrome on Android 14. Measured constants: [device profile](../04_Development_Plan/ILT_DTH-A116_Device_Profile.md) |
| **Geometry** | [ILT_Day1_Grid_Geometry.json](../05_Measures/ILT_Day1_Grid_Geometry.json) (v3, 35 × 25 mm) |

**Rule for this edition:** the repository is the source of truth. Code, migrations and seeds in the repo implement this document; if they disagree, the disagreement is a bug to fix in one or the other, recorded in the commit.

---

## 1. Conventions

| Item | Convention |
|---|---|
| Length | Millimetres (float32 on the wire, `REAL` in the database), origin at the canvas's top-left, x to the right, y down |
| Time within a block | Integer **microseconds** from block start (`t_us`, int32: covers 35 minutes) |
| Wall-clock time | `TIMESTAMPTZ`, UTC |
| Pressure | **Raw** value as reported by the browser (0–1). Never rescaled or clipped at capture. Normalisation happens only in analysis |
| Box ids | Physical, row-major from the canvas's top-left: `id = row × cols + col` (0–14 on the ILT grid). **Fill position** (0–14) is the order of writing and is stored separately |
| Percent scores | 0–100, `NUMERIC(5,2)`, computed from unrounded inputs, rounded half-up to 2 decimals only when stored |
| Identifiers | UUID v4 except small lookup tables |
| Text | All user-facing text in translation files (`he`, `en`); database stores codes, not display text, except names entered by administrators (stored per language) |

## 2. Device capture

Measured on the DTH-A116 (see the device profile): ~239 Hz contact sampling (design rate 240, buffers sized for 270), 0.1 ms timestamp steps, 60 Hz display with ~3.9 samples per frame, ~8,192 pressure steps (observed max 0.86), tilt ±54°, hover at 60 Hz, **5.195 CSS px/mm** at devicePixelRatio 1.75, frequent palm touches.

| Rule | Implementation |
|---|---|
| Single capture source | `pointerrawupdate` (one event per hardware sample) feeds both the live mirror and persistence. Fallback where unsupported: `pointermove` + `getCoalescedEvents()`. Never both |
| Timing | `t_us = round((event.timeStamp − blockStartTimeStamp) × 1000)` |
| Coordinates | `x_mm = (clientX − canvasLeftPx) / pxPerMm` using the **paired device's calibration**, stored on the session |
| Palm rejection | While a block is active, `pointerType === 'touch'` events are ignored (`preventDefault`, not recorded) |
| Strokes | `pointerdown` sets `STROKE_START` on its sample; `pointerup` sets `STROKE_END`. Pressure never reaches 0 during contact, so lifts are taken only from up/down events |
| Hover | Samples with `buttons === 0` inside hover range get `HOVER`; `pointerleave`/`pointerout` from a pen sets `OUT_OF_RANGE` on the last hover sample |
| Calibration | Per tablet, with an on-screen 50 mm ruler matched to a physical ruler (see `tools/pen-probe`). Stored in `devices`, copied to each session |
| Device detection | Never from the user-agent string (Chrome reports a reduced UA) |

## 3. Monorepo

```
apps/
  tablet-kiosk/          React + Vite, PWA, child canvas, reference mode
  evaluator-cockpit/     React + Vite, cockpit, summary, replay, admin screens
  analyst-portal/        React + Vite, research replay, cohort views, exports
services/
  telemetry-gateway/     Node 24 + Fastify: REST, WebSocket, signalling, persistence, scoring
  analytics/             Python 3.12 + FastAPI + DuckDB: kinematics, exports, legacy import
packages/
  shared-types/          PenSample, enums, device constants, control-event contracts (zod)
  emr-protocol/          Binary codec (encode/decode, CRC16)
  ilt-metrics/           Scoring engine (pure TypeScript, no I/O) + golden fixtures
  template-schemas/      JSON Schemas for canvas geometry, scoring profile, protocol template
  i18n/                  Translation files (he.ts / en.ts, typed so both have the same keys) + helpers
  ui/                    Shared RTL-aware React components
infra/
  docker-compose.yml     timescaledb, seaweedfs (S3), go2rtc
  db/migrations/         SQL migrations (§9)
  db/seed/               Seed script (§10)
tools/pen-probe/         Device measurement page (exists)
```

## 4. Shared types (`packages/shared-types`)

```ts
export interface PenSample {
  sample_seq: number;     // uint32, per block attempt, starts at 0: idempotency key
  t_us: number;           // int32 microseconds since block start
  x_mm: number;           // float32
  y_mm: number;           // float32
  pressure: number;       // float32, raw 0..1 from the browser
  tilt_x: number;         // int8 degrees
  tilt_y: number;         // int8 degrees
  flags: number;          // uint8, StrokeFlag bitmask
  box_id: number;         // uint8, active box id (0..14), 255 = none
}

export enum StrokeFlag {
  CONTACT         = 0x01, // tip on the surface
  HOVER           = 0x02, // in range, tip up
  ERASER          = 0x04, // eraser end / barrel button
  TARGET_HIT_HINT = 0x08, // live hint computed on the tablet; scoring recomputes on the server
  STROKE_START    = 0x10, // sample from pointerdown
  STROKE_END      = 0x20, // sample from pointerup
  OUT_OF_RANGE    = 0x40, // pen left hover range after this sample
}

export const DTH_A116 = {
  SAMPLE_RATE_DESIGN_HZ: 240, SAMPLE_RATE_PEAK_HZ: 270, SAMPLE_INTERVAL_MEDIAN_MS: 4.1,
  TIMESTAMP_RESOLUTION_MS: 0.1, CSS_PX_PER_MM: 5.195, PHYSICAL_PPI: 230.9,
  DISPLAY_REFRESH_HZ: 60, HOVER_RATE_HZ: 60, PRESSURE_OBSERVED_MAX: 0.86, TILT_SUPPORTED: true,
} as const;
```

## 5. Communication

### 5.1 Channels

| Channel | Transport | Reliability | Content |
|---|---|---|---|
| `emr-stream` | WebRTC DataChannel tablet → cockpit | Unordered, no retransmit | `LIVE` packets, one per display frame (~4 samples) |
| Tablet link | WebSocket tablet → gateway (`/ws/tablet`) | TCP + application ACK | `BATCH` packets (≤ 50 samples, ~210 ms), control events, signalling; `LIVE` packets when the direct channel is not open |
| Cockpit link | WebSocket cockpit → gateway (`/ws/cockpit`) | TCP | Control events, scoring results, signalling, relayed `LIVE` packets |

**Control events go through the gateway** (changed in Phase 1; earlier editions had a second WebRTC channel, `control-events`). The gateway is the hub: it validates, stores and logs every event, adds the resolved canvas to `DISPATCH_STEP`, and forwards each event to the other end. One ordered path means one reconnection story and no event that the gateway has not seen. WebRTC carries only the live mirror; the gateway only relays its signalling (`{ "signal": { description | candidate } }`), with no STUN or TURN on the local network. When the direct channel is not open, the tablet sends `LIVE` packets over its socket and the gateway relays them to the cockpit; the cockpit shows which path the mirror uses.

**Socket authentication:** the first text message on a socket carries the credential: `{ "auth": <tablet token> }` on `/ws/tablet` (issued by `POST /sessions/pair`, bound to one session, 12 h), `{ "auth": <access token>, "session_id": ... }` on `/ws/cockpit` (evaluators only for their own sessions). A bad credential closes the socket with code 4401; a second tablet socket for the same session replaces the first (4409). The tablet token carries the pairing's token id (`tid`), which must equal `sessions.tablet_token_id`: a released tablet, or one holding an older pairing, is closed with 4401 and returns to the PIN screen. A tablet that reconnects to a session that has ended meanwhile receives `SESSION_COMPLETE` or `ABORT_SESSION` at once.

**No data loss:** the tablet keeps every batch in IndexedDB until the gateway acknowledges it with `BATCH_ACK`, and keeps control events until their `ACK`. After a reconnect it resends unacknowledged control events first, then unacknowledged batches; a batch without an ACK after 3 s is also resent (e.g. one that arrived before its `STEP_STARTED` was stored). The gateway ignores duplicate samples by `(block_attempt_id, sample_seq)`: `sample_time` is the attempt's start plus `t_us`, so a resent sample maps to the same key. Over one TCP connection, events are not resent on a timer.

**Cockpit reconnect:** a cockpit that connects while a block is running receives that block's `DISPATCH_STEP` and `STEP_STARTED` again (rebuilt from the database after a gateway restart), so the evaluator can follow and finish it. Ink written before the reconnect is not replayed in the mirror.

**Tablet restart mid-block:** after every (re)connect the tablet sends `TABLET_STATUS` with the block it holds (dispatched, writing or saving), or none. If the running block was sent on an earlier connection and the tablet no longer holds it (the page restarted), the gateway closes the attempt as ABORTED (samples already stored stay), returns the step to PENDING, logs `session.block.interrupted` and sends `BLOCK_INTERRUPTED` to the cockpit, which can send the step again as a new attempt. A network blip keeps the block, because the tablet still reports it.

### 5.2 Binary packet (`packages/emr-protocol`), little-endian

**Header, 28 bytes**

| Offset | Size | Field | Notes |
|---|---|---|---|
| 0 | 2 | `magic` | `0xAA55` |
| 2 | 1 | `protocol_version` | `2` |
| 3 | 1 | `packet_type` | `0x01` LIVE, `0x02` BATCH |
| 4 | 16 | `session_id` | UUID bytes |
| 20 | 1 | `step_index` | 0–254 |
| 21 | 1 | `attempt_number` | 1–255 |
| 22 | 4 | `sequence` | Per channel, increments per packet (loss detection) |
| 26 | 2 | `sample_count` | 1–512 |

**Sample, 24 bytes:** `t_us` int32 @0 · `x_mm` float32 @4 · `y_mm` float32 @8 · `pressure` float32 @12 · `tilt_x` int8 @16 · `tilt_y` int8 @17 · `flags` uint8 @18 · `box_id` uint8 @19 · `sample_seq` uint32 @20.

**Trailer, 2 bytes:** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over header + samples.

The box id is carried **per sample only**; a packet may span a box change.

### 5.3 Control events

Envelope (JSON, validated with zod on both ends):

```json
{ "message_id": "uuid", "protocol_version": "2.0", "sent_at": "2026-10-28T08:30:00.123Z",
  "event": "DISPATCH_STEP", "payload": { } }
```

Every event except `ACK`, `ERROR` and `HEARTBEAT` is acknowledged with `ACK { ack_of: message_id }` or answered with `ERROR { ref, code, message }`. Unacknowledged events are resent after 1 s, up to 5 times.

| Event | Direction | Payload (main fields) |
|---|---|---|
| `PAIRING_REQUEST` | tablet → gateway | `pin` (6 digits), `device_id`, `css_px_per_mm`, `device_pixel_ratio`, `screen_w_mm`, `screen_h_mm` |
| `PAIRING_RESPONSE` | gateway → tablet | `status` ACCEPTED/REJECTED, `session_id`, `language`, `direction`, `mode` SESSION/REFERENCE |
| `DISPATCH_STEP` | cockpit → tablet (or gateway → all after [Next block]) | `step_index`, `step_type`, `canvas` (resolved geometry incl. mirroring), `fill_order`, `timers` {in_transition_sec, inactivity_sec, inactivity_last_box_sec, amber_grace_sec}, `attempt_number`, `block_number` / `block_count` (position among the session's steps of the same type, shown on the tablet as "Block 2 of 4"), `immediate` (true when the gateway sends it after [Next block]: the tablet starts at once, with no transition countdown), `profile` (the step's scoring-profile snapshot; the cockpit uses it for the live telemetry preview, the tablet ignores it) |
| `STEP_STARTED` | tablet → all | `step_index`, `attempt_number`, `block_started_at` (wall clock) |
| `BOX_ADVANCED` | tablet → all | `box_id`, `fill_position`, `skipped_box_ids[]` |
| `INACTIVITY_ALERT` | tablet → all | `level` CUE/AMBER, `idle_ms`, `box_id`. CUE after `inactivity_sec` without pen contact (`inactivity_last_box_sec` once the end of the page is reached): the tablet shows a soft amber glow around the page. AMBER after `amber_grace_sec` more: the cockpit's telemetry panel turns amber. Each is sent once per idle period and logged (`session.inactivity.cue` / `.amber`) |
| `PAUSE_SESSION` / `RESUME_SESSION` | cockpit → tablet | `reason` STUDENT_FATIGUE / HARDWARE / EVALUATOR_INTERVENTION / OTHER, `note` |
| `MANUAL_FINISH` | cockpit → tablet | `reason` |
| `BLOCK_COMPLETE` | tablet → all | `step_index`, `attempt_number`, `end_reason` LAST_BOX/MANUAL/TIMEOUT/NEXT_BLOCK, `sample_count`, `last_sample_seq`, `sha256` (over all sample bytes in seq order). NEXT_BLOCK: the [Next block] button on the tablet, offered once the child has reached the last house and answering only a pen tap (finger and palm are ignored); the attempt is stored as COMPLETED and the gateway dispatches the next pending step if it is a writing step (videos, paper steps and the end of the session stay with the evaluator) |
| `BLOCK_SCORED` | gateway → cockpit | `block_attempt_id`, `step_index`, `attempt_number`, `score_version` (1, or null for blocks measured but not scored: warm-up, notebook pages), `scores` {total time, pen lifts, skipped boxes, accuracy, accurate letters, average speed, speed / accuracy / pen-lift scores, composite, pass, per-letter speed and accuracy}. Sent right after `BLOCK_STORED` |
| `REPEAT_BLOCK` | cockpit → gateway | `step_index`, `reason`. Only for a finished writing step: the last finished attempt becomes `REPEATED` (kept with its scores, `repeat_reason` stored), the step returns to PENDING and the gateway sends `DISPATCH_STEP` for attempt + 1. Refused with `NOT_REPEATABLE` or `BLOCK_ACTIVE` |
| `VIDEO_PLAY` | cockpit → gateway → tablet | Cockpit sends `step_index`; the gateway resolves the ACTIVE video for the step's `video_key` in the session language (`NO_VIDEO` if there is none, FR-PLAN-8), marks the step ACTIVE and forwards `step_index`, `video_key`, `language`, `url` (`/api/v1/media/videos/:id`). The tablet downloads the video with its session token (never a token in a URL) and plays it full screen; a tablet that reconnects during the video gets it again. No block can be dispatched while a video plays (`VIDEO_PLAYING`) |
| `VIDEO_ENDED` | tablet → gateway (ENDED) · cockpit → gateway → tablet (STOPPED) | `step_index`, `reason` ENDED/STOPPED. The step becomes DONE; logged as `session.video.ended` |
| `ABORT_SESSION` | cockpit → all | `reason`, `save_partial` |
| `SESSION_COMPLETE` | gateway → all | `session_id`, `completed_steps` |
| `REFERENCE_START` | admin → gateway | `canvas_id`, `kind` PREVIEW/SAMPLE_BLOCK_FILL/NORMAL_SPEED, `rows` (speed only, default 1), `domain_id` (null: the canvas's own profile), `writer_label`. Only on a reference station's socket. The gateway answers with a `DISPATCH_STEP` to the tablet (and the admin) carrying `reference` {`kind`, `free_order`, `rows`}: step 0, `immediate`, no timers. Refused with `TABLET_OFFLINE`, `BLOCK_ACTIVE`, `NOT_DRAFT`, `NOT_SCORED`, `RETIRED` |
| `REFERENCE_RESULT` | gateway → admin | `recording_id`, `kind`, `canvas_id`, `derived` (§7.3). A preview ends at `BLOCK_COMPLETE` and sends none; an empty recording is `ERROR EMPTY_RECORDING` |
| `REFERENCE_DECISION` | — | Not used since Phase 3d: [Accept] and [Clear] are REST calls (§14), so a Domain profile can carry the director's PIN |
| `BATCH_ACK` | gateway → tablet | `step_index`, `attempt_number`, `sequence`: the `BATCH` packet is stored (not itself acknowledged) |
| `BLOCK_STORED` | gateway → cockpit | `block_attempt_id`, `step_index`, `attempt_number`, `sample_count`, `integrity_ok`: every sample of a completed block is stored and the SHA-256 checked. Phase 2 follows it with `BLOCK_SCORED` |
| `PEER_STATUS` | gateway → tablet, cockpit | `tablet`, `cockpit` (booleans): which ends are connected; the cockpit starts the WebRTC offer when the tablet appears |
| `TABLET_STATUS` | tablet → gateway | `block` {`step_index`, `attempt_number`} or null: the block the tablet holds, sent after every (re)connect; not acknowledged or forwarded (§5.1) |
| `BLOCK_INTERRUPTED` | gateway → cockpit | `step_index`, `attempt_number`, `reason` TABLET_RESTARTED: the tablet lost the running block; the attempt is closed and the step can be sent again |
| `HEARTBEAT` | all | `t` every 2 s; 3 missed = link lost |
| `ACK` / `ERROR` | all | see above |

## 6. Settings

### 6.1 Resolution

**Domain** and **Region** are two independent dimensions, not levels of one hierarchy:
- A **Domain** is a category that groups students for ILT testing (for example a study group, a program or a population). It isn't necessarily geographic.
- A **Region** is a geographic area.

Every participant belongs to one Domain and optionally one Region; a session copies both (the evaluator may change the Region for the session).

Each definition has an `override_scope`: `NONE` (System only), `DOMAIN` or `REGION`. Effective value for a session in domain *d*, region *r*:

```
value_at(DOMAIN, d)  if override_scope = DOMAIN and a value exists
value_at(REGION, r)  if override_scope = REGION and r is set and a value exists
else value_at(SYSTEM)  if a value exists
else definition.default_value
```

| Category | `override_scope` | Source |
|---|---|---|
| Scoring (formula factors and weights) | `DOMAIN` | General instruction 5 |
| Language configuration | `DOMAIN` | Reply on English mirroring ("system level or domain level") |
| ILT process (timers, warm-up, video, protocol templates) | `REGION` | General instruction 10 |
| Governance, privacy, device, log | `NONE` | |

Only `ADMIN` writes settings. If `governance.require_director_approval` is true and the definition has `requires_director_approval`, the request must include a Research Director's email and PIN (turning the switch itself off always needs them); the server verifies the PIN against `users.director_pin_hash`. Every change writes `setting_value_history` and an `settings.value.changed` log event with old and new values.

At session creation the gateway resolves all settings and stores them in `sessions.settings_snapshot`. Scoring always reads the snapshot (or, for a recomputation, the explicitly chosen settings).

### 6.2 Catalogue (seeded)

**Scoring** (override scope `DOMAIN`, director approval required)

| Key | Type | Default | Range / values |
|---|---|---|---|
| `scoring.composite.weight_speed_pct` | decimal | 50 | 0–100; the three weights total 100 |
| `scoring.composite.weight_accuracy_pct` | decimal | 25 | 0–100 |
| `scoring.composite.weight_pen_lifts_pct` | decimal | 25 | 0–100 |
| `scoring.pass_threshold` | decimal | null (not configured) | 0–100 |
| `scoring.speed.above_range_policy` | enum | `CAP_100` | `CAP_100`, `SYMMETRIC_PENALTY` |
| `scoring.pen_lift.min_gap_ms` | integer | 50 | 10–500 |
| `scoring.accurate.require_dot_order` | boolean | **true** | |
| `scoring.accurate.require_width_band` | boolean | false | |
| `scoring.accurate.require_no_internal_lift` | boolean | false | |
| `scoring.width.nominal_mm` | decimal | 11.0 | 1–40 |
| `scoring.width.tolerance_mm` | decimal | 2.0 | 0–20 |
| `scoring.similarity_hint.enabled` | boolean | true | |

Per-canvas factors (dot order, per-dot radius and weight, expected pen lifts, fill order, Normal speed, flexibility) live in the canvas scoring profile (§7.2), overridable per Domain.

**ILT process** (override scope `REGION`; timers need director approval)

| Key | Type | Default |
|---|---|---|
| `ilt.timer.in_transition_sec` | integer | 20 |
| `ilt.timer.inactivity_sec` | integer | 20 |
| `ilt.timer.inactivity_last_box_sec` | integer | 30 |
| `ilt.timer.amber_grace_sec` | integer | 10 |
| `ilt.timer.notebook_page_timeout_sec` | integer | 60 |
| `ilt.inactivity_cue` | enum `VISUAL`/`AUDIO`/`BOTH` | `VISUAL` |
| `ilt.forward_only_lock` | boolean | true |
| `ilt.box_entry_margin_mm` | decimal | 2.0 |
| `ilt.warmup.enabled` | boolean | true |
| `ilt.video.recording_enabled` | boolean | false |
| `ilt.protocol.day1_template` | string (template code) | `DAY_1` |
| `ilt.protocol.day2_template` | string | `DAY_2` |
| `ilt.protocol.day14_template` | string | `DAY_14` |

**Language** (override scope `DOMAIN`), one group per language code *L*

| Key | Type | Default (he / en) |
|---|---|---|
| `language.enabled` | json array | `["he","en"]` |
| `language.default` | string | `he` |
| `language.L.ilt_canvas` | string (canvas code) | `ILT_3X5_HE` / `ILT_3X5_EN` |
| `language.L.notebook_canvas` | string | `NOTEBOOK_HE` / `NOTEBOOK_EN` |
| `language.L.letter_set` | uuid / null | Hebrew letter set / null |
| `language.L.fill_direction` | enum `RTL_ROWS`/`LTR_ROWS` | `RTL_ROWS` / `LTR_ROWS` |
| `language.L.mirrored` | boolean | false / false |

**Governance, privacy, device** (override scope `NONE`)

| Key | Default |
|---|---|
| `governance.require_director_approval` | true |
| `privacy.research_purpose_enabled` | false (true once a research approval is recorded) |
| `device.default_css_px_per_mm` | 5.195 |
| `log.retention_days` | 1825 |

## 7. Canvases

### 7.1 Geometry schema (`packages/template-schemas/canvas.schema.json`)

```json
{
  "schema_version": 1,
  "canvas_type": "ILT_GRID",
  "units": "mm",
  "size": { "width": 175.0, "height": 95.0 },
  "boxes": [ { "id": 0, "row": 0, "col": 0, "x": 0.0, "y": 0.0, "w": 35.0, "h": 25.0 } ],
  "box_frame": { "style": "SOLID", "weight_mm": 0.3, "color": "#000000" },
  "dots": [
    { "id": "A", "x": 14.5, "y": 2.6,  "diameter_mm": 2.6, "role": "START" },
    { "id": "B", "x": 20.0, "y": 12.6, "diameter_mm": 2.6, "role": "TARGET" },
    { "id": "C", "x": 14.5, "y": 22.7, "diameter_mm": 2.6, "role": "END" }
  ],
  "lines": [],
  "letters": [],
  "background": null
}
```

- `dots` at the top level are **relative to each box** and repeat in every box (ILT). Intervention sheets instead list dots per box inside `letters`.
- `lines`: `{ "y": mm, "x1": mm, "x2": mm, "style": "SOLID|DASHED|DOTTED", "weight_mm": 0.3, "color": "#1565c0", "role": "BASE|MID|TOP|MARGIN" }`.
- `letters` (intervention): `{ "box_id": 0, "row_type": "TRACE_MODEL|START_DOT|FREEHAND", "letter": "ט", "dots": [{ "id": "1", "x":, "y":, "role": "START" }], "model_path": [[x,y],…], "allow_internal_lifts": false }`.
- `background`: `{ "asset_key": "canvases/<id>/bg.png", "x": 0, "y": 0, "width": mm, "height": mm }`.
- **Mirroring** (language setting) is applied by the gateway when dispatching: for every dot, `x' = box.w − x`; `model_path` mirrored the same way. The stored canvas never changes.
- **Validation:** size fits the tablet's screen at true size (DTH-A116: 211 × 132 mm, `DTH_A116.SCREEN_W_MM/SCREEN_H_MM`); every dot inside its box; unique ids; at least one box; fill order is a permutation of the box ids; for scored canvases a valid profile whose dots are on the canvas (`validateProfile`).

### 7.2 Scoring profile schema (`scoring-profile.schema.json`)

```json
{
  "dot_order": ["A", "B", "C"],
  "dots": {
    "A": { "radius_mm": 3.5, "weight_pct": 5,  "required": false },
    "B": { "radius_mm": 1.3, "weight_pct": 90, "required": true  },
    "C": { "radius_mm": 3.5, "weight_pct": 5,  "required": false }
  },
  "expected_pen_lifts_per_block": 15,
  "fill_order": [4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 14, 13, 12, 11, 10],
  "normal_speed_mm_s": null,
  "speed_flex_pct": 10
}
```

Constraints: weights total 100; `radius_mm` 0.0–5.0 (neighbouring ILT dots are 11.4 mm apart); `dot_order` lists existing dot ids; `fill_order` is a permutation of box ids.

Effective profile for a domain = `canvases.default_scoring_profile` deep-merged with `canvas_scoring_overrides.profile_patch` for that domain. Fill order for a canvas with no recorded sample is generated from the language's `fill_direction`: `RTL_ROWS` → each row from the highest column to 0, rows top to bottom; `LTR_ROWS` → columns 0 up.

### 7.3 Reference recordings

Both kinds run on a tablet paired in `REFERENCE` mode; the samples are stored compressed in `reference_recordings.samples` and processed with the same segmentation code as children's blocks (§8.1).

**Reference station (Phase 3d).** The System Administrator opens a station in the canvas screen (`POST /reference/stations`), which shows a 6-digit PIN (10 minutes, stored as a hash). The tablet types it on its usual PIN screen; `POST /sessions/pair` matches it after the open sessions and answers `mode: REFERENCE`, with a tablet token carrying `ref: true` and the station id in `session_id`. The station's room on the hub holds one run at a time: the tablet uses the same block flow as a session (`STEP_STARTED`, `BATCH` with `BATCH_ACK`, `BLOCK_COMPLETE` with the SHA-256), but the samples stay in memory and never reach `pen_samples`. On the tablet a reference page has an amber "reference recording" title bar and a [Done] button available at any time (pen tap); the administrator can also end it with `MANUAL_FINISH`. A sample block lifts the forward-only box lock (`free_order`): the active box is the box under the pen. Closing the station clears its token and the tablet returns to the PIN screen.

**Where a recording goes.** The canvas's own profile changes only in a **Draft** (an Active canvas is never edited, FR-CAN-3: create a new version, record, then activate with the director's approval). A **Domain** profile can be recorded for a Draft or Active canvas; [Accept] then needs the director's PIN, as any Domain override does, and merges the values into the Domain's patch. A recording on the canvas as stored is unmirrored; mirroring does not change box ids or the fill order.

| Kind | What's drawn | Derived values | On Accept |
|---|---|---|---|
| `SAMPLE_BLOCK_FILL` | One complete block by the System Administrator | `fill_order` = box ids in order of their first stroke (pen-down in the box, then within the entry margin); `pen_lifts` = strokes after merging gaps under `scoring.pen_lift.min_gap_ms` (§8.2); `complete` only when every box was written; `direction_order` and `direction_matches` (FR-CAN-14) | `fill_order` and `expected_pen_lifts_per_block` written into the profile (the Draft's, or the Domain's override) |
| `NORMAL_SPEED` | `rows` rows (default 1, up to 3) by a skilled writer | The first `rows` rows of the profile's fill order are scored with `scoreBlock`; `normal_speed_mm_s` = Σ line length ÷ Σ line time over those letters (§8.4); `complete` only when every letter of the rows was written and a line was measured | `normal_speed_mm_s` written into the profile |

Each `derived` also holds `previous` (the profile's values before) and `integrity_ok`. An incomplete recording can only be cleared.

[Clear] marks the recording `CLEARED` (kept for audit, never used). If the recorded fill order disagrees with the language fill direction, the admin screen shows a warning before Accept.

## 8. Scoring engine (`packages/ilt-metrics`)

Pure functions: `scoreBlock(samples, canvasResolved, profile, settings) → BlockScore`. Same code in the gateway (authoritative), the cockpit (live preview) and reference recordings. The Python analytics service never re-implements scoring; it reads stored results. Golden fixtures (sample files + expected JSON) live in `packages/ilt-metrics/fixtures` and run in CI.

### 8.1 Segmentation into letters

1. Merge strokes: a stroke is a run of `CONTACT` samples from `STROKE_START` to `STROKE_END`. If the gap from a stroke's end to the next stroke's start is **< `min_gap_ms`**, the two are one stroke (no lift).
2. Active box: starts at `fill_order[0]`. When a stroke **starts** inside box *k* (box rectangle grown by `ilt.box_entry_margin_mm`) and *k* comes later in the fill order than the current box, the active box becomes *k*; boxes passed over are **skipped**. A stroke starting elsewhere stays with the current box. (The tablet applies the same rule live and writes `box_id`; the server recomputes and logs any mismatch.)
3. A letter = all strokes assigned to one box. Boxes with no strokes are `SKIPPED` (passed over) or `EMPTY` (after the last written box).

### 8.2 Pen lifts

- `pen_lifts` (block) = number of merged strokes in the block. Every stroke ends in a lift, so 15 single-stroke letters give 15.
- `internal_pen_lifts` (letter) = strokes in the letter − 1.

### 8.3 Dot hits, order, width

For each dot *d* (mirrored geometry): `dist_d` = minimum distance from the dot centre to the letter's contact polyline (point-to-segment distance over consecutive contact samples within each stroke). `hit_d = dist_d ≤ radius_d`. `first_hit_t_d` = time of the first sample within `radius_d`.

- `pass_t_d` = `first_hit_t_d` if *d* is hit, otherwise the time of the sample closest to *d* (from `dot_closest`).
- `dot_order_ok` = the `pass_t` values of the dots, taken in `dot_order`, are strictly increasing. Dots don't need to be hit for the order check (A and C are optional on the ILT); a letter written C → B → A fails it.
- **Width**: `s = +1` if B lies to the right of the A–C midline, else `−1` (mirrored letter). `ext = max(s·x)` over the letter's contact samples; `width = (ext − s·x_first) + (ext − s·x_last)`. `width_in_band = |width − nominal| ≤ tolerance`. Recorded; scored only if `require_width_band`.

### 8.4 Line length, line time, speed

- Start sample: the first contact sample within `radius` of the first dot in `dot_order`. If none, the letter's first contact sample, and `line_start_fallback = true`.
- End sample: the last contact sample within `radius` of the last dot in `dot_order`. If none, the letter's last contact sample, and `line_end_fallback = true`.
- If the end comes before the start, both fall back.
- `line_length_mm` = sum of segment lengths between consecutive **contact** samples from start to end (segments across a lift are not counted).
- `line_time_ms` = `(t_end − t_start) / 1000` (includes any internal lift time).
- `speed_mm_s` = `line_length_mm / (line_time_ms / 1000)`; null if time is 0.
- Block `avg_speed_mm_s` = `Σ line_length_mm / Σ line_time_s` over written letters.

For intervention letters without a full dot set (rows 2–3), start and end are the letter's first and last contact samples.

### 8.5 Scores

```
letter.accuracy_score = Σ weight_pct[d] for every dot d with hit_d          (0..100)
letter.is_accurate    = all required dots hit
                        ∧ (¬require_dot_order        ∨ dot_order_ok)
                        ∧ (¬require_width_band       ∨ width_in_band)
                        ∧ (¬require_no_internal_lift ∨ internal_pen_lifts = 0
                                                     ∨ letter.allow_internal_lifts)

block.accuracy_score   = Σ letter.accuracy_score / letters_expected          (missing letters = 0)
block.accurate_letters = count(letter.is_accurate)

L = N·(1 − f),  U = N·(1 + f)                      N = normal_speed_mm_s, f = speed_flex_pct/100
block.speed_score = null                      if N is null or X is null    X = avg_speed_mm_s
                  = 100                       if L ≤ X ≤ U
                  = 100 / (L / X)             if X < L
                  = 100                       if X > U and policy = CAP_100
                  = 100 / (X / U)             if X > U and policy = SYMMETRIC_PENALTY

block.pen_lift_score = null                   if pen_lifts = 0
                     = min(100, 100 / (pen_lifts / E))    E = expected_pen_lifts_per_block

block.composite = (w_speed·speed + w_acc·accuracy + w_lift·pen_lift) / 100   null if any part is null
block.pass      = composite ≥ pass_threshold    null if either is null
```

Warm-up blocks and notebook pages are measured (raw data stored) but not scored: notebook pages report time only.

### 8.6 Time

`total_time_ms` = from the first `STROKE_START` in the first written box to the last `STROKE_END` in the last written box. `last_box_completed` = the last box in the fill order has a letter. `skipped_boxes` = count of `SKIPPED`. `active_writing_time_ms` = Σ stroke durations; `air_time_ms` = total − active.

### 8.7 Intervention marks

| Row | `auto_error` (system suggestion) |
|---|---|
| `TRACE_MODEL` | `true` unless every dot hit in order **and** (`internal_pen_lifts = 0` or `allow_internal_lifts`) |
| `START_DOT` | `start_point_ok` = first contact sample within the start dot's radius. Suggestion = `¬start_point_ok`; the evaluator confirms the form |
| `FREEHAND` | null (the evaluator decides); `similarity_hint` stored if enabled |

`final_error` = evaluator's value if set, else `auto_error`. Sheet `accuracy_score` = 100 × count(¬final_error) / marks. Speed and pen-lift scores use the letter canvas's profile.

### 8.8 Worked examples (golden tests)

| Case | Input | Expected |
|---|---|---|
| Speed in range | N = 19.45, f = 10%, X = 20.00 | 100 |
| Speed below range | N = 19.45, f = 10%, X = 15.00 → L = 17.505 | 100 / (17.505 / 15) = **85.69** (85.71 if L is first rounded to 17.50; the engine doesn't round) |
| Pen lifts | E = 15, X = 17 | 88.24 |
| Pen lifts below expected | E = 15, X = 14 | 100 (capped) |
| Accuracy | B hit, A missed, C hit, written top-down | 95; accurate = yes |
| Accuracy | A, B, C all hit, written bottom-up (C → B → A) | 100; accurate = **no** (order) |
| Accuracy | A and C hit, line passes 1.5 mm from B's centre (radius 1.3) | 10; accurate = no |
| Accuracy | Line passes 1.2 mm from B's centre (touches the printed dot) | B hit |
| Composite | speed 85.6898…, accuracy 95, pen lifts 88.2353… (unrounded) | 0.5·85.6898 + 0.25·95 + 0.25·88.2353 = 88.6537 → **88.65** |
| Perfect letter width | A (14.5, 2.6) → B (20.0, 12.6) → C (14.5, 22.7) | 11.0 mm |

### 8.9 Kinematics (analytics service)

For velocity, acceleration and jerk, each stroke is resampled to a uniform 4 ms grid (linear interpolation of x, y, pressure), then smoothed (Savitzky–Golay, window 7, order 3) before differentiation. Raw samples are never modified.

*Phase 4b (`services/analytics/ilt_analytics/kinematics.py`):*
- **Strokes:** a stroke is one raw contact stroke, pen-down to pen-up (§8.1). Short lifts are **not** merged as they are for pen lifts (§8.2), so no line is drawn through the air. A stroke takes the box of its first sample in a box.
- **Derivatives:** they come from the Savitzky–Golay filter itself (`deriv` 1 and 3, with `delta` 4 ms).
  - **Speed** is the tangential speed |v| in mm/s.
  - **Jerk** is the magnitude of the third derivative of position, in mm/s³.
- **Per-stroke measures:**
  - path length, ∫|v|dt;
  - mean speed, path length divided by duration;
  - peak speed;
  - **velocity peaks**: maxima of the speed whose prominence is at least 10 % of the stroke's peak speed;
  - mean jerk;
  - **normalised jerk**, √(½·∫|j|²dt·T⁵/L²), dimensionless (Teulings et al. 1997); a minimum-jerk stroke gives √360 ≈ 19;
  - mean pressure.
- **Short strokes:** strokes with fewer than 7 grid points (about 24 ms) are counted but not measured.
- **Summaries:**
  - **Per letter and per block:** strokes, writing time, path length, mean speed (total path divided by total measured time), peak speed, mean velocity peaks per stroke, mean of the strokes' mean and normalised jerk, and time-weighted mean pressure.
  - **Letter order:** letters are listed in writing order; strokes outside every box come last.
- **Database access:** the service reads `v_research_*` as `ilt_analyst`, using `ANALYST_DATABASE_URL`, or the host of `APP_DATABASE_URL` with `ILT_ANALYST_DB_PASSWORD`.
- **Network:** it listens on 127.0.0.1:8090 and is reached only through the gateway (§14). Nothing is stored; results are computed on each request.

## 9. Database (PostgreSQL 16 + TimescaleDB 2)

Migrations live in `infra/db/migrations` and are the executable form of this section.

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ===== Organisation, languages, users, devices =====
-- Domain = category grouping students for ILT testing (not geographic).
-- Region = geographic area. The two are independent (§6.1).
CREATE TABLE domains (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(30)  UNIQUE NOT NULL,
  name_he         VARCHAR(100) NOT NULL,
  name_en         VARCHAR(100) NOT NULL,
  description_he  TEXT NULL,
  description_en  TEXT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE regions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(30)  UNIQUE NOT NULL,
  name_he     VARCHAR(100) NOT NULL,
  name_en     VARCHAR(100) NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE languages (
  code         VARCHAR(8) PRIMARY KEY,           -- 'he', 'en'
  name_native  VARCHAR(50) NOT NULL,
  name_en      VARCHAR(50) NOT NULL,
  direction    VARCHAR(3)  NOT NULL CHECK (direction IN ('rtl', 'ltr')),
  is_enabled   BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              VARCHAR(255) UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,                       -- argon2id
  full_name          VARCHAR(100) NOT NULL,
  role               VARCHAR(20)  NOT NULL CHECK (role IN ('ADMIN', 'RESEARCHER', 'EVALUATOR', 'ANALYST')),
  director_pin_hash  TEXT NULL,                           -- argon2id; set = Research Director
  ui_language        VARCHAR(8)   NOT NULL DEFAULT 'he' REFERENCES languages(code),
  domain_id          INT NULL REFERENCES domains(id),     -- home scope for evaluators
  region_id          INT NULL REFERENCES regions(id),
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  failed_logins      SMALLINT     NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ  NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (director_pin_hash IS NULL OR role = 'RESEARCHER')
);

CREATE TABLE devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label               VARCHAR(50)  UNIQUE NOT NULL,       -- e.g. 'TAB-01'
  model               VARCHAR(50)  NOT NULL DEFAULT 'DTH-A116',
  css_px_per_mm       NUMERIC(6,3) NOT NULL DEFAULT 5.195,
  device_pixel_ratio  NUMERIC(4,2) NULL,
  screen_w_mm         REAL NULL,
  screen_h_mm         REAL NULL,
  calibrated_at       TIMESTAMPTZ  NULL,
  calibrated_by       UUID NULL REFERENCES users(id),
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ===== Settings =====
CREATE TABLE setting_definitions (
  key                         VARCHAR(100) PRIMARY KEY,
  category                    VARCHAR(20)  NOT NULL CHECK (category IN ('SCORING', 'ILT_PROCESS', 'LANGUAGE', 'GOVERNANCE', 'PRIVACY', 'DEVICE', 'LOG')),
  value_type                  VARCHAR(10)  NOT NULL CHECK (value_type IN ('integer', 'decimal', 'boolean', 'string', 'enum', 'json', 'uuid')),
  default_value               JSONB NULL,
  min_value                   NUMERIC NULL,
  max_value                   NUMERIC NULL,
  enum_values                 JSONB NULL,
  unit                        VARCHAR(20) NULL,
  override_scope              VARCHAR(10) NOT NULL CHECK (override_scope IN ('NONE', 'DOMAIN', 'REGION')),
  requires_director_approval  BOOLEAN NOT NULL DEFAULT FALSE,
  description_he              TEXT NOT NULL,
  description_en              TEXT NOT NULL
);

CREATE TABLE setting_values (
  id           BIGSERIAL PRIMARY KEY,
  key          VARCHAR(100) NOT NULL REFERENCES setting_definitions(key),
  scope        VARCHAR(10)  NOT NULL CHECK (scope IN ('SYSTEM', 'DOMAIN', 'REGION')),
  domain_id    INT NULL REFERENCES domains(id),
  region_id    INT NULL REFERENCES regions(id),
  value        JSONB NOT NULL,
  set_by       UUID NOT NULL REFERENCES users(id),
  approved_by  UUID NULL REFERENCES users(id),
  set_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope = 'SYSTEM' AND domain_id IS NULL AND region_id IS NULL)
      OR (scope = 'DOMAIN' AND domain_id IS NOT NULL AND region_id IS NULL)
      OR (scope = 'REGION' AND domain_id IS NULL AND region_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (key, scope, domain_id, region_id)
);
-- Value type/range are enforced by the gateway (zod). A trigger rejects a DOMAIN or
-- REGION value whose scope doesn't match setting_definitions.override_scope.

CREATE TABLE setting_value_history (
  id           BIGSERIAL PRIMARY KEY,
  key          VARCHAR(100) NOT NULL,
  scope        VARCHAR(10)  NOT NULL,
  domain_id    INT NULL,
  region_id    INT NULL,
  old_value    JSONB NULL,
  new_value    JSONB NULL,                 -- NULL = value removed (inherit again)
  changed_by   UUID NOT NULL REFERENCES users(id),
  approved_by  UUID NULL REFERENCES users(id),
  reason       TEXT NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Canvas library =====
CREATE TABLE canvas_sets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  language_code  VARCHAR(8)  NOT NULL REFERENCES languages(code),
  set_type       VARCHAR(25) NOT NULL CHECK (set_type IN ('ILT', 'NOTEBOOK', 'INTERVENTION_LETTERS')),
  name_he        VARCHAR(100) NOT NULL,
  name_en        VARCHAR(100) NOT NULL,
  sort_order     SMALLINT NOT NULL DEFAULT 0,
  is_active      BOOLEAN  NOT NULL DEFAULT TRUE,
  created_by     UUID NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (language_code, set_type, name_en)
);

CREATE TABLE canvases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_set_id            UUID NOT NULL REFERENCES canvas_sets(id),
  code                     VARCHAR(60) NOT NULL,          -- stable across versions, e.g. 'ILT_3X5_HE'
  version                  SMALLINT NOT NULL DEFAULT 1,
  status                   VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  canvas_type              VARCHAR(20) NOT NULL CHECK (canvas_type IN ('ILT_GRID', 'NOTEBOOK', 'INTERVENTION_SHEET')),
  name_he                  VARCHAR(100) NOT NULL,
  name_en                  VARCHAR(100) NOT NULL,
  geometry                 JSONB NOT NULL,                -- §7.1
  default_scoring_profile  JSONB NULL,                    -- §7.2; NULL for notebook canvases
  sort_order               SMALLINT NOT NULL DEFAULT 0,
  created_by               UUID NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at             TIMESTAMPTZ NULL,
  UNIQUE (code, version)
);
CREATE UNIQUE INDEX one_active_version ON canvases (code) WHERE status = 'ACTIVE';

CREATE TABLE canvas_scoring_overrides (
  canvas_id      UUID NOT NULL REFERENCES canvases(id),
  domain_id      INT  NOT NULL REFERENCES domains(id),
  profile_patch  JSONB NOT NULL,
  set_by         UUID NOT NULL REFERENCES users(id),
  approved_by    UUID NULL REFERENCES users(id),
  set_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canvas_id, domain_id)
);

CREATE TABLE reference_recordings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id     UUID NOT NULL REFERENCES canvases(id),
  kind          VARCHAR(20) NOT NULL CHECK (kind IN ('SAMPLE_BLOCK_FILL', 'NORMAL_SPEED')),
  domain_id     INT  NULL REFERENCES domains(id),          -- NULL = system default profile
  device_id     UUID NULL REFERENCES devices(id),
  recorded_by   UUID NOT NULL REFERENCES users(id),
  writer_label  VARCHAR(100) NULL,                          -- non-identifying, e.g. 'skilled adult writer'
  samples       BYTEA NOT NULL,                             -- gzip of §5.2 sample records
  derived       JSONB NOT NULL,                             -- fill_order, pen_lifts, normal_speed_mm_s, per-letter detail
  status        VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'CLEARED')),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ NULL
);
-- Phase 3d (migration 0003): reference_stations (id, created_by, language_code, pairing PIN hash and expiry,
-- tablet_token_id, calibration, paired_at, closed_at); reference_recordings adds station_id, rows_recorded,
-- sample_count, css_px_per_mm, decided_by, approved_by. ilt_app cannot DELETE reference_recordings (FR-CAN-11).

-- ===== Protocol templates =====
CREATE TABLE protocol_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(40) NOT NULL,
  version       SMALLINT NOT NULL DEFAULT 1,
  session_type  VARCHAR(15) NOT NULL CHECK (session_type IN ('DAY_1', 'DAY_2', 'DAY_14', 'INTERVENTION', 'CUSTOM')),
  name_he       VARCHAR(100) NOT NULL,
  name_en       VARCHAR(100) NOT NULL,
  steps         JSONB NOT NULL,    -- [{step_type, canvas_role, label_key, block_number, is_scored, video_key}]
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

-- ===== Participants, consent, ethics =====
CREATE TABLE participants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_code        VARCHAR(40) UNIQUE NOT NULL,
  domain_id         INT NOT NULL REFERENCES domains(id),
  region_id         INT NULL REFERENCES regions(id),
  school_code_hmac  CHAR(64) NULL,                -- HMAC-SHA256 with a server-side key
  grade_level       VARCHAR(15) NOT NULL CHECK (grade_level IN ('KINDERGARTEN', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6')),
  gender            VARCHAR(10) NOT NULL CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
  ses_group         VARCHAR(10) NULL CHECK (ses_group IN ('LOW', 'MID', 'HIGH')),
  dominant_hand     VARCHAR(15) NOT NULL CHECK (dominant_hand IN ('RIGHT', 'LEFT', 'AMBIDEXTROUS')),
  birth_year_month  DATE NULL CHECK (birth_year_month IS NULL OR EXTRACT(DAY FROM birth_year_month) = 1),
  cohort            VARCHAR(10) NOT NULL DEFAULT 'TABLET' CHECK (cohort IN ('TABLET', 'PAPER', 'LEGACY')),
  legacy_ref        VARCHAR(100) NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consent_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id       UUID NOT NULL REFERENCES participants(id),
  consent_version      VARCHAR(20) NOT NULL,
  signed_on            DATE NOT NULL,
  allows_hand_video    BOOLEAN NOT NULL DEFAULT FALSE,
  allows_research_use  BOOLEAN NOT NULL DEFAULT FALSE,
  allows_open_science  BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by          UUID NOT NULL REFERENCES users(id),
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at        TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX one_current_consent ON consent_records (participant_id) WHERE superseded_at IS NULL;

CREATE TABLE ethics_approvals (
  id             SERIAL PRIMARY KEY,
  approval_type  VARCHAR(25) NOT NULL CHECK (approval_type IN ('INTERVENTION_PROGRAM', 'RESEARCH', 'PREVIOUS_IRB')),
  authority      VARCHAR(100) NOT NULL,
  reference      VARCHAR(100) NULL,
  valid_from     DATE NULL,
  valid_to       DATE NULL,
  notes          TEXT NULL
);
-- Phase 3f (migration 0004): ethics_approvals adds created_by, created_at, withdrawn_at and a valid_from <= valid_to
-- check; participants adds updated_at; consent_version may not be blank. ilt_app cannot DELETE consent_records or
-- ethics_approvals: consent is a history (a new record supersedes the current one) and an approval is withdrawn, not deleted.

-- ===== Sessions, steps, blocks =====
CREATE TABLE sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_code          VARCHAR(20) UNIQUE NOT NULL,
  participant_id        UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  evaluator_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  domain_id             INT  NOT NULL REFERENCES domains(id),
  region_id             INT  NULL REFERENCES regions(id),
  language_code         VARCHAR(8) NOT NULL REFERENCES languages(code),
  purpose               VARCHAR(12) NOT NULL DEFAULT 'INTERVENTION' CHECK (purpose IN ('INTERVENTION', 'RESEARCH')),
  research_approval_id  INT NULL REFERENCES ethics_approvals(id),
  session_type          VARCHAR(15) NOT NULL CHECK (session_type IN ('DAY_1', 'DAY_2', 'DAY_14', 'INTERVENTION', 'CUSTOM')),
  protocol_template_id  UUID NOT NULL REFERENCES protocol_templates(id),
  status                VARCHAR(12) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'PAIRED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'ABORTED')),
  age_months            SMALLINT NULL,
  device_id             UUID NULL REFERENCES devices(id),
  css_px_per_mm         NUMERIC(6,3) NULL,           -- copied from the device at pairing
  device_pixel_ratio    NUMERIC(4,2) NULL,
  device_model          VARCHAR(50) NULL,
  settings_snapshot     JSONB NOT NULL,              -- all effective settings at creation (§6.1)
  video_enabled         BOOLEAN NOT NULL DEFAULT FALSE,  -- setting AND consent
  pairing_pin_hash      TEXT NULL,
  pairing_expires_at    TIMESTAMPTZ NULL,
  tablet_token_id       UUID NULL,          -- current pairing; NULL after release (migration 0002)
  abort_reason          VARCHAR(50) NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ NULL,
  completed_at          TIMESTAMPTZ NULL,
  CHECK (purpose <> 'RESEARCH' OR research_approval_id IS NOT NULL)
);
CREATE INDEX ON sessions (participant_id, session_type);
CREATE INDEX ON sessions (domain_id, region_id, created_at);

CREATE TABLE session_steps (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  step_index               SMALLINT NOT NULL,
  step_type                VARCHAR(20) NOT NULL CHECK (step_type IN ('VIDEO', 'WARMUP_BLOCK', 'ILT_BLOCK', 'NOTEBOOK_PAGE', 'PAPER_NOTEBOOK_PAGE', 'INTERVENTION_SHEET')),
  label_key                VARCHAR(50) NOT NULL,      -- translation key, e.g. 'step.ilt_block'
  block_number             SMALLINT NULL,             -- ILT 1..8, notebook 1..4, paper 1..2
  is_scored                BOOLEAN NOT NULL DEFAULT FALSE,
  canvas_id                UUID NULL REFERENCES canvases(id),
  mirrored                 BOOLEAN NOT NULL DEFAULT FALSE,
  fill_order               JSONB NULL,
  canvas_profile_snapshot  JSONB NULL,                -- effective scoring profile at dispatch
  video_key                VARCHAR(50) NULL,
  status                   VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'DONE', 'SKIPPED')),
  paper_duration_ms        INT NULL,                  -- PAPER_NOTEBOOK_PAGE only
  notes                    TEXT NULL,
  started_at               TIMESTAMPTZ NULL,
  completed_at             TIMESTAMPTZ NULL,
  UNIQUE (session_id, step_index)
);

CREATE TABLE block_attempts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_step_id         UUID NOT NULL REFERENCES session_steps(id) ON DELETE CASCADE,
  attempt_number          SMALLINT NOT NULL DEFAULT 1,
  status                  VARCHAR(15) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'MANUAL_FINISH', 'TIMED_OUT', 'REPEATED', 'ABORTED')),
  started_at              TIMESTAMPTZ NOT NULL,
  ended_at                TIMESTAMPTZ NULL,
  repeat_reason           VARCHAR(100) NULL,
  -- raw, settings-independent measures
  sample_count            INT NULL,
  raw_stroke_count        SMALLINT NULL,             -- pointerdown count before merging
  total_time_ms           INT NULL,
  active_writing_time_ms  INT NULL,
  air_time_ms             INT NULL,
  last_box_completed      BOOLEAN NULL,
  skipped_boxes           SMALLINT NULL,
  sha256                  CHAR(64) NULL,
  integrity_ok            BOOLEAN NULL,
  UNIQUE (session_step_id, attempt_number)
);

-- Settings-independent per-letter raw measures (instruction 4)
CREATE TABLE letter_measures (
  block_attempt_id   UUID NOT NULL REFERENCES block_attempts(id) ON DELETE CASCADE,
  box_id             SMALLINT NOT NULL,
  fill_position      SMALLINT NOT NULL,
  row_index          SMALLINT NOT NULL,
  status             VARCHAR(8) NOT NULL CHECK (status IN ('WRITTEN', 'SKIPPED', 'EMPTY')),
  t_start_us         INT NULL,
  t_end_us           INT NULL,
  stroke_count_raw   SMALLINT NULL,
  path_length_mm     REAL NULL,                 -- all contact segments in the box
  contact_time_ms    REAL NULL,
  dot_closest        JSONB NULL,                -- {"A": {"dist_mm": 0.8, "t_us": 1203400}, ...}
  width_mm           REAL NULL,
  mean_pressure      REAL NULL,
  PRIMARY KEY (block_attempt_id, box_id)
);

-- Versioned scores (recomputable with other settings)
CREATE TABLE score_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_attempt_id  UUID NOT NULL REFERENCES block_attempts(id) ON DELETE CASCADE,
  version           SMALLINT NOT NULL,
  is_current        BOOLEAN NOT NULL DEFAULT TRUE,
  settings_used     JSONB NOT NULL,             -- scoring settings
  profile_used      JSONB NOT NULL,             -- canvas scoring profile
  engine_version    VARCHAR(20) NOT NULL,       -- ilt-metrics package version
  reason            VARCHAR(200) NULL,          -- NULL for the original computation
  computed_by       UUID NULL REFERENCES users(id),
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  letters_expected  SMALLINT NOT NULL,
  pen_lifts         SMALLINT NULL,
  internal_pen_lifts SMALLINT NULL,
  accurate_letters  SMALLINT NULL,
  accuracy_score    NUMERIC(5,2) NULL,
  sum_line_length_mm REAL NULL,
  sum_line_time_ms  REAL NULL,
  avg_speed_mm_s    NUMERIC(8,3) NULL,
  speed_score       NUMERIC(5,2) NULL,
  pen_lift_score    NUMERIC(5,2) NULL,
  composite_score   NUMERIC(5,2) NULL,
  pass              BOOLEAN NULL,
  UNIQUE (block_attempt_id, version)
);
CREATE UNIQUE INDEX one_current_score ON score_versions (block_attempt_id) WHERE is_current;

CREATE TABLE letter_scores (
  score_version_id      UUID NOT NULL REFERENCES score_versions(id) ON DELETE CASCADE,
  box_id                SMALLINT NOT NULL,
  pen_lifts_internal    SMALLINT NULL,
  dots_hit              JSONB NULL,             -- {"A": true, "B": true, "C": false}
  dot_order_ok          BOOLEAN NULL,
  width_in_band         BOOLEAN NULL,
  line_length_mm        REAL NULL,
  line_time_ms          REAL NULL,
  speed_mm_s            REAL NULL,
  line_start_fallback   BOOLEAN NULL,
  line_end_fallback     BOOLEAN NULL,
  accuracy_score        NUMERIC(5,2) NULL,
  is_accurate           BOOLEAN NULL,
  PRIMARY KEY (score_version_id, box_id)
);

CREATE TABLE intervention_marks (
  block_attempt_id  UUID NOT NULL REFERENCES block_attempts(id) ON DELETE CASCADE,
  box_id            SMALLINT NOT NULL,
  row_type          VARCHAR(12) NOT NULL CHECK (row_type IN ('TRACE_MODEL', 'START_DOT', 'FREEHAND')),
  letter            VARCHAR(8) NOT NULL,
  auto_error        BOOLEAN NULL,
  start_point_ok    BOOLEAN NULL,
  evaluator_error   BOOLEAN NULL,
  final_error       BOOLEAN NULL,
  decided_by        VARCHAR(10) NULL CHECK (decided_by IN ('SYSTEM', 'EVALUATOR')),
  decided_by_user   UUID NULL REFERENCES users(id),
  decided_at        TIMESTAMPTZ NULL,
  similarity_hint   NUMERIC(5,2) NULL,          -- never used in scores
  PRIMARY KEY (block_attempt_id, box_id)
);

-- ===== Pen telemetry (raw samples) =====
CREATE TABLE pen_samples (
  block_attempt_id  UUID NOT NULL REFERENCES block_attempts(id) ON DELETE CASCADE,
  sample_seq        INT  NOT NULL,
  sample_time       TIMESTAMPTZ NOT NULL,       -- block_attempts.started_at + t_us (partition column)
  t_us              INT  NOT NULL,
  x_mm              REAL NOT NULL,
  y_mm              REAL NOT NULL,
  pressure          REAL NOT NULL,              -- raw
  tilt_x            SMALLINT NOT NULL DEFAULT 0,
  tilt_y            SMALLINT NOT NULL DEFAULT 0,
  flags             SMALLINT NOT NULL,
  box_id            SMALLINT NOT NULL,          -- 255 = none
  PRIMARY KEY (block_attempt_id, sample_seq, sample_time)
);
SELECT create_hypertable('pen_samples', 'sample_time', chunk_time_interval => INTERVAL '7 days');
ALTER TABLE pen_samples SET (timescaledb.compress,
  timescaledb.compress_segmentby = 'block_attempt_id', timescaledb.compress_orderby = 'sample_seq');
SELECT add_compression_policy('pen_samples', INTERVAL '30 days');
-- Inserts use ON CONFLICT DO NOTHING: resent batches are harmless.

-- ===== Instruction video library (per key and language) =====
CREATE TABLE instruction_videos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_key      VARCHAR(50) NOT NULL,            -- 'intro', 'notebook_demo'
  language_code  VARCHAR(8)  NOT NULL REFERENCES languages(code),
  version        SMALLINT    NOT NULL DEFAULT 1,
  status         VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  title_he       VARCHAR(100) NOT NULL,
  title_en       VARCHAR(100) NOT NULL,
  object_key     VARCHAR(512) NOT NULL,           -- S3 object key, e.g. 'videos/intro/he/v1.mp4'
  source_name    VARCHAR(255) NULL,               -- original file name
  duration_ms    INT NULL,
  sha256         CHAR(64) NOT NULL,
  uploaded_by    UUID NULL REFERENCES users(id),
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_key, language_code, version)
);
CREATE UNIQUE INDEX one_active_video ON instruction_videos (video_key, language_code) WHERE status = 'ACTIVE';

-- ===== Recorded hand video, paper cohort, legacy =====
CREATE TABLE session_video_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  object_key      VARCHAR(512) NOT NULL,        -- S3 object key
  camera_label    VARCHAR(50) NOT NULL DEFAULT 'OVERHEAD_HANDS',
  started_at      TIMESTAMPTZ NOT NULL,
  duration_ms     INT NULL,
  sync_offset_ms  INT NOT NULL DEFAULT 0,
  sha256          CHAR(64) NOT NULL
);

CREATE TABLE paper_block_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    UUID NOT NULL REFERENCES participants(id),
  session_type      VARCHAR(15) NOT NULL CHECK (session_type IN ('DAY_1', 'DAY_2', 'DAY_14')),
  block_number      SMALLINT NOT NULL,
  pen_lifts         SMALLINT NULL,
  accurate_letters  SMALLINT NULL CHECK (accurate_letters BETWEEN 0 AND 15),
  total_time_ms     INT NULL,
  notes             TEXT NULL,
  entered_by        UUID NOT NULL REFERENCES users(id),
  entered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, session_type, block_number)
);

CREATE TABLE legacy_block_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id   UUID NOT NULL REFERENCES participants(id),
  import_batch_id  UUID NOT NULL,
  source_file      VARCHAR(255) NOT NULL,
  session_label    VARCHAR(50) NOT NULL,
  block_number     SMALLINT NOT NULL,
  pen_lifts        SMALLINT NULL,          -- "Hand Raises"
  width_mm         REAL NULL,              -- "Segment Width"
  total_time_ms    INT NULL,               -- "Total Time"
  writing_time_ms  INT NULL,               -- "Writing Time"
  air_time_ms      INT NULL,               -- "Air Time"
  raw_row          JSONB NOT NULL,         -- the original row, untouched
  imported_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Application log (instruction 6) =====
CREATE TABLE app_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity        VARCHAR(8)  NOT NULL CHECK (severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'SECURITY')),
  event_type      VARCHAR(80) NOT NULL,          -- §12 vocabulary
  actor_user_id   UUID NULL,
  actor_role      VARCHAR(20) NULL,
  device_id       UUID NULL,
  domain_id       INT NULL,
  region_id       INT NULL,
  session_id      UUID NULL,
  entity_type     VARCHAR(40) NULL,
  entity_id       VARCHAR(64) NULL,
  correlation_id  UUID NULL,                     -- one per HTTP request / control event
  client_ip       INET NULL,
  message         TEXT NOT NULL,                 -- English, for search; the UI translates by event_type
  details         JSONB NOT NULL DEFAULT '{}',
  search_text     TSVECTOR GENERATED ALWAYS AS
                  (to_tsvector('simple', message || ' ' || event_type || ' ' || details::text)) STORED,
  PRIMARY KEY (id, occurred_at)
);
SELECT create_hypertable('app_events', 'occurred_at', chunk_time_interval => INTERVAL '30 days');
CREATE INDEX ON app_events (event_type, occurred_at DESC);
CREATE INDEX ON app_events (session_id, occurred_at DESC);
CREATE INDEX ON app_events (actor_user_id, occurred_at DESC);
CREATE INDEX ON app_events (domain_id, region_id, occurred_at DESC);
CREATE INDEX ON app_events USING GIN (details jsonb_path_ops);
CREATE INDEX ON app_events USING GIN (search_text);

-- ===== Research views (analysts see only these) =====
CREATE VIEW v_research_sessions AS
SELECT s.id AS session_id, p.study_code, p.domain_id, p.region_id, p.school_code_hmac,
       p.grade_level, p.gender, p.ses_group, p.dominant_hand, p.cohort,
       s.session_type, s.language_code, s.age_months, s.device_model, s.css_px_per_mm,
       s.settings_snapshot, s.started_at, s.completed_at
FROM sessions s
JOIN participants p ON p.id = s.participant_id
JOIN consent_records c ON c.participant_id = p.id AND c.superseded_at IS NULL
WHERE s.purpose = 'RESEARCH' AND c.allows_research_use AND s.status = 'COMPLETED';

CREATE VIEW v_research_blocks AS
SELECT rs.session_id, rs.study_code, st.step_type, st.block_number, c.code AS canvas_code, c.version AS canvas_version,
       st.mirrored, b.id AS block_attempt_id, b.attempt_number, b.status, b.total_time_ms,
       b.active_writing_time_ms, b.air_time_ms, b.last_box_completed, b.skipped_boxes,
       sv.version AS score_version, sv.pen_lifts, sv.internal_pen_lifts, sv.accurate_letters,
       sv.accuracy_score, sv.avg_speed_mm_s, sv.speed_score, sv.pen_lift_score, sv.composite_score, sv.pass
FROM v_research_sessions rs
JOIN session_steps st ON st.session_id = rs.session_id
LEFT JOIN canvases c ON c.id = st.canvas_id
JOIN block_attempts b ON b.session_step_id = st.id
LEFT JOIN score_versions sv ON sv.block_attempt_id = b.id AND sv.is_current;

CREATE VIEW v_research_letters AS
SELECT rb.session_id, rb.block_attempt_id, lm.box_id, lm.fill_position, lm.row_index, lm.status,
       lm.t_start_us, lm.t_end_us, lm.stroke_count_raw, lm.path_length_mm, lm.contact_time_ms,
       lm.dot_closest, lm.width_mm, lm.mean_pressure, ls.dots_hit, ls.dot_order_ok, ls.width_in_band,
       ls.line_length_mm, ls.line_time_ms, ls.speed_mm_s, ls.accuracy_score, ls.is_accurate
FROM v_research_blocks rb
JOIN letter_measures lm ON lm.block_attempt_id = rb.block_attempt_id
LEFT JOIN score_versions sv ON sv.block_attempt_id = rb.block_attempt_id AND sv.is_current
LEFT JOIN letter_scores ls ON ls.score_version_id = sv.id AND ls.box_id = lm.box_id;

CREATE VIEW v_research_samples AS
SELECT ps.* FROM pen_samples ps
WHERE ps.block_attempt_id IN (SELECT block_attempt_id FROM v_research_blocks);

-- ===== Database roles =====
-- ilt_owner: migrations only.
-- ilt_app (gateway, analytics): read/write on application tables; INSERT + SELECT only on app_events,
--   pen_samples and setting_value_history (no UPDATE/DELETE).
-- ilt_analyst (analyst portal, direct BI access): SELECT on v_research_* only.
-- Phase 4a (migration 0005): v_research_sessions adds session_code; v_research_blocks adds step_index, is_scored,
-- label_key, fill_order, canvas_id and sample_count; new v_research_canvases (canvas id, code, version, geometry: no
-- personal data). ilt_analyst may also read domains and regions (names for the filters). ilt_app is a member of
-- ilt_analyst: the gateway answers every /research route in a transaction after SET LOCAL ROLE ilt_analyst.
REVOKE UPDATE, DELETE, TRUNCATE ON app_events, setting_value_history FROM PUBLIC;
```

## 10. Seed data (`infra/db/seed`)

The seed is a TypeScript script, not literal SQL hashes:

| Item | Content |
|---|---|
| Languages | `he` עברית rtl, `en` English ltr |
| Domains | One domain, `GENERAL` (כללי / General). The System Administrator creates the real student groupings |
| Regions | The six education districts: Central, Tel Aviv, Haifa, Jerusalem, Northern, Southern (Hebrew and English names) |
| Users (dev only) | `dev-admin@ilt.local` ADMIN, `dev-director@ilt.local` RESEARCHER with director PIN, `dev-evaluator@ilt.local` EVALUATOR, `dev-analyst@ilt.local` ANALYST. Passwords and PIN read from `.env` (`SEED_DEV_PASSWORD`, `SEED_DIRECTOR_PIN`) and hashed with argon2id at seed time. Never run in production |
| Device | `TAB-01`, DTH-A116, 5.195 px/mm, DPR 1.75 |
| Setting definitions | The full §6.2 catalogue with defaults; no setting values (everything inherits defaults) |
| Ethics | `INTERVENTION_PROGRAM` (Chief Scientist, reference to be entered); `PREVIOUS_IRB` 287/8918/2015. No `RESEARCH` row until approval |
| Canvas sets and canvases | he: ILT set → `ILT_3X5_HE` (ACTIVE, geometry from `ILT_Day1_Grid_Geometry.json` v3, profile §7.2 with RTL fill order); NOTEBOOK set → `NOTEBOOK_HE` (ACTIVE, 3 writing rows × 5 letters on school-notebook ruling); INTERVENTION_LETTERS set → letter sheets as DRAFT until the dot positions are measured and checked. en: `ILT_3X5_EN` (same geometry, LTR fill order `[0..14]`), `NOTEBOOK_EN` |
| Protocol templates | `DAY_1`, `DAY_2`, `DAY_14`, `INTERVENTION` as in FRS §6 |
| Instruction videos | `intro` / `he` v1 ACTIVE: uploaded to S3 storage from `Documents/08_Presentations_and_Demos/ILT_Instruction_Demo_v6_No_Avatar_Hebrew_Female_VO.mp4` (1:19, Hebrew female voice-over), SHA-256 computed at seed time. `notebook_demo` / `he` v1 ACTIVE: from `Documents/08_Presentations_and_Demos/ILT_in_Notebook_Demo.mp4` (0:31). No English videos yet (FRS FR-PLAN-8 applies) |

Day 1 template steps:

```json
[
  {"step_type": "VIDEO", "video_key": "intro", "label_key": "step.video_intro"},
  {"step_type": "WARMUP_BLOCK", "canvas_role": "ILT", "label_key": "step.warmup", "is_scored": false},
  {"step_type": "ILT_BLOCK", "canvas_role": "ILT", "block_number": 1, "is_scored": true},
  {"step_type": "ILT_BLOCK", "canvas_role": "ILT", "block_number": 2, "is_scored": true},
  {"step_type": "ILT_BLOCK", "canvas_role": "ILT", "block_number": 3, "is_scored": true},
  {"step_type": "ILT_BLOCK", "canvas_role": "ILT", "block_number": 4, "is_scored": true},
  {"step_type": "VIDEO", "video_key": "notebook_demo", "label_key": "step.video_notebook"},
  {"step_type": "NOTEBOOK_PAGE", "canvas_role": "NOTEBOOK", "block_number": 1, "is_scored": false},
  {"step_type": "NOTEBOOK_PAGE", "canvas_role": "NOTEBOOK", "block_number": 2, "is_scored": false},
  {"step_type": "NOTEBOOK_PAGE", "canvas_role": "NOTEBOOK", "block_number": 3, "is_scored": false},
  {"step_type": "NOTEBOOK_PAGE", "canvas_role": "NOTEBOOK", "block_number": 4, "is_scored": false},
  {"step_type": "ILT_BLOCK", "canvas_role": "ILT", "block_number": 5, "is_scored": true},
  {"step_type": "ILT_BLOCK", "canvas_role": "ILT", "block_number": 6, "is_scored": true},
  {"step_type": "ILT_BLOCK", "canvas_role": "ILT", "block_number": 7, "is_scored": true},
  {"step_type": "ILT_BLOCK", "canvas_role": "ILT", "block_number": 8, "is_scored": true}
]
```

`canvas_role` is resolved through the session language's settings (`language.L.ilt_canvas`, `language.L.notebook_canvas`, `language.L.letter_set`) when the session is created; the evaluator may change it in the preview.

## 11. State machines

### 11.1 Cockpit (per session)

| State | Event | Next | Action |
|---|---|---|---|
| `PLANNED` | Evaluator opens the session | `ROOM_OPEN` | Generate 6-digit PIN (hashed, expires in 10 min), show it |
| `ROOM_OPEN` | `PAIRING_REQUEST` with correct PIN | `PAIRED` | Copy device calibration to the session; show study code |
| `PAIRED` / `STEP_REVIEW` | Next step exists | `STEP_PREVIEW` | Show the step, its canvas (changeable), timers |
| `STEP_PREVIEW` | Dispatch (video) | `VIDEO_PLAYING` | `VIDEO_PLAY` |
| `VIDEO_PLAYING` | `VIDEO_ENDED` or skip | `STEP_REVIEW` | Mark step done |
| `STEP_PREVIEW` | Dispatch (writing step) | `STEP_ACTIVE` | `DISPATCH_STEP`, live mirror on |
| `STEP_PREVIEW` | Dispatch (paper page) | `PAPER_TIMING` | Show start/stop timer |
| `PAPER_TIMING` | Stop | `STEP_REVIEW` | Save duration and notes (`POST /sessions/:id/steps/:index/paper`); the timer can be stopped and continued before saving |
| any (no step running) | [Next step] | per step type | Runs the first step not yet done: dispatches a writing step, plays a video, or scrolls to the paper page's timer |
| `STEP_ACTIVE` | `INACTIVITY_ALERT` CUE | `STEP_ACTIVE` | Show idle time |
| `STEP_ACTIVE` | `INACTIVITY_ALERT` AMBER | `STEP_ACTIVE` | Amber panel, Manual Finish flashes |
| `STEP_ACTIVE` | Last house reached (notebook page: the last row) and no pen contact for `inactivity_last_box_sec` | `STEP_ACTIVE` | Manual Finish becomes available: amber and blinking (no blink under reduced motion); before that it stays lightened and disabled. Inactivity counts time without pen contact; hover does not reset it |
| `STEP_ACTIVE` | Pause | `PAUSED` | `PAUSE_SESSION`, reason logged |
| `PAUSED` | Resume | `STEP_ACTIVE` | `RESUME_SESSION` |
| `STEP_ACTIVE` | Manual finish / `BLOCK_COMPLETE` | `SCORING` | Wait for persistence ACK of the last sample, then score |
| `SCORING` | `BLOCK_SCORED` | `STEP_REVIEW` | Show block result (components next to the composite, never instead of them, with [Replay]); for intervention, the marking form with suggestions |
| `STEP_REVIEW` | Repeat block | `STEP_ACTIVE` | Attempt 1 → `REPEATED`; `REPEAT_BLOCK`; attempt 2 starts |
| `STEP_REVIEW` | No steps left | `SESSION_COMPLETE` | `SESSION_COMPLETE`, open the comparative summary |
| any | Abort | `ABORTED` | `ABORT_SESSION`, partial data kept |
| any | Link lost > 6 s | same + banner | Tablet keeps buffering; resume when back |

**Ink colours (FR-COCK-1, mirror and replay):** contact ink is coloured by the raw pressure in three bands: light < 0.20 green, medium 0.20–0.40 blue, firm ≥ 0.40 red. The in-air hover path is yellow. A legend under the mirror and the replay names the bands. The bands are a display aid only; the stored pressure is never rescaled. The tablet itself always draws plain blue ink.

**Staff screens:** the cockpit offers a light, dark or "like the computer" theme, kept per browser. The writing canvas stays white in both themes. The tablet kiosk has no dark theme.

### 11.2 Tablet kiosk

| State | Event | Next | Action |
|---|---|---|---|
| `IDLE` | Evaluator's PIN entered | `PAIRING` | `PAIRING_REQUEST` |
| `PAIRING` | Accepted | `WAITING` | Show friendly waiting screen in the session language |
| `WAITING` | `DISPATCH_STEP` (writing) | `TRANSITION` | Show canvas preview, countdown `in_transition_sec` |
| `TRANSITION` | Countdown ends | `WRITING` | `STEP_STARTED`, capture on, touch off |
| `WAITING` / `UPLOADING` | `DISPATCH_STEP` with `immediate` | `WRITING` | No countdown (the child pressed [Next block]) |
| `WRITING` | Pen-down in a box already passed in the fill order (finished or skipped) | `WRITING` | Ignored: no ink, no contact samples (forward-only locking, FR-TAB-4). On a notebook page the locked unit is a whole earlier row, because letters are written freely along the lines |
| `WRITING` | End of page: a stroke in the last house (notebook page: at least one stroke per letter cell in the last row) | `WRITING` | [Next block] becomes available (pen tap only) |
| any | Tap outside the canvas while the browser is not full screen | same | Return to full screen (needs a user gesture; strokes on the canvas never trigger it) |
| `WRITING` | [Next block], `MANUAL_FINISH`, or timeout | `UPLOADING` | Lock canvas, `BLOCK_COMPLETE` with SHA-256 |
| `UPLOADING` | All batches ACKed | `WAITING` | — |
| `WRITING` | `PAUSE_SESSION` | `PAUSED` | Freeze timers, rest overlay |
| `PAUSED` | `RESUME_SESSION` | `WRITING` | — |
| `WAITING` | `VIDEO_PLAY` | `VIDEO` | Download with the tablet token, play full screen; if the browser refuses autoplay with sound, a "tap to play" button; at the end `VIDEO_ENDED` → `WAITING` |
| `VIDEO` | `VIDEO_ENDED` (STOPPED by the evaluator) | `WAITING` | Close the video |
| `WRITING` | No pen contact for the CUE / AMBER time | `WRITING` | Soft amber glow around the page (CUE); `INACTIVITY_ALERT`; the next pen contact clears it. A pause does not count |
| `WAITING` | `REFERENCE_START` | `REFERENCE` | Banner "reference recording"; same capture |
| any | `ABORT_SESSION` / `SESSION_COMPLETE` | `IDLE` | Clear screen, keep unsent buffers until ACKed |

## 12. Application log

- **Writers:** the gateway and analytics services write each event to **stdout as one JSON line** (pino) and to `app_events` (batched, at most 1 s delay). The tablet and cockpit send their events through the gateway (`POST /api/v1/log/client`), never directly.
- **Fields:** exactly the `app_events` columns. `message` is English; the search screen shows a translated label per `event_type`.
- **No child-identifying data** in any log line (study codes only).
- **Vocabulary** (`area.object.action`), extended only by adding to `packages/shared-types/log-events.ts`:

| Area | Event types |
|---|---|
| auth | `auth.login.succeeded`, `auth.login.failed`, `auth.logout`, `auth.account.locked`, `auth.director_pin.verified`, `auth.director_pin.failed` |
| users | `users.user.created`, `users.user.updated`, `users.user.deactivated` (details list the changed fields with old and new values; a password or PIN change is recorded only as `reset`, `set`, `changed` or `removed`) |
| organisation | `organisation.domain.created`, `organisation.domain.updated`, `organisation.region.created`, `organisation.region.updated` |
| participants | `participants.participant.created`, `participants.participant.updated` (changed fields with old and new values; the school only as `changed`; deactivation and reactivation), `participants.consent.recorded` (old and new version, date and permissions) |
| ethics | `ethics.approval.created`, `ethics.approval.updated` (changed fields, withdrawn or restored) |
| sessions | `session.created`, `session.paired`, `session.step.dispatched`, `session.step.started`, `session.box.advanced`, `session.inactivity.cue`, `session.inactivity.amber`, `session.paused`, `session.resumed`, `session.block.completed`, `session.block.manual_finish`, `session.block.interrupted`, `session.block.repeated`, `session.block.scored`, `session.paper_page.timed`, `session.completed`, `session.aborted`, `session.link.lost`, `session.link.restored`, `session.tablet.released` |
| telemetry | `telemetry.batch.rejected` (CRC/format), `telemetry.integrity.failed`, `telemetry.box_mismatch` |
| intervention | `intervention.mark.suggested`, `intervention.mark.changed` (old/new) |
| settings | `settings.value.changed` (old/new/approver), `settings.value.removed`, `settings.override.changed` |
| canvases | `canvas.set.created`, `canvas.set.updated`, `canvas.uploaded`, `canvas.updated`, `canvas.deleted`, `canvas.version.created`, `canvas.validated`, `canvas.activated` (with the retired version and the approver), `canvas.retired`, `canvas.override.changed` (old/new patch, approver), `canvas.reference.paired`, `canvas.reference.started` (preview or recording sent to the tablet), `canvas.reference.recorded` (derived summary, integrity), `canvas.reference.accepted` (values, old/new profile or patch, approver), `canvas.reference.cleared` |
| scores | `scores.recomputed` |
| data | `data.export.created`, `data.replay.opened`, `data.kinematics.opened`, `data.legacy.imported`, `data.paper_scores.entered` |
| system | `system.error`, `system.service.started`, `system.service.stopped` |

- **Search screen** (admin): time range, event types (multi-select by area), user, session code, domain/region, severity, free text (uses `search_text`); results paged, newest first; CSV export (logged as `data.export.created`).
  - *Phase 3e:* the **Action log** tab of the Administrator cockpit. The time range defaults to the last 7 days (quick links: 24 hours, 7 days, 30 days, any time); no event type or severity selected means all. Free text: every word must appear, and a word may be the start of a token (the text is split by the same `simple` parser that built `search_text`, each lexeme becoming a prefix term joined with `&`), so `S2611` finds `S261105-JMZW` and `QA3F-01`, stored as `qa3f` and the signed number `-01`, finds itself. Pages of 100, newest first, with a keyset cursor `(occurred_at, id)` kept to the microsecond; the first page counts the matches up to 10,000. Each entry shows its translated label and code; a click shows the email, record, device, address and `details`.
  - *CSV:* the current filter, newest first, at most 50,000 rows (the response says when it was cut). UTF-8 with a BOM (Excel opens the Hebrew correctly), CRLF lines, every cell quoted, and a cell starting with `= + - @` prefixed with `'` so a spreadsheet never runs it as a formula. Columns: `occurred_at` (UTC ISO), `severity`, `event_type`, `user_email`, `user_name`, `role`, `device_id`, `domain`, `region`, `session_code`, `entity_type`, `entity_id`, `client_ip`, `message`, `details` (JSON). The export is logged as `data.export.created` with the filter and row count.
- **Retention:** `log.retention_days` (default 5 years) via a TimescaleDB retention policy.

## 13. Internationalisation

| Item | Implementation |
|---|---|
| Library | `i18next` + `react-i18next`; ICU plurals |
| Files | `packages/i18n/src/locales/he.ts`, `en.ts`; keys by screen (`cockpit.telemetry.avg_speed`). The English file is typed against the Hebrew one, and a test fails on a missing or empty key |
| Direction | `<html lang dir>` set from the interface language; components use CSS **logical properties** (`margin-inline-start`, `inset-inline-end`, `text-align: start`) only, enforced by stylelint |
| Mixed text | Study codes, numbers and English terms wrapped in `<bdi>`; numbers formatted with `Intl.NumberFormat`, dates with `Intl.DateTimeFormat` in the interface locale |
| Icons | Direction-dependent icons (arrows, next/back, progress) flip with `dir`; the writing canvas never does |
| Fonts | Self-hosted Noto Sans Hebrew and Noto Sans (no internet at run time) |
| Child language | The tablet uses the **session language**, which may differ from the evaluator's interface language |
| Administrator content | Names of canvases, templates, domains stored in Hebrew and English columns |

## 14. REST API (gateway, `/api/v1`, JSON, JWT access token 15 min + refresh token 8 h)

| Method | Path | Roles | Purpose |
|---|---|---|---|
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout` | public / any | Authentication. Refresh reads the role and `is_active` again, so a role change or deactivation applies within one access-token lifetime (15 min); the response includes the current `role` |
| GET/POST/PATCH | `/users` · `PATCH /users/:id` | ADMIN | User management (FR-ROLE). GET takes `q` (part of the name or email), `role`, `active` (`true`/`false`) and returns `has_director_pin` and `locked`, never a hash. POST: `email` (unique, lower-cased; 409 `EMAIL_TAKEN`), `full_name`, `role`, `ui_language`, `domain_id`, `region_id`, `password` (≥ 12 characters), `director_pin` (6 digits, RESEARCHER only). PATCH: the same fields except `email`, plus `is_active`, `unlock: true`; `password` resets it and clears the lock; `director_pin: null` removes it, and a role change away from RESEARCHER removes it too. An administrator can't deactivate themself or change their own role (409 `SELF_CHANGE`). Logged as `users.user.*` with severity SECURITY |
| GET/POST/PATCH | `/domains`, `/regions` · `PATCH /domains/:id`, `/regions/:id` | ADMIN (write), all (read) | Student-grouping Domains and geographic Regions (FR-ORG-1/2). GET lists the active ones; `?all=true` (ADMIN) adds the deactivated. POST: `code` (`A–Z 0–9 _`, 2–30, upper-cased, unique, 409 `CODE_TAKEN`; never changes later), `name_he`, `name_en`, and for Domains `description_he`, `description_en`. PATCH: names, descriptions, `is_active`. The last active Domain can't be deactivated (409 `LAST_DOMAIN`). A deactivated Domain or Region is no longer offered for new participants or users; existing records keep it |
| GET | `/languages` | all | Enabled languages |
| GET | `/settings/definitions` | ADMIN, RESEARCHER | Catalogue |
| GET | `/settings/effective?domain=&region=` | all | Resolved values with their source scope |
| PUT/DELETE | `/settings/values/:key` | ADMIN (+ director PIN when required) | Set or remove a value at a scope |
| GET | `/canvases?language=&type=&mirrored=` | all | Active canvases of a language (geometry and profile) |
| GET/POST/PATCH | `/canvas-sets` · `PATCH /canvas-sets/:id` | ADMIN | Canvas library (FR-CAN-1): GET lists every set with all its canvas versions (no geometry) and the number of Domain overrides. POST: `language_code`, `set_type` (`ILT`, `NOTEBOOK`, `INTERVENTION_LETTERS`), `name_he`, `name_en` (unique per language and type, any case; 409 `NAME_TAKEN`). PATCH: names, `is_active` (an inactive set takes no new canvases). Logged as `canvas.set.created/updated` |
| GET | `/canvases/:id/detail` | ADMIN | One canvas: geometry, profile, `issues` (what stops activation), `versions` of the code, Domain `overrides` (patch, set by, approved by), `used_by` (settings at any scope, and catalogue defaults, that name the code) and the number of session steps that used it |
| POST/PATCH/DELETE | `/canvases` · `/canvases/:id` | ADMIN | Load a canvas as a Draft, version 1 of a new code (FR-CAN-2): `canvas_set_id`, `code` (`A–Z 0–9 _`, 2–60, upper-cased, unique; 409 `CODE_TAKEN`), names, `geometry` (§7.1 schema, 400 `BAD_GEOMETRY` with the schema issues; its `canvas_type` must match the set, 400 `WRONG_CANVAS_TYPE`), optional `profile` (without it a starter profile is made: the canvas dots in order, equal weights, nothing required, one pen lift per box, empty fill order, flexibility 10%). PATCH edits a Draft only (names, geometry, profile; 409 `NOT_DRAFT`) and returns its `issues`. DELETE removes a Draft no session used (409 `CANVAS_USED`). There is no background-image upload yet |
| POST | `/canvases/:id/versions` | ADMIN | A new Draft copied from any version of the code, numbered max + 1; one Draft per code (409 `DRAFT_EXISTS`, `details.id`) |
| POST | `/canvases/:id/validate` | ADMIN | `{issues}`: `DOES_NOT_FIT` (larger than the DTH-A116 screen at true size, 211 × 132 mm), `DOT_OUTSIDE_BOX`, `DUPLICATE_ID`, `BAD_FILL_ORDER`, `BAD_PROFILE` (§7.2 schema, dot weights total 100), `UNKNOWN_DOT` (profile scores a dot not on the ILT canvas), `NO_PROFILE` (ILT and intervention canvases). Logged as `canvas.validated` |
| POST | `/canvases/:id/activate` | ADMIN (+ PIN) | Draft only, with no issues (400 `CANVAS_INVALID`). A scored canvas (ILT, intervention) puts a scoring profile into use, so a Research Director approves it when `governance.require_director_approval` is on (`director_email`, `director_pin`; 403 `DIRECTOR_PIN`). In one transaction the previous Active version of the code is retired and its Domain overrides are copied to the new version. Settings name a canvas by code, so new sessions get the new version at once |
| POST | `/canvases/:id/retire` | ADMIN | Active only (409 `NOT_ACTIVE`). Refused while a setting at any scope, or a catalogue default, names the code (409 `CANVAS_IN_USE`, `details.uses`) |
| PUT | `/canvases/:id/overrides/:domainId` | ADMIN (+ PIN) | Domain scoring override (FR-CAN-8): `{profile}` is the whole profile the Domain should use; only the values that differ from the canvas profile are stored as `profile_patch` (none left removes the override); `{reset: true}` removes it. The merged profile is checked (400 `CANVAS_INVALID`). A Research Director approves it when approval is on. Not for Retired canvases (409 `RETIRED`) or notebook pages (409 `NOT_SCORED`). `POST /sessions` merges the participant's Domain patch into the canvas profile and stores the result in `canvas_profile_snapshot` |
| POST | `/reference/stations` | ADMIN | Opens a reference station (`language_code` optional, default the admin's language): `{id, pin, expires_at}` (Phase 3d) |
| GET · DELETE | `/reference/stations/:id` | ADMIN (own stations) | Station state `{paired, css_px_per_mm}` · close the station (the tablet returns to the PIN screen) |
| POST | `/reference/stations/:id/pin` | ADMIN | A new pairing PIN for the station |
| POST | `/reference-recordings/:id/accept` | ADMIN (+ PIN for a Domain profile) | [Accept] (FR-CAN-9/10): writes the derived values into the Draft's profile, or merges them into the Domain's override. Errors `NOT_PENDING`, `INCOMPLETE`, `NOT_DRAFT`, `RETIRED`, `DIRECTOR_PIN`, `CANVAS_INVALID` |
| POST | `/reference-recordings/:id/clear` | ADMIN | [Clear]: the recording is kept as `CLEARED` |
| — | `/canvases/:id/detail` · `DELETE /canvases/:id` | ADMIN | The detail lists the canvas's `recordings` (derived values, who recorded, decided and approved; no samples); a Draft with recordings cannot be deleted (`HAS_RECORDINGS`) |
| GET/POST/PATCH | `/instruction-videos?key=&language=` | ADMIN (write), all (read) | Video library: upload, new version, retire |
| GET/POST | `/protocol-templates` | ADMIN (write), RESEARCHER, EVALUATOR | Templates |
| GET · PATCH | `/participants/:id` | EVALUATOR, RESEARCHER, ADMIN | Phase 3f. GET: the record (no school: only `has_school`), the current `consent`, `consent_history` (newest first, with who recorded each), the number of sessions, `research` `{allowed}` or `{allowed: false, reason}` (the codes above) and `hand_video.setting`. PATCH: Domain, Region, `school` (re-hashed; logged only as `changed`), birth month, grade, gender, `ses_group`, dominant hand, `is_active`; the study code cannot change (400). Only real changes are stored and logged |
| POST | `/participants/:id/consent` | EVALUATOR, RESEARCHER, ADMIN | Phase 3f: `consent_version`, `signed_on` (not in the future), `allows_hand_video`, `allows_research_use`, `allows_open_science` (each default false). The current record gets `superseded_at`; 409 `PARTICIPANT_INACTIVE` for a deactivated participant |
| GET · POST · PATCH | `/ethics-approvals` · `/ethics-approvals/:id` | staff (read), ADMIN (write) | Phase 3f. Each approval with `valid_now` and the number of sessions that use it. PATCH corrects authority, reference, dates and notes, or `withdrawn` true/false; never deleted |
| GET/POST/PATCH | `/participants` · `POST /participants/:id/consent` | EVALUATOR, RESEARCHER | Participants and consent. POST takes `study_code` (shown as "Participant code"), Domain, Region, `school` (hashed with `SCHOOL_CODE_HMAC_KEY` after trimming, collapsing spaces and lower-casing; the name is never stored, logged or returned), `birth_year_month` (YYYY-MM, stored as the 1st of the month), grade, gender, dominant hand. Session creation stores `age_months` from the birth month. GET takes `q` (part of the study code, any case; `%` and `_` are literal) and `limit` (1–500, default 500); the cockpit's participant search asks for 20 |
| GET/POST | `/sessions` · `GET /sessions/:id` | EVALUATOR, RESEARCHER | Plan and list sessions. The list (newest 200) takes the filters `q` (part of the session or study code), `status`, `session_type`, and `from` / `to` (creation day, both included, in the time zone `tz`, an IANA name, default UTC); 400 on an unknown value. The detail includes each attempt's current score version, the scoring weights and threshold from the snapshot, and `available_videos` (video keys with a version in the session language). POST takes `purpose` INTERVENTION (default) or RESEARCH (FR-PLAN-1): RESEARCH needs `privacy.research_purpose_enabled`, a RESEARCH ethics approval valid today and not withdrawn (stored as `research_approval_id`), and current consent with research use; otherwise 409 `RESEARCH_DISABLED`, `NO_RESEARCH_APPROVAL` or `NO_RESEARCH_CONSENT`. `video_enabled` = `ilt.video.recording_enabled` AND the current consent's hand video (FR-PRIV-2) (Phase 3f) |
| POST | `/sessions/:id/pairing` | EVALUATOR | Open room, issue PIN |
| POST | `/sessions/pair` | tablet | Pair with PIN (body = `PAIRING_REQUEST` payload); returns `PAIRING_RESPONSE` fields, the session code and the tablet token. 5 wrong PINs from one address lock pairing for 15 min |
| POST | `/sessions/:id/release-tablet` | EVALUATOR | Release the tablet from an unfinished session: clears `tablet_token_id`, disconnects the tablet (4401, back to the PIN screen); the session stays open and can be paired again. 409 `STEP_RUNNING` while a block or video runs |
| PATCH | `/sessions/:id/steps/:index` | EVALUATOR | `{ "status": "SKIPPED" }` skips a pending step (logged). Changing the canvas before dispatch comes later |
| POST | `/sessions/:id/steps/:index/paper` | EVALUATOR | Paper notebook page (FR-COCK-4): `duration_ms` (0–3,600,000), `notes` (≤ 2000); the step becomes DONE; logged as `session.paper_page.timed` |
| GET | `/media/videos/:id` | tablet token or staff access token | Instruction video bytes from object storage |
| POST | `/sessions/:id/complete` | EVALUATOR | Close the session when every step is done or skipped; sends `SESSION_COMPLETE` |
| GET | `/ws/tablet` · `/ws/cockpit` | tablet · EVALUATOR | Real-time links (§5.1) |
| PUT | `/block-attempts/:id/intervention-marks/:boxId` | EVALUATOR | Set or change a mark |
| GET | `/participants/:id/summary` | EVALUATOR, RESEARCHER, ADMIN | Comparative summary (FR-SUM-1…4): the participant's latest non-aborted session of each type; per anchor pair the latest finished attempt of each ILT block (a REPEATED attempt is kept for audit only); averages of time and pen lifts, accuracy %, average speed (Σ length ÷ Σ time), component scores, composite; Pass/Fail against the threshold in effect now for the participant's Domain; the weights and threshold |
| GET | `/settings/catalogue` | ADMIN | Definitions in catalogue order (§6.2) with type, default, range, enum values, unit, override scope and director approval; the active canvases (with `recorded_direction`: the fill direction their recorded fill order follows, `OTHER`, or null), letter sets, protocol templates and languages offered as choices |
| GET | `/settings/values?scope=SYSTEM\|DOMAIN\|REGION&target_id=` | ADMIN | For each definition settable at that scope: `stored` (the value kept at this scope, if any), `inherited` (what applies without it) and `effective`, each with its `source` (`DEFAULT`, `SYSTEM`, `DOMAIN`, `REGION`) |
| PUT | `/settings` | ADMIN (+ director PIN when required) | `{scope, target_id?, changes: [{key, value} \| {key, reset: true}], reason?, director_email?, director_pin?}`. Saves all changes together or none. Checks type, range, enum values, references (active canvas of that language and type, letter set, template, enabled language) and scope; then that the three composite weights total 100 and the default language is enabled, for System and every Domain with its own values. Unchanged values are skipped. A director PIN is needed when a changed definition requires approval and `governance.require_director_approval` is on, and always for changing that switch itself. Writes `setting_value_history`; logs `settings.value.changed/removed` (System) or `settings.override.changed` (Domain, Region) per key, and `auth.director_pin.verified/failed`. Errors: 400 `INVALID_SETTING` (`details.errors[{key, reason}]`), `WEIGHTS_TOTAL`, `DEFAULT_LANGUAGE`; 403 `DIRECTOR_PIN`; 404 for an unknown Domain or Region |
| GET | `/settings/history?scope=&target_id=&key=` | ADMIN | The latest 200 changes, newest first, with the names of who changed and who approved, and the reason |
| GET | `/participants/:id/protocol` | EVALUATOR, RESEARCHER, ADMIN | Dispatch Console data (FR-COCK-7): the participant (code, grade, Domain); per session type the session that carries that day: one running now (`PAIRED`, `IN_PROGRESS`, `PAUSED`), else the latest `COMPLETED`, else the latest `PLANNED` (aborted sessions are left out) (`id`, `session_code`, `status`, `language_code`, `can_open`: false for an evaluator's view of another evaluator's session, `others`: the day's other sessions with `id`, `session_code`, `status`, `can_open`) with its steps (`step_type`, `block_number`, `is_scored`, `status`, `video_key`, and the current composite score of the latest finished attempt); `day14_average` (mean composite of the Day 14 blocks once all are scored); and the participant's `settings` now: `in_transition_sec`, `inactivity_sec`, `timers_source` (`DEFAULT`, `SYSTEM`, `DOMAIN`, `REGION`), `warmup_enabled`, `director_approval`. `GET /sessions` rows also carry `participant_id` |
| GET | `/participants/:id/languages` | EVALUATOR, RESEARCHER, ADMIN | `{enabled, default}` from the participant's Domain settings, for the new-session form (FR-LANG-5); `POST /sessions` refuses a language that is not enabled (409 `LANGUAGE_DISABLED`) |
| GET | `/attempts/:id/replay` | EVALUATOR (own), RESEARCHER, ADMIN | Replay data (FR-REP-1/2): the canvas as written (mirroring applied), every sample as columnar arrays, per-house speed and accuracy from the current score version; logs `data.replay.opened` |
| POST | `/scores/recompute` | ADMIN | Recompute selected blocks with given settings; creates new score versions |
| POST | `/paper-scores` · `POST /legacy/import` | EVALUATOR · ADMIN | Paper cohort, legacy import |
| GET | `/research/options` | ANALYST, RESEARCHER | Phase 4a. Domains and Regions, the counts of research sessions and participants, and the school codes, canvases and inactivity timers found in the research data |
| GET | `/research/sessions` · `/research/cohort` | ANALYST, RESEARCHER | Phase 4a (FR-AN-1). Filters, each a comma list: `domain_id`, `region_id` (`NONE` = no Region), `school` (first 8 hex characters of the school HMAC), `grade`, `gender`, `ses` (`NONE` = not recorded), `hand`, `language`, `session_type`, `canvas`, `inactivity_sec`; `from` / `to` (completion day in `tz`). Sessions: newest 500 with `total` and `limited`, each with the means of its counted blocks (the latest finished attempt of each scored step). Cohort: `group_by` none, domain, region, school, grade, gender, ses, hand, language, stage, canvas or inactivity; per group the participants, sessions, blocks and mean composite, accuracy, speed score, ILT speed, pen lifts and time |
| GET | `/research/sessions/:id` · `/research/attempts/:id/replay` | ANALYST, RESEARCHER | Phase 4a. One research session (no settings snapshot: the timers, threshold and weights it used) with every block attempt and `counts`; replay in the same shape as `/attempts/:id/replay` (FR-REP-4), logged as `data.replay.opened` with `portal: analyst` (once per user and attempt within 10 s, as is the cockpit replay: a page that asks twice in a row is logged once). Anything outside the research views is 404 |
| GET | `/research/attempts/:id/kinematics` · `/research/sessions/:id/kinematics` | ANALYST, RESEARCHER | Phase 4b (FR-AN-1; §8.9). Forwarded to the analytics service (`ANALYTICS_URL`, default `http://127.0.0.1:8090`, paths `/api/v1/kinematics/attempts/:id` and `/sessions/:id`). One attempt: `summary`, `letters`, `strokes` and `series` (per measured stroke: `t_ms` from the block's first contact, `speed`, `jerk`, `pressure`). A session: the summary of each block attempt with samples. Outside the research views: 404. Analytics not answering: 503 `analyst.analytics_down`. Opening an attempt is logged as `data.kinematics.opened` (once per user and attempt within 10 s) |
| POST | `/exports` · `GET /exports/:id` | ANALYST, RESEARCHER | Parquet/CSV export of research views (signed S3 URL, 15 min) |
| GET | `/log/events` | ADMIN | Log search (Phase 3e): `from`, `to` (ISO), `types`, `severity` (comma lists from the vocabulary), `user_id`, `session_code`, `domain_id`, `region_id`, `q`, `limit` (≤ 200), `before` (cursor). Returns `{events, next, total, total_capped}`; each event adds the user's name and email, the session code and the Domain/Region codes |
| GET | `/log/events.csv` | ADMIN | The same filter as a CSV file (§12), at most 50,000 rows; headers `x-ilt-rows`, `x-ilt-truncated` |
| POST | `/log/client` | apps | Client events (not built yet) |
| GET | `/health` | public | Liveness |

Every response error uses `{ "error": { "code": "...", "message_key": "...", "details": {} } }`; `message_key` is translated by the client.

## 15. Security and privacy

| Item | Implementation |
|---|---|
| Passwords, director PINs, pairing PINs | argon2id; director PIN sent over HTTPS and verified on the server; 5 failures lock for 15 min |
| Transport | HTTPS/WSS with a local CA on the school network; WebRTC DTLS |
| Authorisation | Role checks in the gateway on every route; evaluators limited to their own sessions; analysts limited to `v_research_*` |
| Identity data | None stored (no names, national ID, initials) |
| School codes | HMAC-SHA256 with a key from the environment, never in the database |
| Research separation | `purpose = 'RESEARCH'` requires a recorded research approval and consent; analyst role reads views only |
| Video | Recorded only when `ilt.video.recording_enabled` and `allows_hand_video`; stored in S3 storage with SHA-256 |
| Exports | Built from research views only, into a private bucket, served by short-lived signed URLs; logged |

## 16. Testing

- **Golden fixtures** for `ilt-metrics`: synthetic perfect letters, B missed by 1.5 mm and touched at 1.2 mm, skipped box, extra internal lift, slow and fast rows, mirrored English letter; plus the real probe recording. Expected outputs include §8.8.
- **Codec** round-trip and CRC tests; fuzzed malformed packets must be rejected and logged.
- **Mock stylus** (`apps/tablet-kiosk/src/dev/MockStylus.ts`) replays recorded sessions through real `PointerEvent`s at 240 Hz, pressure passed through unchanged.
- **Settings resolution** tests for every combination of domain and region values, including rejection of a value whose scope doesn't match `override_scope`.
- **RTL** visual tests (Playwright screenshots) of every screen in Hebrew and English.
- **End-to-end:** a full Day 1 session with the mock stylus, checking stored samples, scores, the summary, replay and the log.

## 17. Changes from DDD v1.5

| Area | Change |
|---|---|
| Accuracy | Per-dot radius and weight; dot B and the A → B → C order required by default; the 40/30/30 formula, width scoring and cDTW scoring removed |
| Speed | New: line length A-radius → C-radius, per-letter speed, block average, Normal speed benchmark with flexibility, speed score |
| Pen lifts | New pen-lift score 100 / (X / E) |
| Composite | 50/25/25 with separate component scores and pass threshold; old 35/40/25 `system_config` columns removed |
| Settings | `system_config` and `domains` override columns replaced by settings with System defaults and Domain overrides (scoring, language) or Region overrides (ILT process), with history |
| Organisation | Domain redefined as a student-grouping category (not geographic); Region added as an independent geographic dimension |
| Canvases | `dynamic_templates` and `letter_canonical_models` replaced by canvas sets, versioned canvases, scoring profiles, Domain overrides and reference recordings; seeds use the real 35 × 25 mm geometry |
| Sessions | Protocol steps (`session_steps`), purpose tag, language, age per session, calibration per session, settings snapshot |
| Raw data | `letter_measures` (raw) separated from versioned `score_versions` / `letter_scores` |
| Telemetry | `pen_samples` with a unique key `(block_attempt_id, sample_seq, sample_time)`, partitioned by sample time, raw pressure, box id per sample only; header 28 bytes with protocol version and attempt number |
| Privacy | `participant_identities` and national ID removed; consent adds research use; ethics approvals table; research views |
| Log | New `app_events` with vocabulary and search |
| i18n | New §13 |
| Restored | Tablet FSM, ACK/ERROR, RESUME, REPEAT, intervention marks, paper and legacy tables |
| Device | Named DTH-A116 only (not MovinkPad 11) |
| Dev users | Hashes generated at seed time from environment variables |
| Communication (Phase 1) | Control events routed through the gateway instead of a WebRTC `control-events` channel; WebRTC carries only the live mirror, with a gateway relay as fallback; new `BATCH_ACK`, `BLOCK_STORED`, `PEER_STATUS`, `TABLET_STATUS`, `BLOCK_INTERRUPTED`; first-message socket authentication; cockpit reconnect replays the running block; a tablet restart mid-block frees the step (§5.1); [Next block] on the tablet (`end_reason` NEXT_BLOCK) |
| Capture (Phase 1) | Development builds also accept the mouse as a pen, for testing without the tablet; production builds accept the pen only |
| Kinematics (Phase 4b) | Analytics service: speed, jerk and pressure per stroke, letter and block (§8.9), reading the research views as `ilt_analyst`; gateway routes `/research/*/kinematics` (§14). Portal: a Kinematics table on the session page, and per block attempt the speed, jerk and pressure charts over time (letter highlight, crosshair readout), letters and strokes |
| Analyst portal (Phase 4a) | `apps/analyst-portal` with its own sign-in (ANALYST and RESEARCHER only): research sessions with cohort filters and grouping, one session's blocks, replay (the replay player moved to `@ilt/ui`); `/research/*` routes run as `ilt_analyst`; migration 0005 (§9 note, §14) |
| Participants and consent (Phase 3f) | Participant record (`GET`/`PATCH /participants/:id`), consent history, session `purpose` with the research conditions and `video_enabled`, ethics approvals routes, migration 0004 (§14, §5 schema note) |
| Action log (Phase 3e) | `GET /log/events` and `/log/events.csv` (§14); the search screen details, free-text prefix matching, the microsecond page cursor and the CSV format (§12) |
| Reference mode (Phase 3d) | Reference stations paired through the usual PIN route (`mode: REFERENCE`); `REFERENCE_START` now also has `PREVIEW` (true-size preview on the tablet, FR-CAN-6), a Domain target and a writer label, and becomes a `DISPATCH_STEP` with `reference`; [Accept]/[Clear] are REST calls instead of `REFERENCE_DECISION`; a canvas's own profile is recorded only on a Draft (§7.3) |
| Dispatch Console (Phase 3) | Evaluator cockpit route `#/participant/:id`: the participant's protocol by day as step cards (FR-COCK-7, from FRS v3.3 Figure 2), opened from the participant code or **Protocol** in the sessions list and from the live session; a card opens its session; `GET /participants/:id/protocol` (§14) |
| Administration (Phase 3) | Administrator cockpit at `<cockpit base>admin` (for example `/cockpit/admin`), with its own sign-in for ADMIN only; the evaluator cockpit refuses ADMIN and the Administrator cockpit refuses every other role (owner decision, Phase 3 QA). Tabs: users and roles with the Research Director PIN, password reset, unlock and deactivation; Domains and Regions; Canvases (the canvas library: sets, Drafts with validation and a preview, activation approved by a director, versions, retiring, Domain overrides of the scoring profile; see the canvas rows in §14); Settings (System, Domain and Region values, see §6.1 and the `/settings` rows in §14; the pass threshold moved here from the Comparative Summary); `organisation.*` log events; refresh re-reads the role (§14) |
| Session flow (Phase 2) | Video steps through the gateway (`VIDEO_PLAY` from the cockpit with `step_index`, resolved per session language; `VIDEO_ENDED` ENDED/STOPPED); inactivity cue and alerts; scoring on storage with `BLOCK_SCORED`; `REPEAT_BLOCK` via the gateway; paper notebook timing route; Comparative Summary by participant (Phase 3 ECR: a diagram of the four measures across the anchors below the boxes, FR-SUM-5, drawn in the cockpit from the same `/participants/:id/summary` data); pass-threshold route with director PIN; replay as JSON (`/attempts/:id/replay`) instead of binary `/block-attempts/:id/samples` |
