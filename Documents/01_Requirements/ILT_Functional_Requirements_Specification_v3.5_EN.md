# ILT Research System: Functional Requirements Specification (FRS v3.5)

| | |
|---|---|
| **Document ID** | ILT-FRS-V3.5-EN |
| **Date** | 2026-10-28 |
| **Supersedes** | FRS v3.3 (full edition) and FRS v3.4 (change note). This edition is self-contained. |
| **Companion documents** | [Architecture v5.6](../02_System_Architecture/ILT_System_Architecture_and_Specifications_v5.6_EN.md) · [DDD v1.6](../03_Detailed_Design/ILT_Detailed_Design_Specification_v1.6_EN.md) · [Clinical Decisions Register](../04_Development_Plan/ILT_Clinical_Decisions_2026-10-25.md) |
| **Clinical basis** | Prof. Esti Adi-Japha, Dr. Hagit Hollander, Dr. Dorfberger |
| **Target tablet** | Wacom **DTH-A116** (Android 14, EMR pen), Chrome. Measured: [device profile](../04_Development_Plan/ILT_DTH-A116_Device_Profile.md) |
| **Languages (POC)** | Hebrew (default, right-to-left) and English |

Requirement IDs use the form `FR-<AREA>-<n>`. "Must" is mandatory for the POC; "should" is desirable.

---

## 1. Purpose and scope

An open-source, non-commercial research and intervention platform for early screening and remediation of handwriting and learning difficulties, from kindergarten through all elementary grades, with a focus on low socio-economic status (SES) populations.

The system digitises the **Invented Letter Task (ILT)**: a child repeatedly writes an invented letter in a grid of 15 boxes on a pen tablet. The system measures learning across sessions (Day 1, Day 2, Day 14) and supports the follow-up **intervention program** with real letters.

**Pilot cohort:** 50 children on the tablet, 50 on paper, and 50 legacy datasets from the previous application.

**In scope for the POC:** tablet kiosk, evaluator cockpit, comparative summary with replay, administration (settings, canvases, users), analyst portal with exports, application log.

## 2. Users and roles

| Role | Who | Main permissions |
|---|---|---|
| **System Administrator** (`ADMIN`) | Technical/clinical administrator | All settings at every scope; canvas library; reference recordings; users; domains and regions; application log; score recomputation |
| **Research Director** (`RESEARCHER` with a director PIN) | Lead researcher | Approves changes to clinically governed settings with the director PIN (when approval is switched on); sees all results |
| **Researcher** (`RESEARCHER`) | Research staff | Plans sessions and participants; sees results and summaries |
| **Evaluator** (`EVALUATOR`) | Runs sessions with children | Registers participants, runs sessions, scores intervention rows, replays own sessions |
| **Analyst** (`ANALYST`) | Not present at sessions | Read-only access to **de-identified research data** (sessions tagged `RESEARCH` only); replay; exports |

- **FR-ROLE-1** Every screen and API call is checked against the role table above.
- **FR-ROLE-2** Only the System Administrator can change settings and canvases (general instructions 5 and 10).
- **FR-ROLE-3** When "director approval" is on (default on), a change to a clinically governed setting (scoring factors, timers) also needs a Research Director's PIN, checked on the server.

## 3. Organisation and settings scopes

- **FR-ORG-1** Students are organised along two **independent** dimensions:
  - **Domain:** a category that groups students for ILT testing (for example a study group, a program or a population). It is **not necessarily geographic**. The System Administrator creates and names domains.
  - **Region:** a geographic area (for example an education district).
- **FR-ORG-2** Every participant belongs to one Domain and, optionally, one Region. A session takes both from the participant; the evaluator can change the session's Region (where the test takes place).
- **FR-ORG-3** Every setting has a **System** value (or built-in default). Depending on its type, it can be overridden for a **Domain** or for a **Region**; an override, when present, wins over the System value.
- **FR-ORG-4** **Scoring settings** (formula factors and weights) and **language configuration** are set at **System** level and can be overridden per **Domain** (instruction 5).
- **FR-ORG-5** **ILT-process settings** (timers, warm-up, video, protocol templates) are set at **System** level and can be overridden per **Region** (instruction 10).
- **FR-ORG-6** When a session is created, the system takes a **snapshot of all effective settings** and stores it with the session. Later setting changes never alter a past session silently.
- **FR-ORG-7** Every setting has a built-in default, an allowed range, and a description shown as a tooltip in the setup screen. The full catalogue is in DDD §6.

