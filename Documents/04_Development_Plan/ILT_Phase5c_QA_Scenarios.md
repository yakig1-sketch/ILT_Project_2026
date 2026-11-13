# ILT — QA Scenarios: Phase 5c, Intervention marks

**Build:** on top of commit `ac92b25`, not yet committed
**Date:** 2026-11-12
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-COCK-5 (Phase 5c design note), FR-COCK-6, FR-SCORE-15, FR-LOG-1; DDD v1.6 §8.7, §14, §17
**Decisions (2026-11-12):**
- The marks appear **live, row by row**: a row's five letters show as soon as the child moves on to the next row. They stay editable after the sheet.
- Row 1: ה ק ח ת א may lift the pen **once between strokes** (strokes − 1). More lifts make the letter wrong.
- Row 3 starts **empty**. The evaluator sets it, during the sheet or later.
- Row 3 shows a **similarity hint** (0–100). It is a hint only and never counts.

Phase 5 parts:
- 5a: the letter canvases (done).
- 5b: the sessions and the sheet flow (done).
- **5c: this document.**
- 5d: the sheet scores.

## 1. Before you start

| Item | Value |
|---|---|
| Evaluator cockpit | **https://10.0.0.17:5174** |
| Tablet | The DTH-A116, kiosk at **https://10.0.0.17:5173** |
| Accounts | An Evaluator account |
| Test letters | As in 5b: a temporary set **"QA test letters (temporary)"** with Active copies of ה and ק. The developer removes it after QA |
| Test data | A test participant, for example **QA5C-01**, with one **Video + 4 Training Sheets** session of ה. Skip the video. Leave everything for the developer to remove |

How a mark looks:
- Each letter has **✓** and **✗**. The mark in force is filled: green for ✓, red for ✗.
- Under the letter it says who decided: **system**, **evaluator** or **to set**.
- A frame with a dashed border is still to set.

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**. Report failures as *Phase 5c QA Take#N* with the scenario id.

## 2. Scenarios

### M. Marks while the child writes (sheet 1)

| Id | Steps | Expected |
|---|---|---|
| M1 | Send **Letter sheet 1** to the tablet | Under the step results, a **Marks: Letter sheet 1 (while writing)** panel appears with three rows. Each row says "Shown when the child finishes this row." |
| M2 | Row 1: trace ה in the first four boxes correctly. In the **fifth** (left-most) box, lift the pen several times inside the letter, for example drawing the arch in three pieces. Then start row 2 | Row 1 appears. The letters sit as on the sheet: right to left, with the first box on the right. Four letters are ✓ (system). The fifth is ✗ (system), with "lifts n (allowed 1)" |
| M3 | While the child writes row 2, press **✓** on the fifth row-1 letter | It turns green and says **evaluator** |
| M4 | Row 2: write four letters from the start dot. Start the **fifth** at the far end of the arch (bottom right). Then start row 3 | Row 2 appears: four ✓ with "start ✓", and the fifth ✗ with "start ✗" (system) |
| M5 | Row 3: write four good ה and one scribble, for example a straight line. Finish the sheet (**Next block** on the tablet) | The panel becomes **Marks: Letter sheet 1, attempt 1**. Row 3 has five dashed frames "to set", each with "similarity n": the good letters higher than the scribble. Handwritten letters typically score about 70–90; the hint compares, it doesn't decide. The M3 change is still there: ✓, evaluator |

### S. Reviewing stored marks

| Id | Steps | Expected |
|---|---|---|
| S1 | Set row 3: ✓ for the four good letters, ✗ for the scribble | Each turns green or red, "evaluator". The summary at the top reads "✓ … · ✗ … · to set 0" |
| S2 | On the M3 letter, press **✓** again | It goes back to the system's suggestion: ✗, "system" |
| S3 | In **Steps**, look at Letter sheet 1 | Its line shows "✓ n · ✗ n · to set 0" next to the time and pen lifts, with a **Marks** button |
| S4 | Run **Letter sheet 2** (write all 15 boxes; the sheet can end only after the last box), then press **Marks** on Letter sheet 1 | The panel shows sheet 1's marks again ("Letter sheet 1, attempt 1"), and they can still be changed |
| S5 | **Activity log**, filtered to the session | One "Intervention mark suggested" row per sheet, with the counts. One "Intervention mark changed" row per change, reading for example "not set → correct" or "error → correct", and "(back to the system's suggestion)" for S2 |
| S7 | *Take#2:* during a sheet, press **Marks** on an earlier sheet | Its stored marks show below the live panel, and can be changed while the child writes |
| S8 | *Take#2:* in a new sheet, lift the pen several times inside a row-1 letter; after the sheet, look at the stored marks | The letter still shows "lifts n (allowed 1)" |
| S9 | *Take#2:* show a pairing code and wait 10 minutes (or until its time passes) | The code disappears: "The pairing code has expired." with a **New code** button. While a code is valid, **New code** is also there |
| S6 | Telemetry note during a sheet | "Letter sheet: time, pen lifts and the marks below; the sheet scores are not available yet" |

### N. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| N1 | **English** | The panel, row titles, "system / evaluator / to set", "start ✓", "similarity n" and the help line are in English. The letters stay Hebrew and still sit right to left |
| N2 | **Dark** | ✓ green, ✗ red and the dashed "to set" frames are clear |

## 3. Notes

- **How the system suggests:**
  - Row 1 is ✓ when every dot is touched, in order, with no more pen lifts than allowed.
  - Row 2 is ✓ when the letter starts within the start dot's radius (3.5 mm). The form is for the evaluator to confirm.
  - Row 3 is always the evaluator's.
  - An empty or skipped box is ✗ in rows 1 and 2.
- **The similarity hint** compares the written shape with the model letter after both are centred and scaled to the same size. It can be switched off in the settings (Show the row-3 similarity hint).
- **Not in 5c:** the sheet scores (accuracy from the marks, pen-lift and speed scores, composite) and their place in the summary, the analyst portal and the exports. These come in 5d.
- **Cleanup by the developer after QA:** QA5C-01 with its sessions, marks and log rows, and the "QA test letters (temporary)" set.
