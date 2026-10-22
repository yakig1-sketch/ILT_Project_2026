# ILT Coding-Readiness Review: Round 3 (v1.5)

**Reviewed:** Gap Report v1.5, FRS v3.4 (EN), Architecture v5.5 (EN), DDD v1.5 CODING-READY (EN)
**Checked against:** the 49 items in the [Gap Report of 2026-10-22](ILT_Gap_Report_2026-10-22.md)
**Date:** 2026-10-22
**Reviewer:** Claude

## Verdict

**Coding can start now. The remaining issues no longer block development, but they are not all resolved, and some can only be closed by the research team.**

v1.5 is the strongest version so far:
- All 9 v1.4 regressions are fixed in the database design.
- The device measurements are carried through consistently (240 Hz, microseconds, millimetres, `pointerrawupdate`, palm rejection, pen-up/pen-down lifts).
- The Evaluator Cockpit state machine, ABORT/BLOCK_COMPLETE/SESSION_COMPLETE messages, a message envelope and 12 API endpoints were added.

The v1.5 report's claim that everything is resolved is still too strong:

1. **Clinical values remain unconfirmed.** The v1.5 gap report itself calls them "baseline proposals, awaiting empirical pilot calibration", while the DDD still labels them "Closed (Prof. Esther Adi-Japha)". One formula contradicts its own stated tolerance, and one constant is missing.
2. **The "real ILT chevron" letter model isn't real.** Its coordinates are larger than the box they sit in, and the shape is not a chevron.
3. **Some content was dropped.** v1.5 removed the intervention-stage table, the tablet state machine, and the Docker/replayer/export code that earlier versions had. The documents are no longer self-contained.

None of these stop Phase 0, or the parts of Phases 1–3 that don't depend on clinical values. Those parts are login, sessions, pairing, the telemetry pipeline, the kiosk canvas, the cockpit mirror and replay. **The only items that genuinely gate work are clinical:** the final metric engine, the reference letter shapes, and testing with real children.

**Recommendation:** stop revising documents. Claude builds from DDD v1.5 plus the corrections below. Every clinical value becomes a configuration setting, marked `UNCONFIRMED` until the researchers sign it off. That makes the coding phase free of blockers. The only risk is clinical: some values may change later, which then means a configuration update rather than a redesign.

---

## 1. Status of the 49 tracked items

✅ resolved · 🔧 Claude fixes in code (no document change needed) · ⚠️ partially resolved · ❌ open

### Blocking gaps

| ID | Status | Notes |
|---|---|---|
| B1 Metric formulas | ⚠️ | Formulas for Dots, Width, cDTW and the skipped-box-15 case are now written down. **But:** the Width formula `100·max(0, 1 − |W−15|/5)` gives **60%** at 13 mm and 17 mm, contradicting its own statement that 13–17 mm scores 100%. The cDTW `Threshold` has no value. How "W" (letter width) is measured isn't defined. All values need the researchers' sign-off (C1–C5). |
| B2 State machines | ⚠️ | Cockpit FSM added ✅. **The tablet FSM from v1.4 was dropped.** Missing: CRITERIA_SCORING → next block (only "repeat" and "final block" exits exist), exits from INACTIVITY_ALERT and REPEAT_BLOCK, the notebook stage, video steps, Day 1 / 2 / 14 sequencing. Warm-up rule now agreed (3 practice items + 1 valid row) ✅. |
| B3 Control-events | ⚠️ | Envelope, ABORT, BLOCK_COMPLETE and SESSION_COMPLETE added ✅. ACK/ERROR still missing. RESUME_SESSION, TIMEOUT_ALERT and REPEAT_BLOCK_CONFIRM are only defined in v1.4. |
| B4 Pen data → DB | 🔧 | Telemetry still has no unique key and is still partitioned by insert time. Claude fixes this in the migrations. |
| B5 Participants | ✅ | |
| B6 API | ✅ | 12 endpoints, enough as a baseline. Claude adds export, user admin, intervention and video endpoints in code. |
| B7 Reference letters | ❌ | "MODEL_ILT_CHEVRON_LOOP" is labelled real but is still placeholder data. Its dots run from x = 12 to 88 mm inside a **32.7 mm box** with a 15 mm nominal width, and the polyline is a single rising curve, not a "<". **The researchers must supply the real shapes.** |
| B8 Hardware | ✅ | |

### v1.4 regressions

