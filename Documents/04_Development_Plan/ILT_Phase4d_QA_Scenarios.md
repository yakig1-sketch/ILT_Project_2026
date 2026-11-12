# ILT — QA Scenarios: Phase 4d, Legacy data and paper cohort

**Build:** on top of commit `f739f3c`, not yet committed
**Date:** 2026-11-12
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-LEG-1 (legacy import), FR-LEG-2 (paper-cohort scores), FR-LOG-1; DDD v1.6 §9, §14
**Decisions (2026-11-11):**
- Legacy children are created automatically, with grade, gender and SES "Not recorded".
- L/R: 1 = Right, 0 = Left.
- Segment width is stored as given and flagged; its unit is not confirmed.

Phase 4d finishes Phase 4:
- **Legacy data:** the System Administrator imports the old application's result files.
- **Paper cohort:** evaluators enter scores by hand for children who write on paper.

## 1. Before you start

| Item | Value |
|---|---|
| Administrator cockpit | **https://10.0.0.17:5174/admin**, new tab **Legacy data** |
| Evaluator cockpit | https://10.0.0.17:5174 |
| Accounts | An Administrator account; an Evaluator (for example `dev-evaluator@ilt.local`) |
| Sample files | The old application's five files, also on the Drive in `ILT_Project_2026\Legacy_Samples`: `Air Time sample.xls`, `Hands Raises sample for program.xls`, `Segment width sample.xls`, `Total Time sample.xls`, `Writing Time sample.xls`. Download them to the test machine first |
| Test data | None prepared: you create it. Tell me when you are done and I'll remove the imported children, the import and your paper test child |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 4d QA Take#N* with the scenario id.

## 2. Scenarios

### L. Legacy import (Administrator)

| Id | Steps | Expected |
|---|---|---|
| L1 | Admin cockpit → **Legacy data** | An explanation, **Import files** (Files, Domain for new children, Session label "Legacy") and **Imports** ("Nothing has been imported yet.") |
| L2 | **Files**: choose all five sample files | A table: each file with its measure recognised (Air time, Hand raises, Segment width, Total time, Writing time) and how it is stored ("pen lifts", "width, as given (unit not confirmed)", "total time (ms)", …) |
| L3 | Session label **QA 4d**, Domain **General**, **Check files** | Each file "Readable" with 54 children and 36 blocks. "To import: 54 children (54 new, 0 already in the system), 1296 block rows." A sample of the first children: LEG-96, LEG-97 …, hand Right, 24 blocks, and the block 1 values (for LEG-97: hand raises 16, segment width 15, total time 35,769, writing time 20,860, air time 14,909) |
| L4 | Check that nothing was written yet: Evaluator cockpit, search for participant **LEG-97** | Not found |
| L5 | **Import (54 children)** | Within a few seconds: "Imported: 54 children (54 new), 1296 block rows." **Imports** shows the import: you, "QA 4d", General, the five measures, 54 new, 0 matched, 1296 rows |
| L6 | **Check files** and **Import** again with the same files and label | The check says "0 new, 54 already in the system" and "1296 existing rows with this label will be updated". After the import: 0 new, 54 matched. Nothing is doubled (see L8: still 24 blocks) |
| L7 | Optional. Choose `Total Time sample.xls` and `Writing Time sample.xls` only, set the Total Time file's measure by hand to **Writing time**, then **Check files** (don't import) | Both files show "Measure already in another file", a red message names the measure (Writing time) and both files, and **Import** is disabled. Nothing is imported |
| L8 | Evaluator cockpit: search **LEG-97**, open its **Participant record** | The pill "Legacy (old application) · old number 97". Grade and gender "Not recorded", hand **Right**. **Results from the old application**: "Mistakes (old application, all blocks): 24", then under **QA 4d** blocks 1–24 with pen lifts, segment width, total, writing and air time in seconds. Block 1: 16 · 15 · 35.8 · 20.9 · 14.9 |
| L9 | Open **LEG-132** | Hand **Left** (L/R 0) |
| L10 | On LEG-97, **Edit**: set Grade **Grade 2** only, save | Saved; grade Grade 2, gender still "Not recorded" |
| L11 | (Admin) **Action log**, Free text *Legacy data imported* (Free text also finds entries by their event name, in either language) | One row per import: `Legacy import "QA 4d": 54 children (54 new), 1296 block rows` (then "(0 new)"), with the files, Domain and counts in the details |

### P. Paper cohort (Evaluator)

| Id | Steps | Expected |
|---|---|---|
| P1 | **New participant**: fill the form, with **Group: Paper cohort** (code for example QA4D-P1) | Created. Its record shows the pill "Paper cohort" and a **Paper scores** section: Day 1 ILT 1–8, Day 2 ILT 1–4 and Day 14 ILT 1–2, all "Not entered" |
| P2 | Day 1 ILT 1: pen lifts 16, accurate letters 13, time 38.5, a note; **Save** | "Scores saved."; the row shows when and by whom |
| P3 | Accurate letters **17** on another block, **Save** | "Accurate letters: a whole number from 0 to 15."; nothing saved |
| P4 | Change Day 1 ILT 1 to accurate letters 14, **Save** | Saved; the row shows the new time of saving |
| P5 | Empty all fields of Day 1 ILT 1, **Save** | "Block cleared."; the row is "Not entered" again |
| P6 | Open a **Tablet** participant's record | No Paper scores section |
| P7 | (Admin) **Action log**, type *Paper scores entered* | "Paper scores entered / changed / cleared: QA4D-P1 DAY_1 block 1", with old and new values in the details |

### N. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| N1 | Hebrew and English | Everything translated, including the measures, the file states and the paper grid |
| N2 | Dark and Light | The Legacy data tables, the pills and the paper grid are readable |

## 3. Notes

- **Open question for the clinical team:** the old "Segment width" values are whole numbers from 0 to about 18 per block. They are stored exactly as given until the unit is confirmed (millimetres, or a count of letters).
- Legacy and paper results are shown on the participant record only. They are not yet in the Comparative Summary, the analyst portal or exports; that needs a decision on comparing them with tablet scores, and on consent for the legacy data.
- The import reads only the old application's .xls format, which is what the sample files are.
