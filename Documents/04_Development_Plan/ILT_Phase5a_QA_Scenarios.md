# ILT — QA Scenarios: Phase 5a, Intervention letter canvases

**Build:** on top of commit `c211b94`, not yet committed
**Date:** 2026-11-12
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-CAN-1…7, FR-CAN-9/10 (reference recordings), FR-COCK-5 (rows); DDD v1.6 §7.1, §10
**Decisions (2026-11-12):**
- Build ה ח ק ת now; א and other letters follow when the team sends their sheets.
- Row 1 is shown like the paper: the model letter in the first box, and only the dots in the other four.
- The model shape is taken from the sheet.

Phase 5 (the intervention program) is built in four parts:
- **5a (this document):** the letter canvases.
- **5b:** the sheet flow on the tablet and in the Dispatch Console.
- **5c:** suggested marks and the evaluator's review.
- **5d:** sheet scoring and results.

In 5a, the clinical team's letter sheets for ה ח ק ת become canvases. They are loaded as **Draft**, so no session uses them yet.

## 1. Before you start

| Item | Value |
|---|---|
| Administrator cockpit | **https://10.0.0.17:5174/admin** → **Canvases** |
| Tablet | The DTH-A116, for the true-size check (L5–L7) |
| Accounts | An Administrator account |
| The paper sheets | On the Drive in `ILT_Project_2026\Intervention_Letters_Check`: the four PDFs (ה ח ק ת) and a check image per letter. The image shows the sheet with what was measured drawn on top: boxes in green, dots as red rings numbered in writing order, and each pen stroke's centre line in orange |
| Test data | None needed. Don't **Activate** the letters, and **Clear** any reference recording instead of accepting it, so the Drafts stay as they are for the team |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 5a QA Take#N* with the scenario id.

## 2. Scenarios

### C. The canvases (Administrator cockpit)

