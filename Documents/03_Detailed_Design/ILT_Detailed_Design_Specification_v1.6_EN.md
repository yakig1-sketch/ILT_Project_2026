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

**Socket authentication:** the first text message on a socket carries the credential: `{ "auth": <tablet token> }` on `/ws/tablet` (issued by `POST /sessions/pair`, bound to one session, 12 h), `{ "auth": <access token>, "session_id": ... }` on `/ws/cockpit` (evaluators only for their own sessions). A bad credential closes the socket with code 4401; a second tablet socket for the same session replaces the first (4409).

**No data loss:** the tablet keeps every batch in IndexedDB until the gateway acknowledges it with `BATCH_ACK`, and keeps control events until their `ACK`. After a reconnect it resends unacknowledged control events first, then unacknowledged batches; a batch without an ACK after 3 s is also resent (e.g. one that arrived before its `STEP_STARTED` was stored). The gateway ignores duplicate samples by `(block_attempt_id, sample_seq)`: `sample_time` is the attempt's start plus `t_us`, so a resent sample maps to the same key. Over one TCP connection, events are not resent on a timer.

**Cockpit reconnect:** a cockpit that connects while a block is running receives that block's `DISPATCH_STEP` and `STEP_STARTED` again (rebuilt from the database after a gateway restart), so the evaluator can follow and finish it. Ink written before the reconnect is not replayed in the mirror.

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
| `DISPATCH_STEP` | cockpit → tablet | `step_index`, `step_type`, `canvas` (resolved geometry incl. mirroring), `fill_order`, `timers` {in_transition_sec, inactivity_sec, inactivity_last_box_sec, amber_grace_sec}, `attempt_number` |
| `STEP_STARTED` | tablet → all | `step_index`, `attempt_number`, `block_started_at` (wall clock) |
| `BOX_ADVANCED` | tablet → all | `box_id`, `fill_position`, `skipped_box_ids[]` |
| `INACTIVITY_ALERT` | tablet → all | `level` CUE/AMBER, `idle_ms`, `box_id` |
| `PAUSE_SESSION` / `RESUME_SESSION` | cockpit → tablet | `reason` STUDENT_FATIGUE / HARDWARE / EVALUATOR_INTERVENTION / OTHER, `note` |
| `MANUAL_FINISH` | cockpit → tablet | `reason` |
| `BLOCK_COMPLETE` | tablet → all | `step_index`, `attempt_number`, `end_reason` LAST_BOX/MANUAL/TIMEOUT, `sample_count`, `last_sample_seq`, `sha256` (over all sample bytes in seq order) |
| `BLOCK_SCORED` | gateway → cockpit | `block_attempt_id`, `score_version`, block scores, per-letter summary |
| `REPEAT_BLOCK` | cockpit → tablet | `step_index`, `reason`; tablet replies with a new `STEP_STARTED` (attempt + 1) |
| `VIDEO_PLAY` / `VIDEO_ENDED` | cockpit ↔ tablet | `video_key`, `language`, `url` (resolved from `instruction_videos` for the session language; the tablet pre-loads it during the previous step) |
| `ABORT_SESSION` | cockpit → all | `reason`, `save_partial` |
| `SESSION_COMPLETE` | gateway → all | `session_id`, `completed_steps` |
| `REFERENCE_START` | admin → tablet | `canvas_id`, `kind` SAMPLE_BLOCK_FILL/NORMAL_SPEED, `rows` (for speed: 1) |
| `REFERENCE_RESULT` | gateway → admin | `recording_id`, derived values |
| `REFERENCE_DECISION` | admin → gateway | `recording_id`, `decision` ACCEPT/CLEAR |
| `BATCH_ACK` | gateway → tablet | `step_index`, `attempt_number`, `sequence`: the `BATCH` packet is stored (not itself acknowledged) |
| `BLOCK_STORED` | gateway → cockpit | `block_attempt_id`, `step_index`, `attempt_number`, `sample_count`, `integrity_ok`: every sample of a completed block is stored and the SHA-256 checked. Phase 2 follows it with `BLOCK_SCORED` |
| `PEER_STATUS` | gateway → tablet, cockpit | `tablet`, `cockpit` (booleans): which ends are connected; the cockpit starts the WebRTC offer when the tablet appears |
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

