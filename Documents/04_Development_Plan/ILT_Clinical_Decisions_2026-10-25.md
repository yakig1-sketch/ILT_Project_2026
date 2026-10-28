# ILT Clinical Decisions Register

**Last updated:** 2026-10-28 (round 3 replies and general development instructions)
**Sources:**
- Round 1: [reply document](ILT_Clinical_Answers_Review_2026-10-22_REPLY_V01.doc), with comments by Dr. Hagit Hollander and Yaki Grossman on the [answers review](ILT_Clinical_Answers_Review_2026-10-22.md)
- Round 2: the research team's replies of 2026-10-26 to the open questions in this register
- Round 3: [general instructions and researcher replies](ILT_General_Instructions_and_Researcher_Replies_2026-10-28.pdf) of 2026-10-28 (10 general development instructions from Yaki Grossman, replies from Prof. Esti Adi-Japha's team, and Yaki's notes)
- **Final Day 1 sheet (35 × 25 mm):** [with dimensions](../05_Measures/ILT_Day1_Sheet_A4_35x25_Dimensions.pdf), [clean printable version](../05_Measures/ILT_Day1_Sheet_A4_35x25_Clean.pdf), and the [geometry data](../05_Measures/ILT_Day1_Grid_Geometry.json)

**Reviewer:** Claude

**Where this lands:** these decisions are written into [FRS v3.5](../01_Requirements/ILT_Functional_Requirements_Specification_v3.5_EN.md), [Architecture v5.6](../02_System_Architecture/ILT_System_Architecture_and_Specifications_v5.6_EN.md) and [DDD v1.6](../03_Detailed_Design/ILT_Detailed_Design_Specification_v1.6_EN.md). Where this register and an older document disagree, this register wins.

**Principle:** every clinical value is a **setting with a default**, changed only by the System Administrator (instructions 5 and 10). The system can be used now, and values can be tuned once real data exists, without code changes.

## 1. Decided

| Topic | Decision | Round |
|---|---|---|
| ILT geometry | Boxes **35 × 25 mm**, 10 mm between rows, grid 175 × 95 mm. Dots A (14.5, 2.6), B (20.0, 12.6), C (14.5, 22.7) mm from each box's top-left | 2 |
| Letter in Hebrew | ">" as printed, written A → B → C, boxes filled right to left from the top-right box | 1 |
| Letter in English | Boxes filled left to right from the top-left box. **Mirroring stays an open choice** (Prof. Adi-Japha): a per-language setting, default not mirrored | 3 |
| **ILT accuracy** | A letter is accurate when **dot B is touched** and the letter is written in the **required order A → B → C** (top-down). Dots A and C don't have to be touched. Order is checked by when the pen passes each dot: first touch for a touched dot, closest approach for an untouched one. Accuracy for memory consolidation and learning = **pen lifts + touching B** | 3 (order required: Yaki, 2026-10-28) |
| **Dot hit radius and weight, per dot** | Each dot has its own hit radius and accuracy weight. Defaults: **A 3.5 mm / 5%, B 1.3 mm / 90%, C 3.5 mm / 5%** (weights total 100%). B = 1.3 mm means touching the printed dot (changed from 0.5 mm by Yaki, 2026-10-28). Setting B to 0.0 mm / 100% is allowed if the researchers want absolute accuracy | 3 |
| **Width (segment size)** | **Not an accuracy measure.** It's used to compute **speed** (Prof. Adi-Japha: speed = segment size ÷ time). The 9–13 mm band is still recorded for future standardisation | 3 |
| **ILT line length and speed** | Line length = pen path from where it enters dot A's radius, through B's radius, to where it ends in C's radius. Speed is computed and stored **per letter**. **Average ILT speed per block = Σ line length ÷ Σ line drawing time** | 3 |
| **Normal ILT speed (benchmark)** | A setting in mm/s, measured by recording **one row of ILT drawn by a skilled writer** on a connected tablet, with Accept / Clear. Plus a **flexibility range ± %** (default 10%) | 3 |
| **Speed score** | Inside the range → 100. Below the lower bound L: **score = 100 / (L / X)**. Example: normal 19.45 mm/s ± 10% → range 17.50–21.40; X = 15.00 → 85.71 | 3 |
| **Pen-lift score** | Expected lifts per ILT block = 15 (one per letter). **Score = 100 / (X / 15)**. Example: 17 lifts → 88.24 | 3 |
| Composite score | **Speed (time) 50% · Accuracy 25% · Pen lifts 25%**, for both ILT and intervention, always shown **next to a separate score for each component** | 2, 3 |
| Pass / Fail | Configurable threshold on the composite, shown and set in the Comparative Summary Dashboard | 2, 3 |
| Reference time per block / penalty per lift (my round-2 proposal) | **Rejected** (Prof. Adi-Japha did not approve). Replaced by the speed and pen-lift scores above | 3 |
| 40/30/30 accuracy formula | Dropped | 2 |
| Warm-up | One full block, verbal help allowed. **Extra**: Day 1 = warm-up + 12 blocks = 13 blocks. Both demo videos stay | 2, 3 |
| Hebrew intro video | `ILT_Instruction_Demo_v6_No_Avatar_Hebrew_Female_VO.mp4` (1:19, in `Documents/08_Presentations_and_Demos/`) is the ILT introduction and guidance for students in Hebrew sessions. `ILT_in_Notebook_Demo.mp4` (0:31, same folder) is the Hebrew notebook demo. Videos are stored per language; English has none yet | Yaki, 2026-10-28 |
| Notebook pages on the tablet | Same letter as the ILT, 3 rows × 5 letters, **timed only** | 3 |
| Intervention scoring | Row 1 automatic (dots in order, no internal lift, **except ה ק ח ת א**); row 2 start point automatic + evaluator confirms form; row 3 evaluator decides. The cockpit pre-fills the system's suggestions | 2, 3 (Alef added) |
| Automatic trajectory scoring | Shown only as a hint, never counted, saved for later comparison with evaluators. Approved | 3 |
| Replay | A **[Replay] button in each box of the Comparative Summary**: replays the mirrored cockpit with video-style controls, shows the **ILT speed under each house**, and shows the recorded pen data | 3 |
| Clinical telemetry panel | Add a line: **Average ILT speed** | 3 |
| Pen lifts | 50 ms minimum gap between pen-up and pen-down | 1 |
| Inactivity | 20 s (30 s after the last box), then amber after a further 10 s | 1 |
| Legacy data mapping | Approved | 1 |
| Identity data | No names or ID numbers in the system; study codes only | 1 |
| Day protocol | Day 1: videos, warm-up, ILT 1–4, notebook 1–4 (tablet), ILT 5–8. Day 2: ILT 1–4 + 2 paper-notebook pages timed in the cockpit. Day 14: 2 ILT blocks (also the first intervention task) | 2, 3 |
| Ethics and data use | Sessions tagged `INTERVENTION` (default) or `RESEARCH`; research exports include only research sessions. Ask the ethics committee to also approve research use of intervention-period data (agreed) | 2, 3 |