## 4. Languages and right-to-left support

- **FR-LANG-1** The application is multi-lingual: every label, button, message, instruction and error text comes from translation files, never from code (instruction 1).
- **FR-LANG-2** The POC ships **Hebrew** and **English** (instruction 2). Adding a language means adding a translation file and the language's canvases, with no code change.
- **FR-LANG-3** Hebrew is fully **right-to-left**: layout direction, text alignment, tables, menus, dialogs, icons with direction (arrows, "next"/"back"), number and date formatting (instruction 3). Study codes, numbers and English terms inside Hebrew text display correctly (bidirectional isolation).
- **FR-LANG-4** Each user picks their **interface language**; the default is Hebrew.
- **FR-LANG-5** Each session has a **child language**. It decides the tablet's instruction language and **which canvas sets are offered** when planning the session (instruction 7).
- **FR-LANG-6** The writing canvas is **never mirrored by the interface direction**. Its geometry comes only from the canvas and the language configuration (§5.4).
- **FR-LANG-7** Hebrew-capable fonts are bundled with the application (no internet needed at run time).

## 5. Canvas library

A **canvas** is the page the child writes on: an ILT grid, a notebook page, or an intervention letter sheet.

### 5.1 Organisation

- **FR-CAN-1** Canvases are grouped by **Language → Canvas set → Canvas** (instruction 7). A canvas set has a type: `ILT`, `NOTEBOOK` or `INTERVENTION_LETTERS`.
- **FR-CAN-2** The System Administrator can **load new canvases** for any language: ILT variants (e.g. a 4-dot letter) or real letters for the intervention phase.
- **FR-CAN-3** Canvases are **versioned** and have a status: Draft → Active → Retired. Sessions record the exact canvas version they used. An Active canvas can't be edited; a change creates a new version.

### 5.2 Canvas content

- **FR-CAN-4** A canvas keeps the basic graphic elements (instruction 8), all in millimetres at true size:
  - **Boxes** ("houses"), with position and size.
  - **Dots**, with an id (A, B, C, …), position inside the box, printed size, and role (start, target, end).
  - **Notebook lines**, in different styles (solid, dashed, dotted; weight; colour; spacing), including the authentic school-notebook ruling.
  - Optionally a **background image** (for example a scanned letter sheet), placed at true size.
- **FR-CAN-5** Intervention canvases also hold, per box: the letter, the row type (row 1 trace over model with dots; row 2 start dot only; row 3 freehand), the model path used for the similarity hint, and whether **pen lifts are allowed inside the letter** (multi-stroke letters; seeded for ה ק ח ת א).
- **FR-CAN-6** The system validates a loaded canvas (it must fit the tablet screen at true size, dots must lie inside their boxes, ids must be unique) and shows a **true-size preview** on a paired tablet before activation.

### 5.3 Scoring profile and reference recordings

- **FR-CAN-7** Each ILT and intervention canvas has a **scoring profile** (instruction 9):
  - **Dot order**, e.g. A → B → C or A → C → B → D.
  - Per dot: **hit radius (mm)**, **accuracy weight (%)**, and whether the dot is **required** for the letter to count as accurate. Weights total 100%.
  - **Expected pen lifts per block** and **box fill order**, both taken from a sample block drawn by the System Administrator (FR-CAN-9).
  - **Normal speed** (mm/s) and **flexibility range** (± %), taken from a skilled writer's sample (FR-CAN-10).
