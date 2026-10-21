# ILT Coding-Readiness Review

**Reviewed:** FRS v3.3 (EN), System Architecture v5.3 (EN), Detailed Design (DDD) v1.3 CODING-READY (EN), Development Transition & Test Environment Guide, DEV Stages
**Date:** 2026-10-21
**Reviewer:** Claude

## Verdict

**Not "100% coding-ready", but ready to start Phase 0 (scaffolding).**

The documents fix the product vision, the technology stack, the screens, the binary pen sample format and a database draft. Those are enough to build the monorepo, Docker environment, database, shared types, binary protocol package and mock stylus now.

What's missing is the **behavioural core**: how the 3 clinical metrics are calculated, the session/timer state machines, the control message protocol, and how pen data actually reaches the database. These are not coding details an AI agent should invent. They are research decisions, and guessing them would produce data the study can't use. They must be answered before Phase 1–4 code is written.

---

## 1. Blocking gaps (must be resolved before Phases 1–4)

| # | Gap | Where it should be | Why it blocks |
|---|---|---|---|
| B1 | **The 3 clinical metrics have no calculation rules.** "Accuracy %", "Pen lifts" and "Total time (with corrections)" are named everywhere but never defined. Examples: does accuracy come from the target-dot hit radius (3.5 mm), the width rule (15 ± 2 mm), or both, and with what weighting? Which lifts count (cockpit shows both "Pen lifts in block: 5, norm 15" and "Internal pen lifts: 1")? When does block time start and stop? | DDD §6 / new "Metrics" section | These are the study's outcome measures. Two agents coding them independently would compute them differently. |
| B2 | **The state machines section is empty.** DDD §6 "Finite State Machines & Protocol Workflow Execution" contains only screenshots. Undefined: what the 20 s "in-transition delay" actually delays, what triggers the inactivity timeout, what happens after it (the cockpit blinks; does the tablet advance?), the forward-only lock and skip rule, "Repeat block" semantics, the warm-up pass rule, and the Day 1 / Day 2 / Day 14 protocol sequencing. | DDD §6 | The tablet kiosk and evaluator cockpit are both built around this logic. |
| B3 | **No `control-events` message schema.** Only signaling messages (JOIN_ROOM, OFFER/ANSWER, ICE) are specified. Nothing for dispatch block, pause, resume, abort, timer tick, timeout alert, block complete or repeat. The evaluator's own JOIN and the PIN/QR pairing flow are also missing. | DDD §4 | Tablet and cockpit can't interoperate without a shared contract. |
| B4 | **The path from pen data to the database is undefined.** EMR samples travel tablet → cockpit over a peer-to-peer WebRTC DataChannel. Nothing says who writes them to TimescaleDB, when, or how the IndexedDB offline buffer and the "async cloud sync" reconcile. The DEV Stages say "bridge via go2rtc", but go2rtc is a camera/video relay and does not carry custom DataChannels. | Architecture §3 / DDD §2 | Without this, no pen data is saved and replay and analytics have nothing to read. |
| B5 | **No participant entity.** There is no `students`/`participants` table. Each session stores its own `examinee_alias`/`initials`, so Day 1, Day 2, Day 14 and the intervention program can't be reliably linked to one child. Yet the Comparative Summary Dashboard depends on that link. | DDL | Longitudinal analysis is the core of the study. |
| B6 | **No users / roles / auth model.** RBAC (Researcher / Evaluator / Analyst / Admin) and "Research Director authorization code" are required. No `users` table, auth method, or API endpoint list exists. | DDL + new API section | Phase 1 can't be implemented as specified. |
| B7 | **No canonical letter data.** `letter_canonical_models` has no seed rows, and the invented-letter (ILT) shapes and target-dot coordinates aren't defined as data. | DDD §7 seed | Row 3 scoring and accuracy checks have nothing to compare against. |
| B8 | **Hardware not validated.** Specs say "Wacom MovinkPad 11" (an Android tablet), but the architecture diagram and JOIN_ROOM say "DTHA116" (a pen display that needs a host computer). Unverified assumptions: 133 Hz sampling (browsers deliver pointer events at screen refresh rate, so `getCoalescedEvents()` is required), hover and tilt reporting in Android Chrome, and true kiosk lock-down for a PWA. | FRS header vs Architecture Fig. 1 | Everything is built on the pen data stream. A 1-day hardware spike should confirm what the device actually delivers. |

## 2. Errors and contradictions (must be fixed, but don't block Phase 0)

**Database (DDL is identical in Architecture v5.3 and DDD v1.3)**
- `v_analyst_cohort_slices` selects `s.dominant_hand`, but `sessions` has no such column. **The DDL script fails as written.**
- The analyst view exposes `examinee_initials` and `school_name` even though the FRS states analysts see de-identified data only.
- `pen_telemetry_chunks` uses `NUMERIC` for x/y/pressure at 133 Hz. `REAL`/`DOUBLE PRECISION` is far faster and matches the `float` wire format. It also has no foreign key and no `(session_id, block_index, time_offset_ms)` index.
- DDL header says "DDD v1.2" inside the v1.3 document.
- No tables for intervention stages 1–4, the stage-4 manual scores, consent records, or video-disabled audit.
- DEV Stages list tables that don't exist in the DDL: `users`, `students`, `letter_templates`, `diagnostic_sessions`, `session_events`.

