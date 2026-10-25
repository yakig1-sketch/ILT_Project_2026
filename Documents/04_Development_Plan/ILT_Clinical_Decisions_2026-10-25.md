# ILT Clinical Decisions Register

**Date:** 2026-10-25
**Sources:**
- [Reply document](ILT_Clinical_Answers_Review_2026-10-22_REPLY_V01.doc): comments by Dr. Hagit Hollander and Yaki Grossman on the [answers review](ILT_Clinical_Answers_Review_2026-10-22.md)
- [Corrected Day 1 sheet with dimensions](../05_Measures/ILT_Day1_Sheet_A4_Corrected_Dimensions.pdf), its [clean printable version](../05_Measures/ILT_Day1_Sheet_A4_Corrected_Clean.pdf), and the updated [geometry data](../05_Measures/ILT_Day1_Grid_Geometry.json)

**Reviewer:** Claude

> **How the comments were read:** the reply is a binary Word file, and its comments were recovered without their anchor positions. Each comment's subject is inferred from its position in the document and its wording. Items marked *(inferred)* should be confirmed.

## 1. Decided

| Topic | Decision | Source |
|---|---|---|
| Who approved | **Dr. Hollander reviewed the answers.** Answers 1–6 and 8 are approved, except where her comments change them (below). | "Dr. Hollander reviewed these answers"; Q-F: "yes", "Means - Approved!" |
| ILT box and letter geometry | Boxes **34 × 25 mm**, all identical. **10 mm** between rows. Grid 170 × 95 mm. Dots A (14.0, 2.6), B (19.5, 12.6), C (14.0, 22.7) mm from each box's top-left. The earlier 35.1 / 34.6 mm values were a measurement error. | Corrected sheet; Q-C comments |
| Letter shape | **">" exactly as printed** (A top, B right, C bottom), never mirrored | Q-B: "the letter faces like the top symbol, not its mirror image" |
| Stroke order | **A → B → C** | Q-B |
| Box order | **Hebrew:** start at the top-right box and move left. **English:** start at the top-left box and move right. | Q-B |
| Width rule | Width = **cumulative horizontal travel** while writing the letter: 5.5 mm right (A→B) plus 5.5 mm back left (B→C). **Nominal 11 ± 2 mm** (9–13 mm). Replaces the "15 ± 2 mm" rule. Consistent with the corrected geometry. | Reply under Q-A |
| Warm-up | **One full block is the warm-up.** Verbal mediation by the evaluator is allowed. Then continue to block 1. No pass criterion. Replaces "3 practice items + 1 valid row". | Comment on answer 6 |
| Intervention letter scoring | Each letter scores **0 (no error) or 1 (any error)** per row: **Row 1** all dots touched in the right order (first dot marked; up to 5 dots for some letters). **Row 2** starts from the dot and is clear and identifiable as the target letter. **Row 3** clear, readable, and starts at about the same place as in row 2. | Comment on answer 7 |
| Pen-lift threshold | 50 ms between pen-up and pen-down | Answer 4, approved |
| Inactivity | 20 s (30 s after box 15), then amber after a further 10 s with a flashing Manual Finish button. Director PIN for overrides. | Answer 5, approved |
| Legacy data mapping | Hand Raises → pen lifts; Segment Width → width; Total Time → total time; Writing/Air Time → active writing / air time | Answer 8, approved |
| Identity data | **No names or ID numbers in the digital system.** The ID on paper sheets only grouped printed pages. Study code only. | Q-D comments |
| Languages | **Hebrew and English** (fill direction defined for both) | Q-B comment |
| Ethics | The current pilot (part of the intervention program) **does not yet have ethics approval**. A previous IRB exists: **287/8918/2015**. | Comment on the ethics question |

## 2. Effect on the design

