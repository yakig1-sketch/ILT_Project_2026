# Review of the Answers to the Research-Team Questions

**Date:** 2026-10-22
**Inputs:** answers to the 11 questions in [Round 3 review §4](ILT_Coding_Readiness_Review_v1.5.md#4-questions-for-the-research-team) (Hebrew, 9 answers), and the measured original ILT Day 1 sheet ([PDF](../05_Measures/ILT_Day1_Sheet_A4_Measurements.pdf), [geometry data](../05_Measures/ILT_Day1_Grid_Geometry.json))
**Reviewer:** Claude

## Summary

The **measurement sheet resolves B7 for the ILT invented letter**: real box sizes and dot positions in millimetres, taken from the original paper sheet. That's the most important input so far.

The written answers settle most engineering defaults. But three things stop them from being treated as final clinical decisions:

1. **Who approved them is unclear.** The answers say they're based on the specifications and on the researchers' guidance, but most read as reasoning from the specifications ("engineering baseline default", "will be finalised from pilot data"). **Please confirm whether Prof. Adi-Japha and Dr. Hollander reviewed these answers.** Until then they're recorded as proposed defaults, not approvals.
2. **The width rule doesn't fit the real letter (critical).** Answer 2 defines width as the horizontal extent of the ink (Xmax − Xmin) with 13–17 mm scoring 100% and anything ≤ 10 mm scoring 0%. On the real sheet, the dots of a perfect letter are only **5.5 mm apart horizontally**. A perfectly written letter would score **0%**. "Width 15 ± 2 mm" must mean something else (see Q-A below).
3. **Answer 7 is wrong and is superseded by the measurement sheet.** It repeats the placeholder seed (box 32.7 × 27.9 mm, dots at x = 12–88 mm, "chevron with upper loop"). The real sheet has 35.1 × 25.8 mm boxes, dots within 5.5 mm horizontally, and no loop.

Questions 10 (ethics references) and 11 (languages) weren't answered.

## The real ILT Day 1 geometry (from the measurement sheet)

| Property | Value |
|---|---|
| Grid | 3 rows × 5 boxes, 175.0 × 97.0 mm overall |
| Box | 35.1 × 25.8 mm (box 4 in every row is 34.6 mm wide) |
| Gaps between rows | 9.9 mm and 9.7 mm |
| Dots per box (from box top-left) | A top (14.5, 3.0) · B right (20.0, 13.0) · C bottom (14.5, 23.1) |
| Dot diameter | ~2.6 mm (measurement uncertainty ~0.2 mm) |
| Ideal letter | A→B 11.4 mm, B→C 11.5 mm, height A→C 20.1 mm, horizontal extent 5.5 mm, path length ~22.9 mm |
| Shape as printed | ">" (B to the right of A and C) |

The whole grid fits on the DTH-A116 screen (~242 × 158 mm) at **true 1:1 physical size**, so the tablet can reproduce the paper sheet exactly. This matters for comparing the tablet group with the paper group.

The previous seed in DDD v1.5 is replaced by these values.

## Answer-by-answer

| # | Topic | Answer | Assessment | Recorded as |
|---|---|---|---|---|
| 1 | Accuracy weights | 40/30/30 as a configurable baseline. The 3 clinical metrics are never merged. | ✅ Consistent. **One error:** it says the weights live in `score_weight_accuracy_pct` etc., but those columns hold the *separate* optional composite (35/40/25 across the 3 metrics). The 40/30/30 split inside accuracy needs its own settings. | Default, configurable, **unconfirmed** |
| 2 | Width scoring | 100% for 13–17 mm, falling linearly to 0% at ≤ 10 mm and ≥ 20 mm. Width = horizontal ink extent. | Formula ✅ (internally consistent now). **Definition ❌:** it contradicts the real letter, whose ideal horizontal extent is 5.5 mm. | Formula kept; **width definition open (Q-A)** |
| 3 | cDTW threshold | Score reaches 0% at a mean deviation of 15 mm. Stored per letter model (`dtw_zero_threshold_mm`). | ✅ Configurable per letter is right. But 15 mm is very lenient for a letter only 20 mm tall: almost every attempt would score high. Expect the pilot to set something like 3–5 mm. | Default 15 mm, configurable, **to calibrate on pilot data** |
| 4 | Pen-lift gap | 50 ms between pen-up and pen-down, approved. | ✅ Technically sound at 240 Hz (≈12 samples). The reasoning given is technical, not clinical. | Default 50 ms, configurable |
| 5 | Inactivity | 20 s (30 s after box 15), then amber after +10 s with a flashing Manual Finish button. Overrides need the director PIN. | ✅ Clear and implementable. Small difference: earlier specs had a Hebrew audio prompt at 20 s; this answer says a subtle visual cue on the tablet. | Implemented as described; **audio vs visual cue to confirm** |
| 6 | Warm-up | 3 single practice letters, then 1 valid row of 5 boxes (3 dots connected, no internal lifts). No timers and no scoring. | ✅ Clear. Not covered: what happens if the child can't produce a valid row after several tries. | Implemented as described; **retry limit to confirm** |
| 7 | Reference shapes | Repeats the DDD v1.5 placeholder | ❌ Wrong. **Superseded by the measurement sheet** for the ILT letter. The intervention letters (Tet etc.) still have no real coordinates. | ILT letter ✅ from sheet; **intervention letters open** |
| 8 | Legacy data | Hand Raises → pen lifts; Segment Width → width; Total Time → total time; Writing/Air Time kept as extra columns | ✅ Plausible mapping. Two notes: the existing columns are `active_writing_time_ms` / `air_time_ms`, not new names. The old application's export format is in `05_Measures/Samples/*.xls`, so the importer can be built against those files. "Segment Width" depends on Q-A. | Mapping accepted; importer built from the sample files |
| 9 | Identity data | Study code is enough. Names and IDs never appear in the cockpit, tablet or exports. An isolated identity table (HMAC + encrypted details) is accessible only to the PI. | ✅ Direction is right, but two ideas are mixed: "not entered in the system" vs "stored in an isolated table". **Simplest and safest:** the system stores **no** names or ID numbers at all, and the PI keeps the code ↔ child list offline (standard research practice). It also mentions storing 2-letter initials; keep those out of every export. | **Decision needed (Q-D)** |
| 10 | Ethics references | Not answered | ❌ | Open, required before real children are tested |
| 11 | Languages | Not answered | ❌ | Open. Hebrew-only assumed for the pilot |

## Remaining questions (short list for the researchers)

- **Q-A, the width rule:** what does "width 15 ± 2 mm" measure? On the real sheet, the letter's dots are 5.5 mm apart horizontally and 20.1 mm vertically, and each stroke is 11.5 mm long. Is it the length of each stroke, the overall letter size, the segment length from the old application, or something else? Accuracy scoring can't be finalised without this.
- **Q-B, orientation and order:** the paper letter is ">" with boxes numbered left to right. The earlier tablet design shows "<" ("mirrored for LTR"). Which shape does the tablet show, and in which order does the child fill the boxes (right to left for Hebrew readers)?
- **Q-C, box 4:** box 4 in every row measures 34.6 mm instead of 35.1 mm. Is that intentional, or a drawing artefact that should become 35.1 mm on the tablet?
- **Q-D, identity data:** no names or IDs in the system at all (PI keeps the key offline), or an encrypted identity table inside it?
- **Q-E, intervention letters:** real coordinates for the Hebrew letters (starting with Tet), like this sheet.
- **Q-F, confirmation:** have the researchers approved answers 1–6 and 8, or are they proposals?
- **Ethics references** and **languages** (questions 10 and 11).

## Effect on coding

- **The ILT letter geometry is now real data.** Phase 0 seeds use it.
- All parameters from answers 1–6 go into configuration with the values above, marked `UNCONFIRMED` until Q-F is answered.
- **Accuracy scoring stays provisional until Q-A is answered.** Dots and cDTW work; width scoring is the open piece.
- Nothing here blocks Phase 0.