**Seed data vs its own JSON Schema (DDD §5 vs §7)**
- `TEMPLATE_ILT_GRID_3X5` and `TEMPLATE_INTERVENTION_LETTER_TET` lack the schema's required `num_lines`, `line_spacing_px`, `margin_side` and `active_row_indices`, so validation will reject them.
- `TEMPLATE_NOTEBOOK_10_ROWS` has `num_lines: 16`.
- The seed adds `time_measurement_only` and `letters_per_row`, which aren't in the schema.

**Field naming: three conventions for one pen sample**
- Wire struct: `timestamp_offset_ms`, `x_coord`, `stroke_flags`
- Mock simulator: `time_offset_ms`, `x`, `is_pen_down`, `is_hover`
- Database: `time_offset_ms`, `x`, `is_pen_down`, `is_hover`
- The replayer reads the wire names. One canonical type in `packages/shared-types` must be defined first.

**Binary protocol**
- DEV Stages require "checksum validation" and the DDD mentions an "OpCodes parser", but the 24-byte struct has neither.
- No packet framing: samples per message, sequence numbers, or block/session id in the header. These are needed on an unreliable channel to detect lost samples.
- The FRS claims "microsecond precision", but the timestamp field is milliseconds. That's enough at 133 Hz (7.5 ms interval); the claim should be corrected.

**Sample code bugs (don't copy as-is)**
- `KinematicSessionReplayer` advances one sample per animation frame. At 60 fps and 133 Hz, "1x" plays at about 0.45x real speed. 0.25x and 0.5x round to the same step as 1x. `renderUpToCurrentFrame()` is never defined. Playback must be time-based.
- The Parquet export endpoint builds SQL with f-strings from query parameters, which is **SQL injection**. It has no authentication, and `ses_low` is ignored.
- `MockEMRStylusSimulator` uses mouse events (not PointerEvents). Its hover samples before the first click get offsets from time 0.
- docker-compose uses `:latest` tags and hard-coded passwords. It has no service for the gateway, analytics API, Superset/Metabase or JupyterHub.

**Spec inconsistencies**
- Latency target: <15 ms (FRS, DDD) vs <20 ms (Architecture Fig. 1). No measurement method is given (needs clock sync between devices).
- Monorepo names differ: DEV Stages `apps/backend`, `apps/tablet-kiosk`, `apps/evaluator-cockpit` vs DDD `apps/student-tablet`, `apps/proctor-cockpit`, `services/gateway`, `services/analytics`.
- The ORM is undecided ("TypeORM / Prisma"), and the backend language and framework (Node/NestJS? Fastify?) are never stated.

## 3. Research-logic questions for the clinical team

These need answers from Dr. Hollander, Prof. Adi-Japha and Dr. Dorfberger, not from a developer:

1. **Timer factoring formula.** `factored_duration = duration × (T_system / T_domain)` scales writing time by the ratio of *transition delays*. Is that clinically valid? The delay between blocks doesn't obviously change how long a child takes to write.
2. **Composite score weights** 35 / 40 / 25 (pen lifts / accuracy / time). They're seeded as defaults, but the FRS says the 3 metrics must not be collapsed. Confirm the composite is optional and display-only.
3. **Row 3 scoring thresholds.** Procrustes ×2.2, DTW ÷100, the 55/30/15 weights and the 80% "ACCURATE" cut-off are arbitrary constants. They need calibration against expert-scored samples. Note that the code uses `fastdtw` (approximate), not "continuous DTW" as described.
4. **Legacy data.** The pilot includes 50 legacy historical datasets. The old application measured Air Time, Writing Time, Segment Width, Hands Raises and Total Time (see `05_Measures/Samples`). How do these map to the new 3 metrics, and what's the import format?
5. **Paper cohort.** How are the 50 paper-based children's results entered?
6. **Languages.** Hebrew only, or also Arabic (the sample dashboard shows an "Al-Najah" school) and English (A–Z)? This affects RTL/LTR and the letter canonical models.

## 4. Privacy and ethics (minors' data)

- No consent/assent records, data-retention policy or deletion procedure are specified.
- Desk video of children's hands is recorded by default (`video_recording_enabled DEFAULT TRUE`).
- Ethics approval references (Helsinki committee / Ministry of Education Chief Scientist) should be recorded before real children are tested.
- Encryption at rest is mentioned for MinIO only.

## 5. Recommended path

| Step | What | Depends on |
|---|---|---|
| 1 | **Phase 0 scaffolding:** monorepo, docker-compose (pinned versions, `.env`), corrected DDL with migrations, shared pen-sample type, 24-byte codec with framing, PointerEvent-based mock stylus, CI | Nothing. Can start now |
| 2 | **Hardware spike (1 day)** on the real MovinkPad 11: measure the pointer event rate with `getCoalescedEvents()`, hover, tilt, pressure range, and kiosk options | Device in hand |
| 3 | **Spec patch v1.4:** answer B1–B7 and §3 (metric formulas, state machines, control-events schema, data-flow-to-DB, participants/users tables, canonical letter seed) | Clinical team + you |
| 4 | Phases 1–4 (backend, real-time, tablet, cockpit) | Steps 1–3 |
| 5 | Phases 5–7 (analyst portal, intervention, E2E) | Step 4 |

**Test environment:** the guide's recommendation is correct. Google Drive can't host the system. Use **Option 1, a local Docker Compose stack** on this PC, with the tablet and the evaluator laptop on the same Wi-Fi. That costs nothing and is fully under your control. Docker Desktop (with WSL 2) must be installed on this machine first.