| Id | Steps | Expected |
|---|---|---|
| C1 | **Canvases**, Type **Intervention letters**, Language Hebrew | The set "Hebrew letters - intervention program" lists four canvases, each v1, **Draft**: `LETTER_HE_HE` "האות ה (דף התערבות)", `LETTER_HE_HET` (ח), `LETTER_HE_QOF` (ק), `LETTER_HE_TAV` (ת) |
| C2 | **Open** `LETTER_HE_HE`, look at **Preview** (fit to window, box numbers and fill order on) | 3 rows of 5 boxes, 146.2 × 94.7 mm. Box **#4** (top right, fill position 1) shows the letter ה in light blue with its dots. Boxes #0–#3 show 4 dots each, numbered 1–4 in red. Row 2 (#5–#9) shows one dot (1); row 3 is empty. Fill positions run right to left, row by row (1 at #4 … 15 at #10). A dashed grey line shows the model's centre line in every box, and a small grey letter in each box's bottom-left corner names the box's letter; both appear only in this preview, not on the tablet or the paper. **Fit to the window** shows the whole canvas without scrolling |
| C3 | Compare the preview with the paper sheet `3אותיות הקשת ה.pdf` page 1, block 1 | Same layout: the model in the right-most box of row 1, the dots in the same places, and row 2's start dot. Dot 1 is the top-left dot, where the arch starts; dot 2 is the arch's end at the bottom right; dots 3 → 4 are the left leg, from its top down |
| C4 | Open `LETTER_HE_QOF` | 146.2 × 102.4 mm, with a wider gap under rows 1 and 2. In row 1, dot 4 (the end of ק's long leg) is **below** its box, in the gap |
| C5 | Open `LETTER_HE_TAV` | Five dots in row 1: 1 → 2 is the arch; 3 → 4 → 5 is the left leg, from its top, through the corner, to the end of the foot. Dot 3 sits on the box's top edge, so its number is shown just below it, not cut off |
| C6 | Open `LETTER_HE_HET` | Three dots in row 1: 1 (top left) → 2 (bottom right) is the arch; 3 is the end of the left leg. *For the clinical team:* the left leg's own start has no dot on the sheet, so the canvas takes the arch first. Is that the order children are taught? |
| C7 | On any of the four, **Check** | "No problems found: the draft can be activated." (Don't activate it) |
| C8 | Scroll to the **scoring profile** | Dots 1–4 (or 1–3 for ח, 1–5 for ת), each printed ⌀ 2 mm, radius 3.5 mm, equal weights in whole percents (total 100%, so ח is 34/33/33), none required. Expected pen lifts **30** (two strokes × 15 letters). Normal speed "not recorded". Fill order `4, 3, 2, 1, 0, 9, 8, 7, 6, 5, 14, 13, 12, 11, 10` |

### L. On the tablet (reference mode)

| Id | Steps | Expected |
|---|---|---|
| L1 | On `LETTER_HE_HE`, **Pair tablet in reference mode**, and enter the PIN on the tablet | The tablet shows the amber "reference recording" bar and the ה sheet |
| L2 | Look at the tablet | Row 1: the first box on the **right** shows the ה in light blue, with its dots, and the other boxes show the dots only. The dots look like the paper's: a ring with a centre point. Row 2: one start dot per box. Row 3: empty |
| L3 | Hold the paper sheet against the tablet screen | True size: the boxes and dots match the paper within about a millimetre |
| L4 | Record a **sample block**: write ה in all 15 boxes, two strokes each, then **Done** | The result shows 30 pen lifts and the fill order right to left. Then **Clear**; don't accept |
| L5 | Repeat L1–L2 with `LETTER_HE_QOF` | ק's long leg and its last dot reach below row 1, into the gap, and the model is light blue in the right-most box |
| L6 | *Removed in Take#1:* reference mode has no live mirror in the cockpit; the mirror is on the session screen, and the letter sheets reach sessions in 5b | — |
| L7 | Close the reference station | The tablet returns to the PIN screen |

### N. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| N1 | Hebrew and English | The canvas names, the set and the screens are translated; the letters and dot numbers read the same in both |
| N2 | Dark and Light | The canvas stays white, like paper; the light-blue model, the dots and the numbers are readable |

### R. Take#2: retest of the Take#1 fixes

| Id | Steps | Expected |
|---|---|---|
| R1 | Open `LETTER_HE_TAV` | In every row-1 box, dot 3's number is to the right of the dot, apart from dot 1's number |
| R2 | On any letter, pair a tablet in reference mode | **Rows** and **Writer** are on their own line with **Record the normal speed**; **Record a sample block** has no Rows field and always shows the whole sheet |
| R3 | Record a sample block, and press **Done** on the tablet without writing | The cockpit says "Nothing was written on the tablet". **Activity log**: "Reference run ended without a recording", with the reason. Nothing is added under the canvas's recordings |
| R4 | `LETTER_HE_QOF`'s scoring profile | Normal speed "Not recorded" again; no recordings listed |

## 3. Notes

- **How the letters were measured.** `tools/letter-sheets/extract_letter_sheet.py` reads each sheet:
  - The box frames and the model letter are vector drawings in the PDF, so they are exact.
  - The dots are small pictures, found on a 600 dpi render of the page.
  - The dots vary by up to 1.6 mm between boxes on the paper. The canvas keeps each box's own dots, and the model box gets their mean.
- **For the clinical team, before activating:**
  - Check the dot order of each letter, especially ח.
  - Check the profile values: radius, weights, any required dots.
  - Record a normal speed per letter (reference mode, **Normal speed**).
  - Activate each letter (needs the director's approval).
- **Not in 5a:** sessions don't use the letters yet (5b); there are no marks (5c) and no sheet scores (5d). There is no א yet.
- The seed's dev-account step skipped `dev-director@ilt.local`, whose role is now Analyst. It no longer tries to give it a director PIN.
