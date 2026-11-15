# ILT — QA Scenarios: Phase 5g, Cohort overview (analytics dashboard)

**Build:** on top of commit `c98b6a9`, not yet committed
**Take#2 (2026-11-15):** the charts keep their width when the language or theme changes (and when the tab was in the background); the box-plot names are no longer cut off and the line-end names have more room. `DEMO5G-01` now has a Day 14 composite below 60, so it shows **✗ Below the threshold**. Please re-run **N1**, **N2**, **O3** and **O7**.
**Date:** 2026-11-15
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-AN-1 (restored from FRS v3.3 §3.1, Figure 8: learning curves and box plots), FR-AN-3; DDD v1.6 §14 (`/research/overview`)
**What it adds:** an **Overview** tab in the analyst portal, with the research filters, summary tiles, a learning curve, box plots per group, and a participant table with the Day 14 result and replay.

## 1. Before you start

| Item | Value |
|---|---|
| Analyst portal | **https://10.0.0.17:5175**, signed in as an analyst or researcher |
| Data | The developer added **14 demo participants** (`DEMO5G-01` … `DEMO5G-14`, school codes `14b39180` and another) with completed Research sessions: 11 have Day 1, Day 2 and Day 14; 2 have Day 1 and Day 2; 1 has Day 1 only. SES is Low, Middle and High in turn. The blocks have scores but no pen strokes, so their replay shows an empty sheet |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**. Report failures as *Phase 5g QA Take#N* with the scenario id.

## 2. Scenarios

### O. Overview

| Id | Steps | Expected |
|---|---|---|
| O1 | Open **Overview** | The tab is first in the menu. Filters as on **Research sessions**; tiles: **Participants 14**, **Sessions 38**, **Counted blocks 186**, mean time, mean accuracy and mean composite |
| O2 | **Compare by: No grouping**, **Measure: Time (s)** | **Learning curve**: one line over Day 1 blocks 1–8, Day 2 1–4 and Day 14 1–2, broken between the days, getting faster. Hovering a block shows its mean and the number of blocks |
| O3 | **Compare by: SES group** | Three lines (High, Low, Middle) with a legend and their names at the line ends; Low is slowest. **Spread by group**: three boxes, with n=4, 5 and 5 |
| O4 | Change **Measure** to Composite, Accuracy, Pen lifts, ILT speed, Speed score | The curve, the boxes and their titles follow the measure |
| O5 | **Show as a table** under each chart | The same numbers as a table (for the curve: mean and number of blocks per block) |
| O6 | Set a filter, for example **SES group: Low** | Tiles, charts and table show only those participants (5). The filter is kept when you switch to **Research sessions** and back |
| O7 | **Participants** table | One row per participant; stages in protocol order (Day 1, Day 2, Day 14); **Day 14 composite** and **Day 14** (✓ Pass or ✗ Below the threshold, against the threshold the session used); `DEMO5G-01` is **✗ Below the threshold** (49.5), the others pass; `DEMO5G-12`…`14` have no Day 14 result |
| O8 | **Replay** on a row | Opens the replay of that participant's first Day 14 block; **Back** returns to the Overview |
| O9 | **Compare by: School code** | Two lines and two boxes |
| O10 | A filter with nothing, for example a date long ago | Tiles show 0; the charts say there are no counted ILT blocks |

### N. Languages, themes and sizes

| Id | Steps | Expected |
|---|---|---|
| N1 | **English** and **Hebrew** | Everything on the tab is translated; the charts read left to right in both |
| N2 | **Dark** | Lines, boxes, tooltips and labels are readable |
| N3 | A phone, or a narrow window | The page does not scroll sideways; the learning curve scrolls inside its own box |

## 3. Notes

- **Counted blocks** are as in the cohort table: the latest finished attempt of each scored block. The curve and the boxes use ILT blocks only.
- **Pass threshold:** the Day 14 result uses the threshold saved in each session when it was created (`scoring.pass_threshold` in its settings snapshot), not the Domain's current setting. The demo sessions were saved with 60.
- **Box plots** compare participants: each participant's own mean over their ILT blocks in the selection. The box is the middle half (25th to 75th percentile), the line the median, the whiskers the lowest and highest.
- At most **six lines** are drawn (the groups with the most participants); the table under the chart has them all.
- **Superset / Metabase:** a live connection is not part of this phase; they read the Parquet/CSV exports (FR-AN-2).
- **Cleanup by the developer after QA:** the 14 `DEMO5G-` participants with their sessions, blocks and scores.