## 2. General development instructions (round 3)

| # | Instruction | How it's implemented |
|---|---|---|
| 1–3 | Multi-language; Hebrew and English in the POC; **full RTL** for Hebrew | All UI text from translation files; `dir="rtl"` layout for Hebrew; each user picks a UI language and each session has a child language. Canvas geometry is never flipped by UI direction |
| 4 | **Store raw data**, not only computed results | Every pen sample, plus per-letter raw measures (line length, time, speed, dot distances, width, lifts, order) and per-block raw counts. Scores are stored separately with the settings used, so they can be recomputed |
| 5 | Every formula factor and weight is a **System Administrator setting with a default**, changeable at **Domain** level only by the System Administrator | Settings catalogue with scopes System → Domain for scoring settings; each canvas has a scoring profile that a Domain can override |
| 6 | **Detailed, searchable application log** of every action | Structured event log (JSON lines + database table) with a fixed event-type vocabulary and a search screen |
| 7 | System Administrator **loads new canvases** (ILT or real letters) per language, grouped **Language → Set → Canvas**; the session language decides which canvases are offered | Canvas library with versioned canvases; per-language configuration picks the ILT, notebook and letter canvases |
| 8 | Canvas basics: **boxes, dots, notebook lines** in different styles | Canvas JSON schema with boxes, dots and line styles, plus an optional background image |
| 9 | Per canvas: **dot order** (e.g. A → C → B → D) and **per-dot radius**; a **default speed benchmark**; **pen lifts per block and fill order** taken from a **sample block drawn by the System Administrator** on the tablet | Canvas scoring profile; "reference recording" mode on the tablet with Accept / Clear |
| 10 | ILT-process settings changeable by the System Administrator at **Region** level | ILT-process settings (timers, warm-up, video, protocol) have a System value with an optional Region override |

## 3. Interpretations made (none blocks coding; each is a setting)

| # | Point | What the system does by default | Why |
|---|---|---|---|
| I1 | **Domain vs. Region** | **Resolved (Yaki, 2026-10-28):** a Domain is a **category that groups students for ILT testing**, not necessarily geographic. Region is a separate geographic dimension. Scoring and language settings can be overridden per Domain; ILT-process settings per Region | — |
| I2 | Which "time" score goes into the 50% part of the composite | The **speed score** | It's the only time-based score the team defined, and speed is time normalised by size |
| I3 | Average speed **above** the normal range | Scores **100** (no penalty for being fast) | Not specified. A setting can switch to a symmetric penalty, 100 / (X / upper bound) |
| I4 | **Dot B radius** vs. the printed dot (radius ~1.3 mm) | **Resolved (Yaki, 2026-10-28):** radius measured **from the dot's centre**, default **1.3 mm**, so touching the printed dot counts, matching "only dot B must be touched" | The setup screen shows the printed dot size next to the value; the administrator can make it stricter (0.5 mm, or 0.0 mm for the exact centre) |
| I5 | Pen lifts fewer than expected (score above 100) | Capped at 100; a block with no writing has no pen-lift score | Formula is undefined for X = 0 |
| I6 | Language "fill direction" vs. fill order from the sample drawing | The canvas's recorded sample is authoritative; the language fill direction is the default for canvases without a sample, and the setup screen warns if they disagree | Both were asked for |
| I7 | Notebook letter shown as "<" in the PDF | The source file contains ">"; the PDF shows "<" because of right-to-left text mirroring. **Same letter as the ILT** | Checked in the .docx |
| I8 | "LTR" in the instructions | Read as **ILT** (e.g. "LTR writing speed" = ILT speed) | Context |

## 4. Remaining questions

None block coding. Items I1–I8 above have working defaults; the team can confirm or change them at any time through the settings. The only open items are outside the software:
- **Research ethics approval** (expected within ~3 months). Until then the analyst portal and research exports stay empty by design.
- **Intervention letter dot positions:** Claude measures them from the 16 letter sheets plus the Tet sheet once Python is installed (Phase 0), and the team checks them.
- **Normal ILT speed:** recorded by a skilled writer on the tablet once the system runs. Until then the speed score shows "not configured".
- **Pass threshold:** chosen from the first data.
