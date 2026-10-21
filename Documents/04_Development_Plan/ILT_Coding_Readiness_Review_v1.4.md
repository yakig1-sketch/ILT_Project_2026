# ILT Coding-Readiness Review: Round 2 (v1.4)

**Reviewed:** Version Changes Summary Report v1.4, System Architecture v5.4 (EN), DDD v1.4 CODING-READY (EN)
**Compared against:** [Round 1 review](ILT_Coding_Readiness_Review.md) (FRS v3.3 / Architecture v5.3 / DDD v1.3)
**Date:** 2026-10-21
**Reviewer:** Claude

## Verdict

**Real progress. Phase 0 can start now. But the "100% coding-ready, all 8 gaps resolved" claim is not accurate.**

- **Fully or mostly fixed:** about half of the previous findings, including the pen-data persistence path, participants/users/consent tables, the time-based replayer, pinned Docker images, and the SQL-injection fix.
- **Claimed but not in the documents:** several items the report says were done (Evaluator Cockpit FSM, ABORT message, legacy-import mapping, paper-entry screens, Day 1/2/14 sequencing in the FSM).
- **New problems:** v1.4 introduced regressions. The most serious is that **per-block metrics were removed from the database**, which breaks the Comparative Summary Dashboard.
- **Unsupported clinical claims:** the clinical numbers (accuracy weights, 50 ms lift threshold, DTW "calibrated against 50 pilot samples") are attributed to the research team, but no pilot data exists yet. **These must be confirmed by Prof. Adi-Japha, Dr. Hollander and Dr. Dorfberger before they're treated as approved.**

---

## 1. Status of the 8 blocking gaps

| Gap | Report says | Actually in v1.4 | Status |
|---|---|---|---|
| B1 Metric formulas | Fully defined | Accuracy = 0.40·Dots + 0.30·Width + 0.30·cDTW, but **how each component becomes a 0–100 score is not defined**. Pen lift = pressure 0 for ≥ 50 ms (good). Timing starts at first pointerdown in box 1 and stops at last pointerup in box 15, but **it's undefined what happens if box 15 is skipped (forward-only lock)**. "Corrections" are still undefined. | ⚠️ Partial. Needs clinical sign-off |
| B2 State machines | Tablet + Cockpit FSMs, Day 1/2/14 sequencing | **Tablet FSM only.** No Evaluator Cockpit FSM. No PAUSED, ABORTED, REPEAT or SESSION_COMPLETE states. No notebook stage (60 s page timer), video steps, or Day 1/2/14 sequencing. The warm-up rule contradicts the FRS: "3 practice items" vs FRS "1 valid row of 5 houses". | ⚠️ Partial |
| B3 Control-events | All messages incl. abort | PAIRING, DISPATCH_BLOCK, PAUSE/RESUME, TIMEOUT_ALERT, REPEAT_BLOCK_CONFIRM and OVERRIDE_TIMER are defined. **Missing:** ABORT (claimed but absent), BLOCK_COMPLETE, SESSION_COMPLETE, acknowledgements/errors, and a common envelope (message id, timestamp, version). | ⚠️ Partial |
| B4 Pen data → DB | Zero data loss | The design is now clear: live mirror over WebRTC, persistence over WebSocket in 50-sample chunks, plus a block-end batch with SHA-256. **But:** samples arrive twice (streamed + batch) and the table has no unique key, so rows will duplicate. The hypertable is partitioned on `recorded_at DEFAULT NOW()` (insert time, not sample time). How the tablet authenticates to the gateway is undefined. | ✅ Design resolved. Fixable in implementation |
| B5 Participants | Added, de-identified | `participants` table added and longitudinal link works. **But** it stores `birth_date` and plain `school_id` (PII). `school_id_hash` is an unsalted SHA-256 of a small set of schools, so it's trivially reversible. `allows_anonymized_open_science DEFAULT TRUE` contradicts "privacy by default". | ✅ Mostly. Privacy fixes needed |
| B6 Users/RBAC/API | Complete REST API | `users` table, 4 roles and JWT are defined. **The "complete" REST table has only 6 endpoints.** Missing: participants, sessions create/list, consent, templates, domains, user admin, results, replay telemetry fetch, intervention, paper-cohort entry. The director PIN is sent as a SHA-256 hash (so the hash becomes the password), while the DB stores bcrypt. | ⚠️ Partial |
| B7 Canonical letters | Seeded | 2 rows seeded, but they're **placeholders**. Units are undefined (coordinates 10–90 next to a 15 mm nominal width). The ILT-1 polyline is a single rising curve that doesn't match the "<" chevron shown on every wireframe. Only one invented letter exists. | ⚠️ Structure ok, data placeholder |
| B8 Hardware | Validated | **Device identity resolved; see section 1a.** The DTH-A116 datasheet confirms it's a standalone Android 14 EMR tablet, so it's not a contradiction. But the datasheet shows the specs use **wrong numbers** (133 Hz, 165 PPI). Pen behaviour in Chrome still needs to be measured on the device. | ⚠️ Partial. Specs need correcting, plus a short measurement |