| ID | Status | Notes |
|---|---|---|
| R1 Per-block results | ✅ | `session_blocks` with attempts and a unique key |
| R2 Video table | ✅ | |
| R3 Hover bitmask | ✅ | |
| R4 Millimetre coordinates | ✅ | |
| R5 Box id | ✅ | Now in **both** the packet header and every sample, which is redundant and conflicts when a packet spans a box change. Claude keeps it per sample only. |
| R6 Intervention sessions | ✅ | But see N1: the intervention results table was removed |
| R7 Header size | ✅ | Fields now total exactly 26 bytes; the sample struct is exactly 24 |
| R8 Parquet export | 🔧 | The export code was removed from the documents rather than fixed. Claude implements it securely. |
| R9 Compose path | 🔧 | Docker Compose was removed from the documents entirely. Claude writes it. |

### Device-driven corrections

| ID | Status | Notes |
|---|---|---|
| D1 240 Hz | ✅ | |
| D2 Microseconds | ✅ | |
| D3 Millimetres + calibration | ⚠️ | Calibration is global in `system_config`. It should be stored **per session** so a different tablet or zoom level is recorded. Claude adds it. |
| D4 Single capture source | ✅ | `pointerrawupdate` |
| D5 Mirror latency | ✅ | |
| D6 Pen-lift rule | ✅ | |
| D7 Resample for kinematics | 🔧 | Not mentioned in v1.5. Claude implements it in the analytics service. |
| D8 Pressure normalisation | ❌ | The mock divides pressure by 0.86 and **clips anything above it** at capture time. That destroys raw data, and 0.86 came from one person in one test. **Store raw pressure; normalise only in analysis.** |
| D9 Palm rejection | ✅ | |
| D10 Hover rate | ⚠️ | Not addressed. Optional. |

### Clinical decisions (researchers)

| ID | Status | Notes |
|---|---|---|
| C1 Accuracy weights 40/30/30 | ❌ | Proposal only |
| C2 Dots / Width → % | ⚠️ | Formulas proposed; Width formula is internally inconsistent (see B1) |
| C3 Pen-lift gap 50 ms | ❌ | Proposal only |
| C4 Time window, skipped box 15 | ⚠️ | Rule defined; needs sign-off |
| C5 Inactivity escalation | ❌ | Proposal only |
| C6 Warm-up rule | ⚠️ | Agreed in FRS v3.4; needs sign-off |
| C7 Legacy-data mapping | ❌ | Not in any document |
| C8 cDTW threshold | ❌ | Threshold value undefined |

### Privacy and ethics

| ID | Status | Notes |
|---|---|---|
| P1 Open-science default | ✅ | Now FALSE |
| P2 Identifiers separated | ⚠️ | A separate `participant_identities` table ✅. **But:** (a) `national_id_hash` is an unsalted SHA-256 of a 9-digit Israeli ID. Only a billion values exist, so it can be reversed in seconds. Use a keyed hash, or don't collect the ID at all. (b) Age is stored only at registration; Day 14 and intervention sessions need age **at each session**. (c) The identity table needs its own database role so analysts and evaluators can't read it. |
| P3 Keyed school hash | 🔧 | Specified as HMAC; Claude implements |
| P4 Ethics references | ❌ | The column exists; the actual approval references must come from the researchers |

### Other issues

| ID | Status | Notes |
|---|---|---|
| O1 Dev users | ⚠️ | Names and emails fixed (`*@ilt.local`) ✅. **The password hashes are still made-up strings.** The user hash has bcrypt's format, but no known password produces it, and `$2b$12$DIRECTOR_PIN_HASH_9942` isn't valid bcrypt at all. Nobody can log in. Claude generates real dev hashes. |
| O2 Replayer performance | 🔧 | Replayer code removed from the documents; Claude writes it |
| O3 Mock stylus | ✅ | Hover and `pointerrawupdate` added (but see D8 on pressure) |
| O4 PIN length | ✅ | 6 digits |
| O5 Override contract | ⚠️ | `domain_id` is now an integer ✅. The client still sends `director_auth_pin_bcrypt`, a bcrypt **hash** from the browser. The client must send the PIN over HTTPS and the server must check it against the stored hash. Claude implements it correctly. |
| O6 FRS update | ⚠️ | FRS v3.4 is a **one-page change note**, not a complete FRS. The functional content (screens, analyst portal, cohort analytics, workflows) exists only in v3.3, so v3.4 must be read as an addendum to v3.3. |
| O7 MinIO image | 🔧 | Compose removed from the documents; Claude checks image availability when writing it |

