# ILT — QA Scenarios: Phase 5d, Sheet scores

**Build:** on top of commit `a2ace46`, not yet committed
**Date:** 2026-11-13
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-SCORE-12/13/14/16 (Phase 5d design note); DDD v1.6 §8.7, §9, §14, §17
**Decision (2026-11-13):** a sheet is scored once **all its marks are set**. Until then the cockpit shows how many marks are left. A later mark change scores the sheet again; the marks' change log is the audit trail.

How a sheet is scored:
- **Accuracy** = correct marks ÷ marks × 100.
- **Pen-lift score** compares the sheet's pen lifts with the letter's expected lifts (30 for ה and ק).
- **Speed score** uses the letter's Normal speed.
- **Composite** = 50% speed + 25% accuracy + 25% pen lifts, shown next to the three component scores.
- **Pass / Fail** is the composite against the pass threshold.

Phase 5 parts:
- 5a: the letter canvases (done).
- 5b: the sessions and the sheet flow (done).
- 5c: the marks (done).
- **5d: this document.**

## 1. Before you start

| Item | Value |
|---|---|
| Evaluator cockpit | **https://10.0.0.17:5174** |
| Tablet | The DTH-A116, kiosk at **https://10.0.0.17:5173** |
| Accounts | An Evaluator account |
| Test letters | A temporary set **"QA test letters (temporary)"** holds Active copies of ה and ק. These copies have a **Normal speed of 20 mm/s**, a QA value only, so that the speed score and composite appear. The team's own letters still have none. The developer removes the set after QA |
| Test data | A test participant, for example **QA5D-01**, with one **Video + 4 Training Sheets** session of ה. Skip the video. Leave everything for the developer to remove |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**. Report failures as *Phase 5d QA Take#N* with the scenario id.

## 2. Scenarios

### S. A sheet's score

| Id | Steps | Expected |
|---|---|---|
| S1 | Write **Letter sheet 1** (all 15 boxes) and finish it. Look at the marks panel | Under the title: "Scores once every mark is set (5 to set)", because row 3 is still open. The step list shows the time and pen lifts, with no composite yet |
| S2 | Set row 3: four ✓ and one ✗ | The line becomes **Sheet score**: accuracy, pen-lift score, speed score and **composite**, then Pass, Fail or "not configured" (if no pass threshold is set). Accuracy = correct marks ÷ 15 × 100, for example 13 of 15 → 86.7. The step list now ends with "Composite n" |
| S3 | Change one row-1 mark (✓ → ✗ or back) | Accuracy and the composite change at once (one mark = 6.7 accuracy points = about 1.7 composite points) |
| S4 | Press one of your row-3 choices again, so the mark is "to set" again | The score line goes back to "Scores once every mark is set (1 to set)", and the step list loses the composite. Set the mark again: the score returns |
| S5 | Write a sheet with long pauses or very slowly (for example 4 letters per row only, then finish) | The pen-lift and speed scores fall below 100. Empty boxes are ✗ in rows 1 and 2, which lowers accuracy |

### P. Where the results appear

| Id | Steps | Expected |
|---|---|---|
| P1 | **Protocol** (Dispatch Console) for QA5D-01 | The session card shows "Score n", the mean composite of the scored sheets. While a sheet still has open marks and none is scored, the card says "n marks to set" |
| P2 | Finish all four sheets (setting their marks), **Finish session**, then back to the console | The ה letter shows "training n", the mean composite of its latest training |
| P3 | **Comparative Summary** for QA5D-01 | Below the ILT boxes and the chart is an **Intervention program** table. Each session is one row: letter, kind and code (with the date), "n of 4 scored", average time, pen lifts, accuracy, pen-lift score, speed score, composite, Pass/Fail. A session with open marks also shows "Scores once every mark is set (n to set)" |
| P4 | Plan a **Repeat Letter** session and do one sheet with all marks set | A second ה row appears in the Summary, above the first (newest first within the letter). Its date is the day it was planned, with its status (for example "In progress") until it is completed |

### N. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| N1 | **English** | The score line, the Summary table and the console's "Score n" / "n marks to set" are in English |
| N2 | **Dark** | The score line and the Summary table are readable |

## 3. Notes

- **Not testable from the cockpit:** the analyst portal and exports (marks per sheet in a session's detail, and a `marks` file in each export). Analysts see Research sessions only, and an intervention session is always planned with the Intervention purpose. These parts are covered by the developer's tests. Planning intervention sessions as Research is a possible follow-up.
- **The team's letters** have no Normal speed yet, so their sheets show the speed score and composite as "not configured" until the team records one in reference mode.
- **Cleanup by the developer after QA:** QA5D-01 with its sessions, marks, scores and log rows, and the "QA test letters (temporary)" set.
