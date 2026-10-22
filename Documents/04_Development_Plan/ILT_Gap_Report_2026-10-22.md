# ILT Gap Report: Consolidated Status

**Date:** 2026-10-22
**Baseline:** FRS v3.3 · Architecture v5.4 · DDD v1.4 · [DTH-A116 Device Profile](ILT_DTH-A116_Device_Profile.md)
**Replaces:** the open-item lists in the [round 1](ILT_Coding_Readiness_Review.md) and [round 2](ILT_Coding_Readiness_Review_v1.4.md) reviews (those keep the full reasoning)

## Summary

| Area | Closed | Open | Gates |
|---|---|---|---|
| Blocking gaps (B) | 3 | 5 | Phases 1–4 |
| v1.4 regressions (R) | 0 | 9 | Phase 0 migrations, Phase 1 |
| Device-driven spec corrections (D) | 0 | 10 | Phases 1–3 |
| Clinical decisions (C) | 0 | 8 | Metric engine, state machines |
| Privacy and ethics (P) | 0 | 4 | Any testing with real children |
| Other issues (O) | 0 | 7 | Various |
| Environment (E) | 0 | 3 | Phase 0 |

**Readiness:** Phase 0 (scaffolding) is unblocked except for installing the environment (E1–E3). Phase 1 needs the C items answered and the R/D items applied. Real-child testing additionally needs P1–P4.

**Owners:**
- **Researchers:** Prof. Adi-Japha, Dr. Hollander, Dr. Dorfberger
- **Gemini:** specification documents
- **Claude:** code and database migrations in the repo
- **Yaki:** decisions, machine setup, hosting

**Rule from here on:** where the specs and the repo disagree, Claude implements the corrected version in the repo, and Gemini updates the documents to match. The specs stop being edited independently.

---

## B. Blocking gaps

| ID | Gap | Status | What is still missing | Owner |
|---|---|---|---|---|
| B1 | Clinical metric formulas | ⚠️ Partial | How "Dots", "Width" and "cDTW" each become a 0–100 score. Timing when box 15 is skipped (forward-only lock). Definition of "corrections". The pen-lift rule must use pen-up/pen-down events (see D6). | Researchers → Gemini |
| B2 | State machines | ⚠️ Partial | Evaluator Cockpit FSM. PAUSED, ABORTED, REPEAT and SESSION_COMPLETE states. Notebook stage (60 s page timer). Video steps. Day 1 / 2 / 14 sequencing. Warm-up rule conflict ("3 practice items" vs FRS "1 valid row of 5"). | Gemini (warm-up rule: Researchers) |
| B3 | Control-events contract | ⚠️ Partial | ABORT_SESSION, BLOCK_COMPLETE, SESSION_COMPLETE, ACK/ERROR messages. A common message envelope (id, timestamp, version). | Gemini |
| B4 | Pen data → database | ✅ Design closed | Implementation details only: a unique key against duplicate rows, partitioning by sample time instead of insert time, tablet authentication, a single capture source. | Claude |
| B5 | Participant entity | ✅ Closed | Remaining privacy fixes are tracked as P2–P3. | — |
| B6 | Users, roles, API | ⚠️ Partial | Only 6 endpoints are listed. Missing: participants, session create/list, consent, templates, domains, user admin, results, replay telemetry fetch, intervention, paper-cohort entry. | Claude drafts in code → Gemini documents |
| B7 | Reference letter shapes | ⚠️ Placeholder | Real ILT invented-letter shapes, target dots and sizes in mm, digitised from the original study materials. The seeded ILT-1 doesn't match the "<" chevron on the screens. | Researchers |
| B8 | Hardware | ✅ Closed | Measured on 2026-10-22. See the [device profile](ILT_DTH-A116_Device_Profile.md). | — |

## R. Regressions introduced in v1.4

All are fixed directly in the Phase 0 migrations and code. Gemini aligns the documents afterwards.

| ID | Problem | Fix |
|---|---|---|
| R1 | Per-block results removed; metrics stored once per session | Restore a `session_blocks` table (one row per block and attempt) |
| R2 | Desk-video table removed | Restore `session_video_records` and video sync in the replayer |
| R3 | No hover flag in the sample bitmask (PenDown and InContact overlap) | Bitmask: 0x01 contact, 0x02 hover, 0x04 eraser, 0x08 target hit |
| R4 | Coordinates "mm or virtual px" | Millimetres, float32 (see D3) |
| R5 | Box/house id dropped from samples | Restore `active_box_id` in the wire sample and table |
| R6 | Intervention sessions can't be created (`protocol_day` only allows Day 1/2/14) | Add intervention session types |
| R7 | Packet header documented as 24 bytes; fields total 25 | Fix the layout and document the real size |
| R8 | Parquet export fails, writes to a client-chosen file path, has no auth | Rewrite: attach Postgres, server-side temp file, role check |
| R9 | Compose builds `services/gateway/`; the folder is `services/telemetry-gateway/` | Align paths |

## D. Corrections from the DTH-A116 measurements