1. **Geometry:** the tablet canvas renders the corrected sheet at true size (170 × 95 mm fits the DTH-A116's ~242 × 158 mm screen). The DDD v1.5 seed (32.7 × 27.9 mm boxes) and the first measurement (35.1 × 25.8 mm) are both replaced.
2. **The letter is the same shape in both languages; only the box order changes.** `active_box_id` numbering follows the fill order, so box 1 is top-right in Hebrew and top-left in English.
3. **Width scoring** uses the out-and-back horizontal travel, with an 11 ± 2 mm band (subject to Q1/Q2 below).
4. **The warm-up is a normal 15-box block,** recorded and flagged as warm-up, and excluded from the metrics.
5. **Intervention scoring is criterion-based (0/1), not trajectory-based.** Row 1 can be checked automatically (dots touched in order); rows 2–3 need the evaluator's judgement. The automatic cDTW / Procrustes scoring in the earlier specs is no longer the primary intervention measure.
6. **Privacy:** the `participant_identities` table is dropped. The system stores study codes only.
7. **Ethics gate:** without approval for the current pilot, the system must not collect real children's data. Development and testing use synthetic data and adult testers.

## 3. Open questions (short)

The remaining questions are all about how the accuracy metric is scored. Everything else is decided.

1. **Block accuracy, 0–15 or %?** A comment says "a score of 0–15 the range of accuracy". Our reading: block accuracy = **the number of correctly written letters out of 15**. Is that right? *(inferred)* If so, is the earlier 40/30/30 percentage formula still needed, or is it dropped?
2. **What makes an ILT letter correct?** Our proposal: all three dots touched **in order A→B→C**, **and** width within **9–13 mm**, **and** no pen lift inside the letter. Add or remove conditions?
3. **When is a dot "touched"?** The dots are ~2.6 mm wide. Our proposal: the pen passes within **3.5 mm of the dot's centre** (the earlier spec value). Larger or smaller?
4. **Measuring width:** "cumulative horizontal travel" can be measured two ways:
   - **(a)** furthest point right minus the start, plus furthest point right minus the end. Unaffected by hand tremor; a perfect letter gives exactly 11 mm.
   - **(b)** every small left-right movement added up. This grows with tremor.

   We recommend **(a)**. Agree?
5. **Composite weights:** a comment reads "25 width, 25 hands raise, 50 time", with "this is the correct baseline". Our reading: the *optional* summary score weights **accuracy 25%, pen lifts 25%, time 50%** (replacing 35/40/25). *(inferred)* Confirm, and confirm it stays a display-only summary next to the 3 separate metrics.
6. **Trajectory scoring (cDTW):** after the width rule and 0/1 scoring, is automatic trajectory scoring used anywhere? Or is it kept only as an exploratory research measure in the analyst portal?
7. **Intervention letters:** row 1 needs each letter's dot positions ("up to 5 dots"). Can the team supply measured sheets like the corrected ILT sheet, starting with Tet? Or should we measure them from the Hebrew letter sheets already in `Documents/09_Samples/Hebrew_Letter_Sheets/`, for the team to verify?
8. **Day protocol:** confirm the exact sequence per day. Day 1: intro video → warm-up block → ILT blocks 1–4 → notebook 2 pages → notebook video → notebook 2 pages → ILT blocks 5–8. Day 2: ILT blocks 1–4 → notebook 2 pages. Day 14: ILT 2 blocks. (The wireframes show "Block 2 of 12", and the FRS says "Day 1 (12 blocks)".)
9. **Ethics timing:** when is approval expected for the current pilot? Will children's paper results collected before then be imported later, which would need approval to cover it?

## 4. Status for coding

- **Fully specified now:** geometry, box order (both languages), stroke order, warm-up, pen lifts, inactivity, identity policy, legacy mapping.
- **Built as configurable settings until Q1–Q5 are answered:** letter-correctness rules, dot-touch radius, width band, accuracy aggregation, composite weights.
- **Waiting on data:** intervention letter dot positions (Q7).
- **Hard gate:** no real-child data until ethics approval (Q9).
- **Phase 0 isn't blocked by any of these.**