- **FR-CAN-8** A Domain can **override** a canvas's scoring profile (instruction 5). The setup screen shows which values are inherited and which are overridden.
- **FR-CAN-9** **Sample block filling:** the System Administrator pairs a tablet in *reference mode*, the canvas is displayed, and they draw a complete sample block. The system derives the fill order (the order in which boxes were written) and the number of pen lifts. **[Accept]** saves the values to the scoring profile; **[Clear]** discards the sample and lets them draw again.
- **FR-CAN-10** **Normal speed sample:** a person skilled in writing draws **one row** of the canvas on a paired tablet in reference mode. The system computes the average speed with the same formula used for children (§9.4) and shows it. **[Accept]** stores it as the Normal speed; **[Clear]** discards it.
- **FR-CAN-11** Reference recordings keep their raw pen data, who recorded them and when. They are never shown as participant data.

ILT defaults (seeded from the final 35 × 25 mm sheet):

| Dot | Position in box (mm) | Hit radius | Accuracy weight | Required |
|---|---|---|---|---|
| A | (14.5, 2.6) | 3.5 mm | 5% | No |
| B | (20.0, 12.6) | **1.3 mm** | **90%** | **Yes** |
| C | (14.5, 22.7) | 3.5 mm | 5% | No |

Dot order A → B → C, **required**. Expected pen lifts per block 15. Fill order: Hebrew right to left from the top-right box. Normal speed: not set until recorded. Flexibility ± 10%.

The radius is measured from the dot's centre. The printed dots have a radius of about 1.3 mm, so the default B = 1.3 mm means **the line must touch the printed dot B**. The administrator can make it stricter (down to 0.0 mm, the exact centre) or looser. The setup screen shows the printed dot size next to the radius (decisions register I4).

### 5.4 Language configuration

- **FR-CAN-12** For each language, at System or Domain level, the System Administrator selects:

| Setting | Example (English) |
|---|---|
| ILT block canvas | from the list of the language's ILT canvases |
| Notebook canvas | from the language's notebook canvases |
| Real-letter canvas set | from the language's intervention sets |
| Fill direction | Left to right (list: right to left, left to right) |
| Mirrored block | Yes / No |

- **FR-CAN-13** **Mirrored block = Yes** mirrors each box's dot pattern horizontally (so ">" becomes "<"). Scoring uses the mirrored geometry. Defaults: Hebrew not mirrored, right to left; English **not mirrored**, left to right. Both options stay available (Prof. Adi-Japha: no research yet on which direction suits English writers, and some English letters such as b and p share the current form).
- **FR-CAN-14** If a canvas has a recorded sample fill order, it is used. The language fill direction is the default when there is no sample. The setup screen warns when the two disagree.

## 6. Participants, consent and session planning

- **FR-PART-1** A participant is identified only by a **study code**. **No names, national ID numbers or initials** are stored. The PI keeps the code-to-child list outside the system.
- **FR-PART-2** Stored per participant: study code, Domain, Region, school code (keyed hash), grade, gender, SES group, dominant hand, birth month and year (to compute age), legacy dataset link if any.
- **FR-PART-3** **Age in months** is computed and stored **for every session**.
- **FR-PART-4** Consent is recorded per participant with version and date. Defaults are the most private: **hand video off, research use off, open-science sharing off**.
- **FR-PLAN-1** A session has a **purpose**: `INTERVENTION` (default) or `RESEARCH`. `RESEARCH` can only be chosen when research ethics approval is configured and the participant consented to research use.
- **FR-PLAN-2** A session is created from a **protocol template**: an editable ordered list of steps. Step types: video, warm-up block, ILT block, notebook page (tablet), paper notebook page (timed in the cockpit), intervention sheet.
- **FR-PLAN-3** Default templates:

| Template | Steps |
|---|---|
| **Day 1** | Intro video → warm-up ILT block (unscored, verbal help allowed) → ILT blocks 1–4 → notebook demo video → notebook pages 1–4 (tablet) → ILT blocks 5–8. Thirteen writing blocks in total |
| **Day 2** | ILT blocks 1–4 (tablet) → 2 pages in a real paper notebook, timed by the evaluator |
| **Day 14** | ILT blocks 1–2 (tablet). Also the first learning task of the intervention program |
| **Intervention** | Intervention sheets from the language's letter set, in the order chosen by the evaluator |

