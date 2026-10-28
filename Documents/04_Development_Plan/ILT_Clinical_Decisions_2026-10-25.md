# ILT Clinical Decisions Register

**Last updated:** 2026-10-26 (round 2 replies)
**Sources:**
- Round 1: [reply document](ILT_Clinical_Answers_Review_2026-10-22_REPLY_V01.doc), with comments by Dr. Hagit Hollander and Yaki Grossman on the [answers review](ILT_Clinical_Answers_Review_2026-10-22.md)
- Round 2: the research team's replies of 2026-10-26 to the open questions in this register
- **Final Day 1 sheet (35 × 25 mm):** [with dimensions](../05_Measures/ILT_Day1_Sheet_A4_35x25_Dimensions.pdf), [clean printable version](../05_Measures/ILT_Day1_Sheet_A4_35x25_Clean.pdf), and the [geometry data](../05_Measures/ILT_Day1_Grid_Geometry.json). The earlier 34 × 25 "Corrected" sheets and the first scanned measurement are kept for history only.

**Reviewer:** Claude

**Principle adopted for everything still open:** any clinical value the researchers haven't fixed becomes a **setting in the ILT setup screen**, with a sensible default. The system can then be used now, and the values can be tuned once real data exists, without code changes.

## 1. Decided

| Topic | Decision |
|---|---|
| Approval | Dr. Hollander reviewed and approved the answers, except where her comments change them |
| ILT geometry | Boxes **35 × 25 mm**, all identical (final sheet, 2026-10-26); **10 mm** between rows; grid **175 × 95 mm** (fits the tablet screen at true size). Dots A (14.5, 2.6), B (20.0, 12.6), C (14.5, 22.7) mm from each box's top-left |
| Letter in Hebrew | **">" as printed**, written **A → B → C**, boxes filled **right to left** starting at the top-right box |
| Letter in English | Boxes filled **left to right** starting at the top-left box. **Mirroring is Prof. Adi-Japha's decision**, so it's a per-language setting (see §3) |
| ILT width rule | Total horizontal travel while writing the letter, **11 ± 2 mm** (9–13 mm). **Approved** |
| Warm-up | **One full block**; verbal help from the evaluator allowed; then continue to block 1 |
| Intervention scoring | Per letter, per row, on the criteria in §2.2. **Width is not scored for intervention letters**, because every letter has a different size |
| Composite (summary) score | **Time 50% · Accuracy 25% · Pen lifts 25%.** Replaces 35/40/25. Shown next to the 3 separate metrics, never instead of them |
| Pass / Fail | A **configurable threshold** on the composite score, set in the Comparative Summary Dashboard: composite ≥ threshold → Pass (1), otherwise Fail (0) |
| 40/30/30 accuracy formula | **Dropped.** Accuracy is defined by the letter-correctness rules in §2 |
| Dot-touch radius | The DDD (v1.4/v1.5) sets **3.5 mm**; the FRS doesn't specify it. It becomes a **setting in the ILT setup screen**, default 3.5 mm |
| Pen lifts | 50 ms minimum gap between pen-up and pen-down. Approved |
| Inactivity | 20 s (30 s after box 15), then amber after a further 10 s. Approved |
| Legacy data mapping | Approved |
| Identity data | No names or ID numbers in the system; study codes only |
| Languages | Hebrew and English |
| Intervention letter dot positions | **Claude measures them** from the program's letter sheets in the repo, and the team checks them (§2.3) |
| Day protocol | Day 1: 12 blocks. Day 2: 4 tablet blocks + 2 paper-notebook pages. Day 14: 2 blocks, which is also the first learning task of the intervention program (§2.4) |
| Ethics and data use | The system runs **as part of the intervention program**, under the **Chief Scientist's approval**, which **does not cover research use**. Research approval is hoped for **within ~3 months**. (§2.5) |

## 2. How each decision is implemented (proposed solutions)

### 2.1 ILT letter: when is a letter correct?

A letter in an ILT block is **correct** when all three hold:
1. Dots **A, B and C are touched in that order**, where "touched" means the pen passes within the dot-touch radius (default 3.5 mm) of a dot's centre.
2. **Width 9–13 mm**, measured as (furthest point toward B − start) + (furthest point toward B − end). A perfect letter gives exactly 11 mm, and hand tremor doesn't inflate it.
3. **No pen lift inside the letter** (one continuous stroke).

**Block accuracy** = number of correct letters out of 15 (0–15), also shown as a percentage. Each condition can be switched on or off in the setup screen, so the team can test which definition best matches the paper ILT results. This is exactly the comparison the team wants to make.

### 2.2 Intervention letters: what "0/1 per row" means

This summarises Dr. Hollander's round-1 comment. Each intervention sheet has 3 rows of 5 boxes, and **each letter in each row gets one mark: correct or error.** What counts as correct depends on the row:

| Row | What the child does | Correct when | Who decides |
|---|---|---|---|
| 1 | Traces over the model, through the dots | All 3, 4 or 5 dots touched **in order**, and no pen lift inside the letter, **except ה (Hey), ק (Kuf), ח (Chet), ת (Taf)**, which are written in more than one stroke | **System, automatically** (same dot check as ILT) |
| 2 | Writes from the starting dot only | Starts at the **correct starting point** and produces the **general form** of the letter | **System checks the start point; evaluator confirms the form** with one tap |
| 3 | Writes freehand, no dots | **Recognisably the letter**, written with the **right stroke direction**, starting at about the same place as in row 2 | **Evaluator decides** |