## 1a. Hardware facts from the Wacom DTH-A116 datasheet

*Correction to round 1:* the DTH-A116 is **not** a pen display that needs a PC. It's an 11.45" **standalone Android 14 (with Google services) EMR pen tablet**. The device question is closed. The project should name the **DTH-A116** as its target device everywhere.

The datasheet changes several numbers in the specs:

| Spec says | Datasheet says | Impact |
|---|---|---|
| 133 Hz EMR sampling | **270 points per second** (~3.7 ms per sample) | All "133 Hz" references, buffer sizes and load tests must use 270 Hz. A 50-sample chunk is ~185 ms, not 375 ms. Twice as many telemetry rows. |
| `time_offset_ms` integer milliseconds is "lossless" | 3.7 ms interval | Whole milliseconds round each interval by up to ~27%, which distorts velocity and jerk. **Store time in microseconds (int32) or as float milliseconds.** |
| 165 PPI (target-dot radius 3.5 mm ≈ 22.6 px) | 2200 × 1440 on 11.45" ≈ **230 PPI** (3.5 mm ≈ 31.6 physical px) | Every mm-based rule (dot radius, 15 ± 2 mm width) must be converted using the real PPI and the browser's devicePixelRatio. A wrong value distorts accuracy scores. |
| Hover detection | **10 mm reading height** | Hover is supported by the hardware. Air-time and hover paths are feasible. |
| tiltX / tiltY reported | **Tilt not listed** | Don't rely on tilt. Keep the columns, but expect zeros until measured. |
| Display | 60 / 90 Hz refresh | Browsers fire pointer events per frame, so `getCoalescedEvents()` is required to receive all 270 samples. |
| Kiosk | Android 14 **with GMS** | Managed Google Play / managed Chrome kiosk (Android Enterprise) is available. |

**Still to measure on the device (about 1 hour, not a full spike):** the pointer-event rate Chrome actually delivers with coalesced events, the pressure range, hover events, and whether tilt is reported. A web app already runs well on the device. Adding a small measurement page to it would answer all four.

## 2. New problems introduced in v1.4 (regressions)

1. **Per-block results were removed.** v1.3 had a `session_blocks` table (one row per block). v1.4 dropped it and moved the metric columns onto `diagnostic_sessions`, one row per session (one column is even named `total_pen_lifts_in_block`). Day 1 has 8+ scored blocks, and the Comparative Summary Dashboard compares Blocks 1–2 vs 7–8. **That's now impossible to store.** Repeat attempts (`preserve_attempt_1_for_audit`) and notebook-stage results have nowhere to go either.
2. **The video table was removed.** `session_video_records` is gone, yet the FRS requires replay synced with desk video, and the replayer no longer accepts a video element.
3. **Hover was lost.** The new bitmask has PenDown (0x01) and **InContact (0x02)**, which overlap, and no hover flag. `air_time_ms` and the FRS's "yellow in-air hover path" depend on hover. The new replayer doesn't draw hover.
4. **Coordinate units became ambiguous.** `PenSample.x/y` are now "mm or virtual px". v1.3 used normalized 0–1. Every component must agree on one unit.
5. **No box/house id per sample.** `active_house_id` was dropped from the sample and the DB, so "skipped houses" and per-box accuracy must be inferred from coordinates.
6. **Intervention sessions can't be created.** `intervention_stages` references `diagnostic_sessions`, whose `protocol_day` only allows `DAY_1_BASELINE / DAY_2_RETENTION / DAY_14_TRANSFER`.
7. **Packet header size is wrong.** The header is documented as 24 bytes, but its fields add up to **25** (2+1+16+1+4+1).
8. **The Parquet export is still broken and is now a security hole.**
   - It queries `v_analyst_cohort_slices` in an in-memory DuckDB that never attaches Postgres, so it fails.
   - DuckDB doesn't accept a bound parameter as the `COPY ... TO` path.
   - `output_filename` is a **client-controlled query parameter**, which lets a caller write files anywhere on the server.
   - It still has no authentication check (`Depends` is imported but unused).