- **FR-PLAN-4** The canvases offered for each step come from the **session language's configuration** (FR-CAN-12). The evaluator can pick another active canvas of the same type and language.
- **FR-PLAN-6** **Instruction videos** are kept in a video library by **video key and language**, managed by the System Administrator (upload, replace with a new version, retire), like canvases. A video step in a template names only the key (`intro`, `notebook_demo`); the tablet plays the version for the **session language**, full screen, from the local server (no internet needed).
- **FR-PLAN-7** **Hebrew intro video:** `ILT_Instruction_Demo_v6_No_Avatar_Hebrew_Female_VO.mp4` (1 min 19 s, Hebrew female voice-over; source in the repo under `Documents/08_Presentations_and_Demos/`) is the ILT introduction and guidance for students in Hebrew sessions. **Hebrew notebook demo video:** `ILT_in_Notebook_Demo.mp4` (31 s, same folder) is played before the notebook pages in Hebrew sessions.
- **FR-PLAN-8** If a template's video has no version in the session language (for example the English intro and notebook demo until they are produced), the cockpit warns in the step preview; the evaluator can skip the step or explain verbally. The skip is logged.
- **FR-PLAN-5** Notebook pages on the tablet use **the same letter as the ILT**, 3 rows × 5 letters, and are **timed only** (no accuracy score).

## 7. Tablet kiosk (child)

- **FR-TAB-1** Pairing with the cockpit uses a **6-digit PIN**.
- **FR-TAB-2** The canvas is drawn at **true physical size** using the tablet's calibration (5.195 CSS px/mm on the DTH-A116, set per tablet with an on-screen ruler).
- **FR-TAB-3** Only pen input is accepted while a block is active; **all touch input is ignored** (palm rejection).
- **FR-TAB-4** **Forward-only locking:** boxes are written in the fill order; finished boxes lock.
- **FR-TAB-5** Inactivity: a subtle visual cue on the tablet after **20 s** without writing (**30 s** after the last box); after a further **10 s** the cockpit turns amber and the Manual Finish button flashes. Values are ILT-process settings.
- **FR-TAB-6** The kiosk captures every pen sample (~240 per second, with position, pressure, tilt, hover and timing) and keeps a local buffer, so a network drop loses no data.
- **FR-TAB-7** Instructions and messages on the tablet use the **session language**, with the correct direction.
- **FR-TAB-8** In reference mode (FR-CAN-9/10) the kiosk shows a clear "reference recording" banner and the [Accept] / [Clear] controls appear in the administrator's screen.

## 8. Evaluator cockpit

- **FR-COCK-1** The cockpit shows an **80% live mirror** of the tablet canvas (latency under 15 ms on the local network), with ink coloured by pressure and the in-air hover path in yellow, and a **20% clinical telemetry panel**.
- **FR-COCK-2** Clinical telemetry panel lines: active box (e.g. house 6 / 15); total block time; current inactivity time against the threshold; pen lifts in block (norm 15 at the end); internal pen lifts (errors) with the house numbers; width outside the band (recorded, not scored); middle target dot B hit rate; skipped houses; **average ILT speed (mm/s)** (new in v3.5).
- **FR-COCK-3** Controls: dispatch next step; pause / resume (with reason); manual finish block; repeat block (reset on disruption, the first attempt is kept for audit); abort session; open the comparative summary.
- **FR-COCK-4** **Paper notebook pages:** the evaluator starts and stops a timer per page and can add notes.
- **FR-COCK-5** **Intervention marking:** after each row, the cockpit shows the five letters with the system's suggestion already filled in (✓ / ✗). The evaluator changes only what they disagree with. Each mark records who set it (system or evaluator).

| Row | What the child does | Correct when | Decided by |
|---|---|---|---|
| 1 | Traces over the model through the dots | All dots touched in order and no pen lift inside the letter, **except ה ק ח ת א** (configurable per letter) | System |
| 2 | Writes from the start dot only | Starts at the correct starting point **and** the general form is right | System checks the start; evaluator confirms the form |
| 3 | Writes freehand | Recognisably the letter, right stroke direction, starting about where row 2 started | Evaluator |