**How it works in the cockpit:** after each row, the evaluator sees the 5 letters with the system's suggestion already filled in (✓ / ✗) and only corrects what they disagree with. It takes seconds per row, and every mark is saved together with who set it (system or evaluator).

> **About "automatic trajectory scoring" (the earlier question):** the earlier specs had the computer compare the child's pen path to a model letter and score row 3 on its own, under the name "cDTW". Dr. Hollander's criteria ("clearly resembles the letter") are a human judgement, so **the evaluator decides row 3**. The computer may show a similarity hint, but it never counts toward the score. It's stored so the researchers can later check whether automatic scoring agrees with evaluators.

> **Storage note:** Dr. Hollander's comment used 0 = no error and 1 = error. To avoid confusion, the system stores **"error: yes/no"** and displays ✓ / ✗.

### 2.3 Intervention letter dot positions

Claude extracts the dot positions (and each letter's starting point) from the 16 program sheets in `Documents/09_Samples/Hebrew_Letter_Sheets/` plus the Tet sheet. It then produces measured sheets in the same format as the corrected ILT sheet for the team to check. Multi-stroke exceptions (ה ק ח ת) are stored per letter, so more can be added later. This needs Python, which Phase 0 installs.

### 2.4 Day protocol

Each day becomes a **protocol template**: an ordered list of steps the evaluator dispatches. The defaults below can be edited in the setup screen:

| Day | Steps |
|---|---|
| Day 1 | Warm-up ILT block (unscored) → ILT blocks 1–4 (tablet) → notebook pages 1–4 (tablet, school-notebook background) → ILT blocks 5–8 (tablet) |
| Day 2 | ILT blocks 1–4 (tablet) → 2 pages in a **real paper notebook** |
| Day 14 | ILT blocks 1–2 (tablet), measured for all students. Also the first learning task of the intervention program |

**Paper-notebook pages (Day 2):** the evaluator starts and stops a timer in the cockpit for each paper page, and enters the time (and any notes). Nothing else is captured digitally.

### 2.5 Ethics: separating intervention use from research use

Because current use is covered by the Chief Scientist's approval for the **intervention program, not research**:
- Every session is tagged with its **purpose**, `INTERVENTION` (the default now) or `RESEARCH`.
- Intervention data is fully usable by evaluators and teachers for teaching: the cockpit, the comparative summary, pass/fail.
- **The analyst portal and research exports only include sessions tagged `RESEARCH`,** from participants with research consent. Until research approval exists, they're simply empty.
- **Suggestion for the team:** in the upcoming research ethics application, request permission to use the **de-identified data already collected during the intervention period**. Otherwise those months of data can never be analysed.

## 3. Settings in the ILT setup screen

| Setting | Default | Notes |
|---|---|---|
| Box width × height | 35 × 25 mm | From the final sheet |
| Row gap | 10 mm | |
| Dot-touch radius | 3.5 mm | Allowed range 1.5–5.0 mm, so neighbouring dots (11.4 mm apart) can't overlap |
| ILT width band | 11 ± 2 mm | |
| Letter-correctness conditions | Dots in order ✔, width ✔, no internal lift ✔ | Each switchable |
| Multi-stroke letters | ה ק ח ת | Pen lifts allowed inside these letters |
| Pen-lift minimum gap | 50 ms | |
| Composite weights | Time 50 / Accuracy 25 / Pen lifts 25 | Must total 100 |
| Pass threshold | Unset, until chosen from the first data | In the Comparative Summary Dashboard |
| Reference time per block | Unset, until chosen from the first data | Needed for the time part of the composite (C2) |
| Per language: box fill direction | Hebrew: right → left · English: left → right | |
| Per language: mirror the letter | Hebrew: no · English: **no** until Prof. Adi-Japha decides | |
| Protocol templates | §2.4 | Editable step lists |
| Inactivity timers | 20 s / 30 s / +10 s | Director PIN to change |

## 4. Remaining questions (all have a proposed default, so none block coding)

| # | Question | Proposed default if no answer |
|---|---|---|
| C1 | ~~Box width: 34 or 35 mm?~~ **Resolved 2026-10-26: 35 × 25 mm**, final sheet received. | — |
| C2 | **How do time and pen lifts become scores for the 50/25/25 composite?** Accuracy is already 0–100% (correct letters / 15). Proposal: **pen-lift score** = 100% minus a fixed penalty per pen lift inside letters; **time score** = 100% at or below a *reference time per block*, falling as the child takes longer. The reference time and penalty would be chosen by the team after the first real blocks. | Settings left unset; the composite and pass/fail show "not configured" until the team sets them |
| C3 | **Is the warm-up block in addition to Day 1's 12 blocks** (13 in total)? And do the intro video and the notebook demo video stay in Day 1? | Warm-up is **extra**, not counted. Both videos kept, and removable in the template |
| C4 | **English letter mirroring:** Prof. Adi-Japha's decision | Not mirrored |
| C5 | **Notebook pages on the tablet:** same letter (">") as the ILT, 3 rows × 5 letters, **time only** (as in the earlier specs)? | Yes |