| ID | Spec today | Correct to |
|---|---|---|
| D1 | 133 Hz sampling | 240 Hz design rate (270 Hz peak). 50-sample chunk ≈ 210 ms |
| D2 | `time_offset_ms`, integer ms | `time_offset_us`, int32 microseconds (timestamps have 0.1 ms precision) |
| D3 | Coordinates unspecified | Millimetres from the canvas origin. Calibration (5.195 CSS px/mm, 230.9 PPI) stored per session |
| D4 | Capture source unspecified | Exactly one source for persistence: `pointermove` + `getCoalescedEvents()`, or `pointerrawupdate` |
| D5 | <15 ms mirror via standard events | Stream from `pointerrawupdate`. At 60 Hz, `pointermove` alone delays samples up to 16.7 ms |
| D6 | Pen lift = pressure 0 for ≥ 50 ms | Pen lift = `pointerup` → next `pointerdown` gap ≥ threshold (pressure never reaches 0 in contact) |
| D7 | Kinematics on raw samples | Resample to a uniform time grid (e.g. 4 ms) before velocity and jerk |
| D8 | Pressure assumed 0–1 | Normalise to the observed range (max ≈ 0.86) |
| D9 | Palm rejection unspecified | Ignore all touch input while a block is active (22 palm contacts in 7 strokes) |
| D10 | Hover path assumed full-rate | Hover arrives at 60 Hz. Air time is fine; test whether `pointerrawupdate` gives faster hover |

## C. Clinical decisions needed from the research team

The v1.4 documents present these as decided and attribute them to Prof. Adi-Japha. No source is given, and no pilot data exists yet to calibrate against.

| ID | Question | v1.4 value |
|---|---|---|
| C1 | Accuracy weights | 40% target dots / 30% width / 30% cDTW |
| C2 | How "Dots" and "Width" become percentages | Not stated |
| C3 | Pen-lift minimum gap | 50 ms |
| C4 | Time window and the skipped-box-15 case | First pointerdown in box 1 → last pointerup in box 15 |
| C5 | Inactivity escalation | 20 s yellow (30 s at box 15), +10 s amber |
| C6 | Warm-up pass rule | "3 practice items" vs "1 valid row of 5 houses" |
| C7 | Legacy-data mapping (old app's Air Time, Writing Time, Segment Width, Hand Raises, Total Time → 3 metrics) and import format | Claimed in the v1.4 report, not present in the documents |
| C8 | Row 3 DTW / Procrustes thresholds | Arbitrary constants. To be calibrated on pilot data once it exists |

Also to confirm: the timer-factoring formula stays exploratory only (v1.4 says so), the composite score stays display-only, and which languages are in scope (Hebrew, Arabic, English).

## P. Privacy and ethics

| ID | Issue | Fix |
|---|---|---|
| P1 | `allows_anonymized_open_science DEFAULT TRUE` contradicts privacy by default | Default FALSE; explicit opt-in |
| P2 | `participants` stores full `birth_date` and plain `school_id` | Store age in months at each session; keep identifiers in a separate restricted table |
| P3 | `school_id_hash` is unsalted SHA-256 over a small set, so it's reversible | Keyed hash (HMAC) with a secret, or a random school code |
| P4 | Ethics approval references (Helsinki / Chief Scientist) | Researchers provide them before any real child is tested |

## O. Other issues

| ID | Issue | Owner |
|---|---|---|
| O1 | Seed users use a real person's name with invented emails at a real university domain, and invalid password hashes (nobody can log in) | Claude: generated dev-only users |
| O2 | Replayer redraws the whole path every frame (quadratic) | Claude |
| O3 | Mock stylus lacks hover, tilt and coalesced events | Claude |
| O4 | Pairing PIN: 5 digits (FRS) vs 6 (DDD v1.4) | Yaki to decide |
| O5 | `OVERRIDE_TIMER` sends a district name in an integer field; director PIN sent as a SHA-256 hash while the DB uses bcrypt | Claude; Gemini documents |
| O6 | FRS v3.3 is out of date with DDD v1.4 (PIN length, video default, warm-up rule) | Gemini: FRS v3.4 |
| O7 | Pinned MinIO image (2024) may no longer be downloadable | Claude checks during Phase 0 |

## E. Environment

| ID | Item | Owner |
|---|---|---|
| E1 | Docker Desktop with WSL 2 on this PC | Yaki approves install, Claude installs |
| E2 | Node.js LTS + pnpm | Claude |
| E3 | Python 3.12 (analytics service, DTW scoring) | Claude |

## Resolved since round 1

- Pen-data persistence path designed (live mirror vs persistence vs video)
- Participants, users, consent and intervention tables added
- Analyst view no longer exposes initials or school names; failing `dominant_hand` column fixed
- Telemetry stored as REAL with a foreign key and composite index
- Template seed rows match the JSON schema
- Single canonical `PenSample` interface defined
- Packet framing with sequence numbers and CRC16
- Replayer is time-based; SQL injection removed from the export query
- Docker images pinned; credentials read from environment variables
- Video recording off by default
- Device identity confirmed (DTH-A116 = standalone Android 14 EMR tablet), and its pen input measured in Chrome