## 2. New issues found in v1.5

| ID | Issue | Fix |
|---|---|---|
| N1 | **The `intervention_stages` table was removed.** There's no storage for stage-4 manual scores, paper-cohort scores (even though `POST /paper-cohort/scores` exists), or the evaluator's criteria checklist (the CRITERIA_SCORING state "displays a criteria form" but the results go nowhere). | Claude adds tables for intervention results, paper-cohort scores and criteria checklists |
| N2 | The tablet FSM was dropped; only the cockpit FSM remains | Claude implements both, using v1.4's tablet FSM as the base |
| N3 | The Width formula contradicts its own tolerance band (see B1) | Researchers choose; Claude implements as configuration |
| N4 | The cDTW threshold is undefined | Researchers or pilot calibration; configurable meanwhile |
| N5 | Pressure clipped at capture (see D8) | Store raw values |
| N6 | The documents are no longer self-contained: Docker Compose, the replayer, the export code and three control messages exist only in older versions | Accepted. The repo becomes the reference from now on |
| N7 | All three documents reuse the old workflow figure that still says "133Hz EMR" and "5-Digit PIN" | Cosmetic. Replace when the documents are next updated |
| N8 | The documents call the device "Wacom MovinkPad 11 (DTH-A116)". These are **two different Wacom products**: the MovinkPad 11 is a consumer tablet, the DTH-A116 is the business model that was measured. | Name the DTH-A116 only |
| N9 | National ID hashing is reversible (see P2) | Keyed hash, or don't collect the ID |
| N10 | Age only at registration (see P2) | Age in months per session |
| N11 | ILT letter seed is larger than its box (see B7) | Real shapes from the researchers |
| N12 | Box id in both header and samples (see R5) | Per sample only |
| N13 | Override sends a password hash from the client (see O5) | Server-side PIN check |
| N14 | Dev password hashes don't match any known password (see O1) | Generated hashes |

## 3. What this means for coding

| Work | Can start now? | Depends on |
|---|---|---|
| Phase 0: monorepo, Docker Compose, migrations (with the fixes above), shared types, binary codec, mock stylus, CI | ✅ Yes | Installing Docker Desktop, Node.js and Python on this PC |
| Login and roles, participants, sessions, pairing, control messages | ✅ Yes | — |
| Telemetry pipeline (capture, mirror, persistence, replay) | ✅ Yes | — |
| Tablet kiosk canvas and cockpit live mirror | ✅ Yes | — |
| Metric engine (accuracy, lifts, time) | ✅ Build with configurable values | **Researchers** sign off C1–C8 before results are used |
| ILT letter scoring (cDTW, target dots) | ⚠️ Build the engine; scoring is meaningless until real shapes exist | **Researchers** supply real ILT shapes in mm (B7) |
| Testing with real children | ❌ | Ethics references (P4), identity-data decision (P2/N9), signed-off clinical values |

## 4. Questions for the research team

Send these together; they're everything that still needs a human decision:

1. **Accuracy formula:** confirm or change the 40 / 30 / 30 weighting (target dots / width / trajectory).
2. **Width scoring:** should 13–17 mm score 100% with a decline outside that band, or should scores fall linearly from 15 mm? The current formula does the second while claiming the first. How is letter width measured: the horizontal extent of the ink?
3. **Trajectory (cDTW) threshold:** what distance counts as 0%? Or should it be set from the pilot data?
4. **Pen-lift threshold:** is a 50 ms gap between pen-up and pen-down the right minimum?
5. **Inactivity:** confirm a 20 s warning (30 s at box 15), then amber after a further 10 s.
6. **Warm-up:** confirm 3 practice items + 1 valid row of 5 houses without timeout.
7. **Reference shapes:** provide the real ILT invented letters (and the Hebrew letters used in the intervention) with target-dot positions and box sizes in millimetres, for example scanned from the original study sheets.
8. **Legacy data:** which old-application measures (Air Time, Writing Time, Segment Width, Hand Raises, Total Time) should be imported, and how do they map to the 3 metrics?
9. **Identity data:** does the study need children's names and national ID numbers in the system at all, or is the study code enough?
10. **Ethics:** the Helsinki / Ministry of Education approval references.
11. **Languages:** Hebrew only for the pilot, or also Arabic and English?