Only `ADMIN` writes settings. If `governance.require_director_approval` is true and the definition has `requires_director_approval`, the request must include a Research Director's user id and PIN; the server verifies the PIN against `users.director_pin_hash`. Every change writes `setting_value_history` and an `settings.value.changed` log event with old and new values.

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
- **Validation:** size fits the tablet's usable screen at true size; every dot inside its box; unique ids; at least one box; fill order is a permutation of the box ids.

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

| Kind | What's drawn | Derived values | On Accept |
|---|---|---|---|
| `SAMPLE_BLOCK_FILL` | One complete block by the System Administrator | `fill_order` = box ids in order of their first stroke; `expected_pen_lifts_per_block` = pen-lift count (§8.2) | Written into the profile (system default, or the domain override if recorded for a domain) |
| `NORMAL_SPEED` | `rows` rows (default 1) by a skilled writer | `normal_speed_mm_s` = Σ line length ÷ Σ line time over the letters (§8.4) | Written into the profile |

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
| `PAPER_TIMING` | Stop | `STEP_REVIEW` | Save duration and notes |
| `STEP_ACTIVE` | `INACTIVITY_ALERT` CUE | `STEP_ACTIVE` | Show idle time |
| `STEP_ACTIVE` | `INACTIVITY_ALERT` AMBER | `STEP_ACTIVE` | Amber panel, Manual Finish flashes |
| `STEP_ACTIVE` | Pause | `PAUSED` | `PAUSE_SESSION`, reason logged |
| `PAUSED` | Resume | `STEP_ACTIVE` | `RESUME_SESSION` |
| `STEP_ACTIVE` | Manual finish / `BLOCK_COMPLETE` | `SCORING` | Wait for persistence ACK of the last sample, then score |
| `SCORING` | `BLOCK_SCORED` | `STEP_REVIEW` | Show block result; for intervention, the marking form with suggestions |
| `STEP_REVIEW` | Repeat block | `STEP_ACTIVE` | Attempt 1 → `REPEATED`; `REPEAT_BLOCK`; attempt 2 starts |
| `STEP_REVIEW` | No steps left | `SESSION_COMPLETE` | `SESSION_COMPLETE`, open the comparative summary |
| any | Abort | `ABORTED` | `ABORT_SESSION`, partial data kept |
| any | Link lost > 6 s | same + banner | Tablet keeps buffering; resume when back |

### 11.2 Tablet kiosk

| State | Event | Next | Action |
|---|---|---|---|
| `IDLE` | Evaluator's PIN entered | `PAIRING` | `PAIRING_REQUEST` |
| `PAIRING` | Accepted | `WAITING` | Show friendly waiting screen in the session language |
| `WAITING` | `DISPATCH_STEP` (writing) | `TRANSITION` | Show canvas preview, countdown `in_transition_sec` |
| `TRANSITION` | Countdown ends | `WRITING` | `STEP_STARTED`, capture on, touch off |
| `WRITING` | Last box finished, `MANUAL_FINISH`, or timeout | `UPLOADING` | Lock canvas, `BLOCK_COMPLETE` with SHA-256 |
| `UPLOADING` | All batches ACKed | `WAITING` | — |
| `WRITING` | `PAUSE_SESSION` | `PAUSED` | Freeze timers, rest overlay |
| `PAUSED` | `RESUME_SESSION` | `WRITING` | — |
| `WAITING` | `VIDEO_PLAY` | `VIDEO` | Play full screen; `VIDEO_ENDED` → `WAITING` |
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
| users | `users.user.created`, `users.user.updated`, `users.user.deactivated` |
| participants | `participants.participant.created`, `participants.participant.updated`, `participants.consent.recorded` |
| sessions | `session.created`, `session.paired`, `session.step.dispatched`, `session.step.started`, `session.box.advanced`, `session.inactivity.cue`, `session.inactivity.amber`, `session.paused`, `session.resumed`, `session.block.completed`, `session.block.manual_finish`, `session.block.repeated`, `session.block.scored`, `session.paper_page.timed`, `session.completed`, `session.aborted`, `session.link.lost`, `session.link.restored` |
| telemetry | `telemetry.batch.rejected` (CRC/format), `telemetry.integrity.failed`, `telemetry.box_mismatch` |
| intervention | `intervention.mark.suggested`, `intervention.mark.changed` (old/new) |
| settings | `settings.value.changed` (old/new/approver), `settings.value.removed`, `settings.override.changed` |
| canvases | `canvas.uploaded`, `canvas.validated`, `canvas.activated`, `canvas.retired`, `canvas.reference.recorded`, `canvas.reference.accepted`, `canvas.reference.cleared` |
| scores | `scores.recomputed` |
| data | `data.export.created`, `data.replay.opened`, `data.legacy.imported`, `data.paper_scores.entered` |
| system | `system.error`, `system.service.started`, `system.service.stopped` |