- **FR-COCK-6** The automatic similarity hint (shape comparison with the model letter) may be shown for row 3 but **never counts** toward the score. It is stored for later comparison with evaluator decisions.

## 9. Measures and scoring

### 9.1 Raw data first

- **FR-MEAS-1** The system stores **raw data**, not only results (instruction 4): every pen sample, every pen-up and pen-down, and for every letter and block the raw measures below. Analysts can recompute any score from the stored data.
- **FR-MEAS-2** Every computed score is stored **with the settings and canvas profile used** to compute it. The System Administrator can **recompute** scores with changed settings; each recomputation is a new, labelled score version, and earlier versions are kept.

### 9.2 Per-letter raw measures (ILT)

For each box: start and end time; contact path; for each dot the **closest distance** from the pen path to the dot centre and whether it was hit; whether the dots were reached in the configured order; **width** (horizontal travel, (furthest point toward B − start) + (furthest point toward B − end)) and whether it's within 9–13 mm; number of internal pen lifts; **line length**; **line drawing time**; **letter speed**.

### 9.3 Accuracy

- **FR-SCORE-1** **Letter accuracy score** = sum of the weights of the dots hit. With the defaults: hitting B alone gives 90; A, B and C give 100; missing B gives at most 10.
- **FR-SCORE-2** **Letter accurate (yes/no):** all required dots are hit (default: **dot B only**) **and** the dots are passed in the **required order A → B → C** (default on). The order is checked from the time the pen passes each dot: first touch for a touched dot, closest approach for an untouched one, so A and C don't have to be touched. Optional extra conditions, off by default: width within band, no internal pen lift. All conditions are switchable at System/Domain level.
- **FR-SCORE-3** **Block accuracy score** = average letter accuracy score over the expected letters (15), counting missing letters as 0. The block also reports the **number of accurate letters (0–15)**.

### 9.4 Speed

- **FR-SCORE-4** **Line length** = the pen path from where it first enters dot A's hit radius, through B's radius, to where it last leaves C's radius (first and last dot of the configured order). If the first or last dot isn't hit, the letter's first or last pen contact is used instead, and the letter is flagged.
- **FR-SCORE-5** **Letter speed** = line length ÷ line drawing time, stored for every letter.
- **FR-SCORE-6** **Average ILT speed (block)** = Σ line length ÷ Σ line drawing time.
- **FR-SCORE-7** **Speed score**, with Normal speed *N* and flexibility *f*: lower bound *L* = *N* × (1 − *f*), upper bound *U* = *N* × (1 + *f*).
  - *L* ≤ *X* ≤ *U* → **100**
  - *X* < *L* → **100 / (*L* / *X*)**
  - *X* > *U* → **100** (default; a setting can apply 100 / (*X* / *U*) instead)
  - Example: *N* = 19.45 mm/s, *f* = 10% → range 17.50–21.40; *X* = 15.00 → **85.7**.
  - With no Normal speed recorded, the speed score shows "not configured".

### 9.5 Pen lifts

- **FR-SCORE-8** A pen lift is counted when the gap between pen-up and the next pen-down is at least **50 ms** (setting). The pen-up after the last letter counts.
- **FR-SCORE-9** **Pen-lift score** = **100 / (*X* / *E*)**, where *X* is the pen lifts in the block and *E* the expected number from the canvas profile (ILT: 15). Capped at 100. Example: 17 lifts → **88.24**. A block with no writing has no pen-lift score.
- **FR-SCORE-10** **Internal pen lifts** (lifts inside a letter) are counted separately and shown per house.

### 9.6 Time

- **FR-SCORE-11** **Total block time** runs from the first pen-down in the first box to the last pen-up in the last box. If the last box is skipped, it ends at the last contact and the block is flagged with the number of skipped boxes. Active writing time and air time are stored too.

### 9.7 Composite score and pass / fail

