# ILT — QA Scenarios: Phase 4b, Kinematic views

**Build:** on top of commit `d5dd403`, not yet committed
**Date:** 2026-11-10
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-AN-1 (kinematic views: velocity, jerk, pressure), FR-AN-3; DDD v1.6 §8.9, §14

Phase 4b adds the kinematic views to the analyst portal. A new part of the system, the **analytics service**, computes them from the research data. It runs on the development PC beside the gateway.

## 1. Before you start

| Item | Value |
|---|---|
| Analyst portal | **https://10.0.0.17:5175** |
| Evaluator cockpit | https://10.0.0.17:5174 (Administrator: `/admin`) |
| Accounts | `dev-analyst@ilt.local` (Analyst) or your Researcher account |
| Test data | **S261108-QA4A** is back for this QA: participant **QA4A-01**, a copy of the pen data of S261102-EJX5, under a Research approval "QA 4a". Tell me when you are done and I'll remove it again |

**Terms:**
- A *stroke* is one pen contact, from pen down to pen up.
- *Normalised jerk* has no unit; lower means smoother.
- *Velocity peaks* count the bumps in the speed curve. Fewer bumps per stroke means more automatic writing.

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 4b QA Take#N* with the scenario id.

## 2. Scenarios

### K. Session page

| Id | Steps | Expected |
|---|---|---|
| K1 | Sign in, open **S261108-QA4A** | Below **Blocks and attempts** there is a new **Kinematics** section with a note, and one row for each block with pen samples: the warm-up, ILT blocks 1–8 and notebook pages 1–4. The warm-up and notebook rows are greyed, as in the blocks table |
| K2 | Read the row **ILT block 1** | Strokes 14, writing time 12.72 s, path 409.6 mm, mean speed 32.2, peak speed 140.3, velocity peaks per stroke 4.86, normalised jerk 2844.6, mean pressure 0.28 |
| K3 | In **Blocks and attempts**, look at the last column | Each block with samples now has **Replay** and **Kinematics** |

### L. One block's kinematics

| Id | Steps | Expected |
|---|---|---|
| L1 | **Kinematics** on ILT block 1 | The address ends with `#/kinematics/…`. Title: "Kinematics: S261108-QA4A · ILT block 1 · attempt 1 · ILT_3X5_HE", followed by a short explanation |
| L2 | **Block summary** | The K2 figures, plus "14 (14 measured)" strokes and mean jerk about 109,297 mm/s³ |
| L3 | **Speed, jerk and pressure over time** | Three charts on one time axis from 0 to about 26 s, one bump group per letter with gaps where the pen was lifted. Speed mostly under about 120 mm/s, pressure about 0.2–0.45 |
| L4 | Point at a chart and move along it | A dashed line appears on all three charts at once. The line above the charts reads time · stroke · letter · speed · jerk · pressure, or "pen lifted" between strokes. In Hebrew the time reads "5.21 s", not "s 5.21" |
| L5 | **Highlight**: choose **Letter 3** | A light band marks letter 3 on all three charts; **No letter** removes it |
| L6 | **Letters, in writing order** | 14 rows (Letter 1 … Letter 14) with the same columns as the summary. Clicking a row highlights that letter on the charts and in the table |
| L7 | Open **Strokes (14)** | One row per stroke: start, duration, path, mean and peak speed, velocity peaks, normalised jerk, pressure; a note explains the measures |
| L8 | **← Session** | Back to the session page |
| L9 | Kinematics of a **notebook page** and of the **warm-up** | Both open the same way |

### M. Access and logging

| Id | Steps | Expected |
|---|---|---|
| M1 | (Admin) **Action log**, type *Kinematics opened* | "Kinematics opened: S261108-QA4A step 2, attempt 1" with `"portal": "analyst"`, **one row per opening** |
| M2 | In the cockpit, record a consent for QA4A-01 **without** research use, then reload the kinematics page | Not found, and the session disappears from the portal. Record a consent **with** research use to bring it back |

### N. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| N1 | Hebrew and English | All texts translated; the charts keep time running left to right in both |
| N2 | Dark and Light | Charts, bands, crosshair and tables readable |

## 3. Notes

- The analytics service reads the database as the analyst role. Like the portal, it can see only completed Research sessions with research consent.
- Nothing is stored: the figures are recomputed from the pen samples each time a page opens. The recorded samples and scores never change.
- Jerk is the third derivative of the pen position, so it is very sensitive to small tremors; the jerk chart looks much spikier than the speed chart. For comparisons, normalised jerk is the more useful number.
- Cohort-level kinematic means and exports come with Phase 4c.

## 4. Results

### Take#1 (2026-11-11)

All scenarios passed: K1–K3, L1–L9, M1, M2 and N2. N1 passed with two minor Hebrew findings:

| Finding | Fix |
|---|---|
| The pressure range read "(1–0)" in Hebrew | The unit in each chart title is isolated, so it keeps its own direction: "(0–1)" |
| The chart titles kept "(mm/s)" and "(mm/s³)" in Hebrew, while the tables and the readout used Hebrew units | The chart units are translated: "מ"מ/ש׳" and "מ"מ/ש³" in Hebrew, as in the tables and the readout |

Re-test in Take#2: **N1** only. In Hebrew, the chart titles read "מהירות (מ"מ/ש׳)", "טלטלה (jerk) (מ"מ/ש³)" and "לחץ (0–1)"; in English they read "Speed (mm/s)", "Jerk (mm/s³)" and "Pressure (0–1)".

### Take#2 (2026-11-11)

N1 passed. In Hebrew the chart titles read "מהירות (מ"מ/ש׳)", "טלטלה (jerk) (מ"מ/ש³)" and "לחץ (0–1)", with 0 first on screen. English is unchanged. Every Phase 4b scenario has passed, with no open findings.

**Cleanup done:**
- Session S261108-QA4A, with its blocks and pen data;
- participant QA4A-01 and its three QA4A consent records (the fixture's and the two recorded in QA);
- the "QA 4a" research approval;
- the session's seven "Kinematics opened" log rows and the two consent log rows.
