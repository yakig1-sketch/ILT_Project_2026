# ILT — QA Scenarios: Phase 5e, Paper and legacy results

**Build:** on top of commit `01cd882`, not yet committed. **Take#2** (2026-11-14): A4 fixed; A3 wording and the R1–R2 setup corrected
**Date:** 2026-11-14
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 §15 (Phase 5e design note), FR-SUM-1…4, FR-AN-1/2/3, FR-PLAN-1; DDD v1.6 §9, §14, §17
**Decisions (2026-11-14):**
- Paper blocks fill the Comparative Summary's anchor boxes, tagged **Paper**. There is no speed or composite on paper.
- Legacy results get their own section per session label, with no scores.
- Analysts see paper and legacy results only with **current research consent**, the same rule as for tablet sessions.
- The Dispatch Console can plan an intervention session as **Research** when research is allowed.
- Also confirmed: ח is written **arch first**. The canvas already does this.

## 1. Before you start

| Item | Value |
|---|---|
| Evaluator cockpit | **https://10.0.0.17:5174** (Evaluator) and **/admin** (Administrator, for the legacy import) |
| Analyst portal | **https://10.0.0.17:5175**, with an Analyst account |
| Test data | A **Paper** cohort participant, for example **QA5E-P** (Hebrew, Grade 1, Female). The **legacy files** used in 4d, imported under a new session label such as **QA5E old**. Leave everything for the developer to remove |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**. Report failures as *Phase 5e QA Take#N* with the scenario id.

## 2. Scenarios

### S. Comparative Summary

| Id | Steps | Expected |
|---|---|---|
| S1 | On QA5E-P's record, enter paper scores: Day 1 ILT 1 (15 lifts, 12 accurate, 30 s), Day 1 ILT 2 (17, 15, 34 s), and Day 14 ILT 1 only (16, 14, 28 s). Open the **Comparative Summary** | **Day 1 · first pair** is tagged **Paper**: average time 32.0 s, pen lifts 16, accurate letters 13.5 / 15, accuracy 90.0, pen-lift score 94.1. Average speed, the speed and accuracy scores, composite and Pass/Fail read "not available on paper". Instead of the replay buttons: "Entered from the paper notebook: no replay, speed or composite." |
| S2 | Look at **Day 14** and the other anchors | Day 14 is tagged Paper, with "Only one block of the pair so far". The anchors with no entries show "No blocks yet" |
| S3 | The diagram under the boxes | The Day 1 first pair and Day 14 points show the paper time, pen lifts and accuracy. There is no speed line for them |
| S4 | As Administrator, import the legacy files under **QA5E old**. Open the Comparative Summary of one imported child (LEG-…) | A section **Results from the previous application**: "QA5E old · imported …", one row per block (pen lifts, width, total, writing and air time) and a **Mean** row. The note says the results are not scored or compared with the tablet anchors, and the width unit is not confirmed |

### A. Analyst portal and exports

| Id | Steps | Expected |
|---|---|---|
| A1 | In the portal, open the new **Paper and legacy** tab | Without research consent, QA5E-P and the LEG children are not counted: the Day 1 first pair shows 0 participants (unless other consented paper data exists) and the legacy label is missing |
| A2 | In the cockpit, record consent with **research use** for QA5E-P and one LEG child. Back in the portal, refresh | **Paper cohort**: the Day 1 first pair counts QA5E-P, with the S1 means (time 32.0, pen lifts 16.0, accurate 13.5, accuracy 90.0). **Previous application**: **QA5E old** with 1 participant and its means. "The blocks (n)" opens the rows |
| A3 | Imported LEG children have no gender, so first set the consented LEG child's gender to **Male** on their record. On **Research sessions**, set **Gender = Male**, then open **Paper and legacy** again | QA5E-P (Female) drops out; the male LEG child stays. With a session filter (for example Stage), the tab says the session filters do not apply here |
| A4 | **Exports**, with Gender cleared and no research sessions matching | Under the session count: "Also 2 participants with paper or legacy results (research consent; the participant filters apply)." **Contents** adds "Also: paper_blocks and legacy_blocks …". The button reads **Create export (paper and legacy results only)** and is enabled |
| A5 | Choose CSV, create the export, download it and open the zip | It has **paper_blocks.csv** and **legacy_blocks.csv** with the consented participants only, and the README explains both. No notes, file names or raw rows appear. The other tables are there, empty |
| A6 | **Hebrew**, with exactly 2 matching participants (as in A4) | The line reads "וגם 2 משתתפים …", not a raw key. *(Fixed in Take#2: every count in Hebrew now has a form for exactly 2)* |

### R. Research-purpose intervention sessions

| Id | Steps | Expected |
|---|---|---|
| R1 | *(Uses the temporary letter **ק (QA)**, set "QA test letters (temporary)", added for this take.)* Open any participant's Dispatch Console, Intervention program panel | A **Purpose** list: Intervention, Research. If research is not allowed, Research is greyed out, with the reason below (for example "Research sessions are turned off in the system settings") |
| R2 | *(Needs research sessions turned on in the system settings, a valid research ethics approval, and the participant's research consent.)* Choose **Research** and plan a training | The new session is Research-purpose: **Sessions** shows its purpose as Research |

### N. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| N1 | **English** and **Hebrew** | The Paper tag, "not available on paper", the legacy section, the portal tab and its notes are translated |
| N2 | **Dark** | The Paper tag and the new tables are readable |

## 3. Notes

- **Also fixed in 5e:** recording a consent signed "today" failed for about two hours after midnight in Israel, while it was still the previous day in UTC. The server now accepts today's date in any time zone. This can't easily be tested by hand, so it is covered by the developer's tests.
- **Not compared:** paper and legacy results are never mixed into the tablet scores, and the old application's measures are not mapped onto the anchors.
- **Cleanup by the developer after QA:** QA5E-P with its paper scores and consents, the **QA5E old** import (its batch and rows, and any LEG children it created), consents recorded for QA, research sessions planned in R2, the temporary letter set "QA test letters (temporary)" with its letter QA5E_LETTER_HE_QOF, and the test exports.