- **FR-SCORE-12** **Composite** = 50% × speed score + 25% × accuracy score + 25% × pen-lift score (weights are settings, must total 100). Applies to ILT blocks and intervention sheets.
- **FR-SCORE-13** The composite is **always shown next to the separate component scores**, never instead of them. The three clinical metrics (time, pen lifts, accuracy) are never merged in storage.
- **FR-SCORE-14** **Pass / Fail:** composite ≥ threshold → Pass, otherwise Fail. The threshold is a setting shown and edited (by the System Administrator) in the Comparative Summary Dashboard. Until it is set, pass/fail shows "not configured".

### 9.8 Intervention sheets

- **FR-SCORE-15** Each letter in each row gets one mark, stored as **error: yes/no** and shown as ✓ / ✗ (FR-COCK-5).
- **FR-SCORE-16** Sheet accuracy score = correct marks ÷ marks × 100. Pen-lift and speed scores use the letter canvas's own profile (expected lifts and Normal speed from its reference recordings). Width is not scored for intervention letters.

## 10. Comparative Summary Dashboard

- **FR-SUM-1** Compares anchor pairs: **Day 1 first pair** (blocks 1–2), **Day 1 last pair** (blocks 7–8), **Day 2 first pair** (blocks 1–2), **Day 2 last pair** (blocks 3–4), **Day 14** (blocks 1–2).
- **FR-SUM-2** Each box shows: average time, pen lifts, accuracy %, **average ILT speed**, the **separate component scores** (speed, accuracy, pen lifts), the composite, and Pass/Fail.
- **FR-SUM-3** Each box has a **[Replay]** button (§11).
- **FR-SUM-4** The pass threshold and composite weights in effect are shown on the dashboard; the System Administrator can change the threshold there.

## 11. Replay

- **FR-REP-1** **[Replay]** plays back the mirrored cockpit for the selected blocks, like a video, with a controls bar: play/pause, timeline scrubber, speed 0.25× to 4×, frame step.
- **FR-REP-2** During replay the **computed ILT speed is shown under each house**, and the recorded pen data (pressure, hover path, pen lifts, timing) is displayed.
- **FR-REP-3** If hand video was recorded (with consent), it plays in sync.
- **FR-REP-4** Evaluators can replay sessions they ran; researchers all sessions; analysts only `RESEARCH` sessions.

## 12. Analyst portal and exports

- **FR-AN-1** De-identified access for analysts: session replay, kinematic views (velocity, jerk, pressure), and cohort slicing by Domain, Region, school code, grade, gender, SES, dominant hand, language, session stage, canvas, and timer settings.
- **FR-AN-2** Exports to Parquet and CSV for open-source tools (DuckDB, Jupyter, Apache Superset/Metabase), including raw samples, per-letter measures, per-block measures and score versions.
- **FR-AN-3** **Only sessions tagged `RESEARCH`, from participants with research consent, are visible to analysts or exportable.** Until research approval exists, the portal is empty by design.

## 13. Application log

- **FR-LOG-1** Every action is written to a detailed application log (instruction 6): logins and logouts, failed logins, participant and consent changes, session creation, pairing, each step dispatched, pause/resume/abort, block completion, inactivity alerts, repeats, intervention marks (with old and new value), settings changes (with old and new value and who approved), canvas loads and activations, reference recordings, score recomputations, exports, replays, errors.
- **FR-LOG-2** Each entry has a fixed structure: time, event type (from a fixed vocabulary, e.g. `session.block.completed`), severity, user and role, device, Domain/Region, session, the affected record, and details. No child-identifying data.
- **FR-LOG-3** The System Administrator has a **log search screen**: filter by time range, event type, user, session, Domain/Region, severity, and free text; export results to CSV.
- **FR-LOG-4** The log is append-only. Entries can't be edited or deleted through the application.

## 14. Privacy, ethics and video