9. **Docker paths don't match.** Compose builds `services/gateway/Dockerfile`, but the monorepo folder is now `services/telemetry-gateway/`.

## 3. Other issues

- **Seed users use a real person's name with invented emails at a real university domain** (`director@ilt-research.biu.ac.il`, "Dr. Hagit Hollander"). Their "bcrypt" hashes aren't valid (`$2b$12$DIRECTOR_PIN_HASH_9942`), so **nobody can log in**. Dev seed users should be clearly fake and generated with real hashes.
- **The replayer redraws inefficiently.** It calls `stroke()` on a growing path for every sample and rebuilds from zero every frame. That's quadratic, and the pressure-based line width is applied to the whole path. It works for one block but needs rewriting.
- **The mock stylus is incomplete.** It never emits hover (pointermove with no buttons), tilt or coalesced events, and it relies on a fake `hardwareTimeOffsetMs` property real devices don't have.
- **The PIN length changed** from 5 digits (FRS, v1.3) to 6 (v1.4).
- **`OVERRIDE_TIMER` sends a district name** in the `domain_id` field (an integer column).
- **FRS v3.3 is now out of date** with DDD v1.4 (PIN length, video default, warm-up rule). An FRS v3.4 is needed so the three documents agree.
- **MinIO:** the pinned image is from 2024. Check that this image is still downloadable before relying on it.

## 4. Clinical parameters to confirm with the research team

The v1.4 documents present these as decided, attributed to Prof. Adi-Japha. No source is given, and the report says DTW was "calibrated against 50 pilot handwriting samples" before any pilot has run. **Please confirm each one directly with the researchers:**

| Parameter | v1.4 value |
|---|---|
| Accuracy weights | 40% target dots / 30% width / 30% cDTW |
| How "Dots" and "Width" become percentages | Not stated |
| Pen-lift threshold | pressure = 0 for ≥ 50 ms |
| Time window | first pointerdown in box 1 → last pointerup in box 15 |
| Inactivity escalation | 20 s yellow (30 s at box 15), +10 s amber |
| Warm-up pass rule | "3 practice items" (DDD) vs "1 valid row of 5 houses" (FRS) |
| ILT invented letter shapes, target dots, real-world size | Placeholder coordinates |
| Legacy-data mapping (Air Time, Writing Time, Hand Raises → 3 metrics) | Claimed, not in the documents |

## 5. Recommendation

1. **Start Phase 0 now.** The scaffolding (monorepo, Docker Compose, shared types, binary codec, mock stylus, CI) doesn't depend on the open items. Claude writes the database migrations directly in the repo with the fixes above: a per-block results table, a video table, a hover flag, normalized coordinates, a unique key on telemetry, and a fixed analyst view. The DDL in the PDF is used as input, not copied.
2. **In parallel, get answers to section 4** from the research team. Those answers gate Phase 1's metric engine and Phase 3–4's state machines.
3. **Measure pen input on the DTH-A116** (rate, pressure, hover, tilt) using the existing web app plus a measurement page, and correct all specs to 270 Hz / 230 PPI.
4. **Ask Gemini for one consolidated update** (FRS v3.4 + DDD v1.5) that matches the repo's migrations, instead of more independent document revisions. Once coding starts, the repo should become the source of truth.

**Machine prerequisites still missing:** Docker Desktop (with WSL 2), Node.js LTS, Python 3.12.