- **Search screen** (admin): time range, event types (multi-select by area), user, session code, domain/region, severity, free text (uses `search_text`); results paged, newest first; CSV export (logged as `data.export.created`).
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
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout` | public / any | Authentication |
| GET/POST/PATCH | `/users` | ADMIN | User management, director PIN |
| GET/POST/PATCH | `/domains`, `/regions` | ADMIN (write), all (read) | Student-grouping domains and geographic regions |
| GET | `/languages` | all | Enabled languages |
| GET | `/settings/definitions` | ADMIN, RESEARCHER | Catalogue |
| GET | `/settings/effective?domain=&region=` | all | Resolved values with their source scope |
| PUT/DELETE | `/settings/values/:key` | ADMIN (+ director PIN when required) | Set or remove a value at a scope |
| GET | `/canvas-sets?language=&type=` · `/canvases?set=` | all | Canvas library |
| POST | `/canvases` (geometry JSON + optional background file) | ADMIN | Upload a canvas (DRAFT) |
| POST | `/canvases/:id/validate`, `/canvases/:id/activate`, `/canvases/:id/retire` | ADMIN | Lifecycle |
| PUT | `/canvases/:id/overrides/:domainId` | ADMIN (+ PIN) | Domain scoring override |
| POST | `/canvases/:id/reference-recordings` · `/reference-recordings/:id/decision` | ADMIN | Reference mode |
| GET/POST/PATCH | `/instruction-videos?key=&language=` | ADMIN (write), all (read) | Video library: upload, new version, retire |
| GET/POST | `/protocol-templates` | ADMIN (write), RESEARCHER, EVALUATOR | Templates |
| GET/POST/PATCH | `/participants` · `POST /participants/:id/consent` | EVALUATOR, RESEARCHER | Participants and consent |
| GET/POST | `/sessions` · `GET /sessions/:id` | EVALUATOR, RESEARCHER | Plan and list sessions |
| POST | `/sessions/:id/pairing` | EVALUATOR | Open room, issue PIN |
| POST | `/sessions/pair` | tablet | Pair with PIN (body = `PAIRING_REQUEST` payload); returns `PAIRING_RESPONSE` fields, the session code and the tablet token. 5 wrong PINs from one address lock pairing for 15 min |
| PATCH | `/sessions/:id/steps/:index` | EVALUATOR | Change canvas before dispatch; paper timing and notes; `{ "status": "SKIPPED" }` skips a pending step (logged) |
| POST | `/sessions/:id/complete` | EVALUATOR | Close the session when every step is done or skipped; sends `SESSION_COMPLETE` |
| GET | `/ws/tablet` · `/ws/cockpit` | tablet · EVALUATOR | Real-time links (§5.1) |
| GET | `/sessions/:id/results` | EVALUATOR (own), RESEARCHER | Blocks, scores, letters |
| PUT | `/block-attempts/:id/intervention-marks/:boxId` | EVALUATOR | Set or change a mark |
| GET | `/sessions/:id/summary` | EVALUATOR (own), RESEARCHER | Comparative summary (anchor pairs) |
| GET | `/block-attempts/:id/samples` | EVALUATOR (own), RESEARCHER, ANALYST (research only) | Replay data (binary §5.2) |
| POST | `/scores/recompute` | ADMIN | Recompute selected blocks with given settings; creates new score versions |
| POST | `/paper-scores` · `POST /legacy/import` | EVALUATOR · ADMIN | Paper cohort, legacy import |
| POST | `/exports` · `GET /exports/:id` | ANALYST, RESEARCHER | Parquet/CSV export of research views (signed S3 URL, 15 min) |
| GET | `/log/events` · `POST /log/client` | ADMIN · apps | Log search · client events |
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
| Communication (Phase 1) | Control events routed through the gateway instead of a WebRTC `control-events` channel; WebRTC carries only the live mirror, with a gateway relay as fallback; new `BATCH_ACK`, `BLOCK_STORED`, `PEER_STATUS`; first-message socket authentication; cockpit reconnect replays the running block (§5.1) |
| Capture (Phase 1) | Development builds also accept the mouse as a pen, for testing without the tablet; production builds accept the pen only |