- **FR-PRIV-1** Privacy by default: no identity data (FR-PART-1), consent defaults off (FR-PART-4), video off.
- **FR-PRIV-2** Desk/hands video (RTSP/ONVIF/USB camera, hands only) is recorded only when the system setting allows it **and** the participant's consent allows it.
- **FR-PRIV-3** Current use runs under the Chief Scientist's approval for the intervention program (not research). Previous IRB reference: 287/8918/2015. The research approval reference is entered when received.
- **FR-PRIV-4** School codes are stored as keyed hashes.

## 15. Legacy data and paper cohort

- **FR-LEG-1** Import of the previous application's exports (sample files in `05_Measures/Samples`): Hand Raises → pen lifts; Segment Width → width; Total Time → total time; Writing Time and Air Time → active writing time and air time.
- **FR-LEG-2** Manual entry of paper-cohort scores (pen lifts, accuracy, time per block) by evaluators.

## 16. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Capture every pen sample at the device rate (~240 Hz, design 240, buffers sized for 270) with 0.1 ms timing |
| NFR-2 | Live mirror latency under 15 ms on the local network |
| NFR-3 | No data loss on a network drop: local buffer on the tablet, idempotent upload, integrity hash per block |
| NFR-4 | Runs on the local network without internet during sessions |
| NFR-5 | All passwords and PINs hashed; HTTPS everywhere; role checks on the server |
| NFR-6 | Hebrew RTL and English LTR fully supported in every app |
| NFR-7 | Open-source components only |
| NFR-8 | Every action logged (§13) |

## 17. Traceability: round-3 inputs

| Input | Requirements |
|---|---|
| Instruction 1–3 (languages, RTL) | FR-LANG-1…7, NFR-6 |
| Instruction 4 (raw data) | FR-MEAS-1, FR-MEAS-2, §9.2 |
| Instruction 5 (formula settings, Domain level) | FR-ORG-4, FR-CAN-8, FR-ROLE-2 |
| Instruction 6 (application log) | FR-LOG-1…4 |
| Instruction 7–8 (canvas library, elements) | FR-CAN-1…6, FR-PLAN-4 |
| Instruction 9 (per-canvas formula, sample drawing, speed benchmark) | FR-CAN-7…11 |
| Instruction 10 (Region-level ILT settings) | FR-ORG-1, FR-ORG-5 |
| Domain = student-grouping category, not geographic (Yaki, 2026-10-28) | FR-ORG-1…4 |
| Dot B accuracy, per-dot radius and weight | FR-SCORE-1…3, §5.3 table |
| Width for speed, speed formula and benchmark | FR-SCORE-4…7, FR-CAN-10 |
| Pen-lift score | FR-SCORE-8…10 |
| Composite, separate scores, pass/fail | FR-SCORE-12…14, FR-SUM-2, FR-SUM-4 |
| English mirroring | FR-CAN-12, FR-CAN-13 |
| Replay in summary boxes, speed per house | FR-SUM-3, FR-REP-1…4 |
| Average ILT speed in telemetry | FR-COCK-2 |
| Alef added to multi-stroke letters | FR-CAN-5, FR-COCK-5 |
| Warm-up extra, videos kept, notebook timed only | FR-PLAN-3, FR-PLAN-5 |
| Hebrew intro video (Yaki, 2026-10-28) | FR-PLAN-6…8 |

## 18. Changes from FRS v3.3 / v3.4

- Added: languages and RTL (§4), organisation scopes and settings (§3), canvas library with scoring profiles and reference recordings (§5), application log (§13), replay from the summary (§11), raw-data rule and score versions (§9.1).
- Changed: accuracy is now based on per-dot weights with **dot B** and the **A → B → C order** required; width moved from accuracy to **speed**; new speed and pen-lift scores; composite 50/25/25 with separate component scores; warm-up is one full extra block (replaces "3 practice items + 1 valid row"); intervention exceptions now include א; the device is named DTH-A116 only.
- Removed: identity table and national ID; the 40/30/30 accuracy formula and 35/40/25 composite; automatic cDTW scoring of row 3 (now a hint only); the "chevron with loop" placeholder letter.
- Kept from v3.3: analyst portal and cohort analytics, camera-agnostic optional video, unlimited templates (now the canvas library), 20 s timer defaults, three distinct clinical metrics.
