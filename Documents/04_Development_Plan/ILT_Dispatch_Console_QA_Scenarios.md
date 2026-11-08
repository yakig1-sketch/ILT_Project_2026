# ILT — QA Scenarios: Evaluator Control & Dispatch Console

**Build:** on top of commit `a3a4045` together with Phase 3c, not yet committed
**Date:** 2026-11-06
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-COCK-7 (restored from FRS v3.3, Figure 2 "Evaluator Control & Protocol Dispatcher Console"); DDD v1.6 §14 (`/participants/:id/protocol`)

## 1. Before you start

| Item | Value |
|---|---|
| Evaluator cockpit | https://10.0.0.14:5174 |
| Tablet | https://10.0.0.14:5173 on the DTH-A116 (for D1–D3) |
| Accounts | **Dev Evaluator**; a second evaluator for F1 (create one in the Administrator cockpit, for example `qa-con-eval2@ilt.local`) |
| Test participant | Create `QA-CON-01` (Grade 2, Domain General) with **+ New participant** |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 3 QA Take#N* with the scenario id.

**How the console works:** it shows one participant's whole protocol. Each day is a panel of step cards; blocks or pages of the same kind that follow each other form one card (for example "ILT 4 Blocks, Blocks 1–4 (Scored)"). Card colours: **green** completed, **blue** active (with how many of its steps are done), **grey [DISPATCH]** still to run, **grey [PENDING DAY N]** the day's session is not planned yet. Clicking a card opens that session in the live cockpit, where you pair the tablet and send the steps.

## 2. Scenarios

### A. Opening the console

| Id | Steps | Expected |
|---|---|---|
| A1 | Create a Day 1 session for `QA-CON-01`; go back to the session list | The row has **Protocol** and **Open**; the participant code is a link |
| A2 | Click **Protocol** (then try the participant code link) | The console opens: a navy header "ILT Evaluator Control & Dispatch Console" with "Protocol Dispatcher \| Subject: QA-CON-01 \| Grade: Grade 2 \| General" |
| A3 | In the live session screen, click **Protocol** (next to **Comparative summary**) | The same console opens |
| A4 | **← Sessions** | Back to the session list |

### B. Layout (compare with FRS v3.3 Figure 2)

| Id | Steps | Expected |
|---|---|---|
| B1 | Look at the Day 1 panel (light blue, full width) | "DAY 1: ACQUISITION PROTOCOL", the session code, status and language, then the cards: 1. Show Intro Video · 2. Intro Block (warm-up, not scored) · 3. ILT 4 Blocks (Blocks 1–4 Scored) · 4. Show NB Video · 5. NB 4 Pages (Notebook canvas 1–4) · 6. ILT 4 Blocks (Blocks 5–8 Scored), all **[ DISPATCH ]** |
| B2 | Below it, three panels side by side | Day 2 "24H RETENTION PROTOCOL" (ILT 4 Blocks, Paper NB 2 Pages), Day 14 "TWO-WEEK AUTOMATICITY" (ILT 2 Blocks, the retention-check card and **Comparative Summary View**), and the green "INTERVENTION PROGRAM" panel |
| B3 | Day 2 and Day 14 before they are planned | Grey cards **[ PENDING Day 2 ]** / **[ PENDING Day 14 ]**, not clickable, and **+ Plan the Day 2 session** / **+ Plan the Day 14 session** |
| B4 | The status bar at the bottom | "Active protocol status: no step is running on the tablet."; the timer policy ("System defaults = 20 s in transition, 20 s inactivity timeout. Domain and Region overrides require Research Director approval."); the warm-up line; a large **OPEN LIVE COCKPIT** button |
| B5 | The intervention panel | "Active target letter: none yet"; four greyed buttons (2-Wk Retention, Video + 4 Training Blk, Repeat Letter Block, Next Letter Block); a note that it opens with the intervention phase. Clicking them does nothing |

### C. Cards open their session

| Id | Steps | Expected |
|---|---|---|
| C1 | Click any grey **[ DISPATCH ]** card of Day 1 | The live cockpit of that Day 1 session opens |
| C2 | **Protocol** to go back; **+ Plan the Day 2 session** | A Day 2 session is created in the participant's default language; its cards turn to **[ DISPATCH ]** and show the new session code |
| C3 | Click a Day 2 card | The Day 2 session opens in the live cockpit |
| C4 | **OPEN LIVE COCKPIT** | Opens the session that is in progress (or paired, or paused); with none, the first planned one |

### D. States as the session runs (with the tablet)

| Id | Steps | Expected |
|---|---|---|
| D1 | Pair the tablet to the Day 1 session; play the intro video and finish it; go to the console | Card 1 green **[ COMPLETED ]** |
| D2 | Dispatch the warm-up and block 1; while block 1 runs, open the console | Card 2 green; card 3 blue **[ ACTIVE 0/4 ]** with a light outline. The status bar: "step 3 (ILT 4 Blocks) of Day 1 dispatched to the student tablet." |
| D3 | Finish blocks 1 and 2 | Card 3 shows **[ ACTIVE 2/4 ]**; when all four are done it turns green |
| D4 | Skip a step in the live cockpit | A card whose steps were all skipped shows **[ SKIPPED ]** (lighter grey) |

### E. Day 14 and the summary

| Id | Steps | Expected |
|---|---|---|
| E1 | Before Day 14 is scored | The retention-check card says the 2 blocks' average score shows once both are scored |
| E2 | (Optional) Run Day 14 blocks 1 and 2 | The card shows "2 blocks average score: NN.N" |
| E3 | **Comparative Summary View** | The participant's Comparative Summary opens |

### F. Another evaluator's session

| Id | Steps | Expected |
|---|---|---|
| F1 | Sign in as the second evaluator; find `QA-CON-01` (create a session for another participant to reach the list, or open `#/participant/<id>`) | The console shows Dev Evaluator's sessions with their status, but the cards can't be clicked and say "Another evaluator runs this session." |
| F2 | Retest of Take 1 (Day 1 shown as planned after it was completed): open the console of `YG1102` | Day 1 shows **S261102-EJX5 · Completed** with all six cards green **[ COMPLETED ]**; under the cards, "Other sessions of this day: S261105-JMZW (Planned)". Day 2 shows S261103-8ND7 and lists S261102-7CRX under it |

### G. Settings shown

| Id | Steps | Expected |
|---|---|---|
| G1 | In the Administrator cockpit, give the participant's Region its own **Transition countdown** (for example 10 s); reload the console | "Timer policy: Region override = 10 s in transition, …" |
| G2 | Turn the Region's **Warm-up block** off | The warm-up line says it is off for the participant's Region; a newly planned day has no Intro Block card. Put both back afterwards |

### H. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| H1 | Switch to **עברית** | Every title, card, state, button and status line in Hebrew, right to left; codes read left to right; the arrows on the blue buttons point left |
| H2 | Theme Dark, then Light | The coloured cards and the navy header look the same in both; the panels and status bar follow the theme and stay readable |
| H3 | Narrow the window | The cards wrap onto more rows; the three lower panels stack; nothing is cut off |

### I. Comparative summary diagram (ECR)

| Id | Steps | Expected |
|---|---|---|
| I1 | Open the Comparative summary of `YG1102` (**Comparative Summary View** on the console, or **Comparative summary** in the session) | Below the five boxes, "Comparative summary diagram": four lines (Average time (s) blue, Pen lifts (count) orange, Accuracy (%) green, Average ILT speed (mm/s) yellow) over Day 1 (1–2), Day 1 (7–8), Day 2 (1–2), Day 2 (3–4), Day 14 (1–2); one axis 0–100; the legend above and each line's name at its end |
| I2 | Hover over an anchor | A dashed line marks it and a tooltip lists the four values; they match that anchor's box |
| I3 | A participant with only Day 1 run | The lines stop after Day 1 (no line drawn to empty anchors); a participant with no blocks has no diagram |
| I4 | Hebrew, then English; Dark, then Light | Texts in the chosen language; the ranges read "(1–2)" in both; lines and labels stay readable in both themes |
| I5 | Look at **Pen lifts** in each box of `YG1102` | Whole numbers: Day 1 first pair **15** (blocks 14 and 15), then 15, 17, 16, 16; the diagram's tooltip shows the same |
| I6 | ECR 2: look at the legend of `YG1102`'s diagram, then hover over an anchor | A fifth entry, **Speed score (0–100)** in pink. `YG1102` has no speed score (its canvas had no normal speed), so there is no pink line and the tooltip shows "not configured". In Hebrew the range reads "(0–100)" |
| I7 | ECR 2: a participant whose sessions were created after the canvas got a normal speed (Phase 3d D5) | A pink line with the same values as each box's **Speed score** |

## 3. After testing

Tell me the test participants and evaluators you created, and I'll remove them with their sessions. Put back any Region setting you changed in G.

## 4. Known differences from Figure 2

- Day 1 follows the current Day 1 template: the notebook video plays before the four notebook pages (the figure shows NB 2 pages, the video, then NB 2 pages).
- The figure's warm-up text ("1 valid row … permits immediate transition") belongs to the old rule; since FRS v3.5 the warm-up is one full block, measured and not scored, and the status bar says so.
- The intervention panel is shown disabled until the intervention phase (letter sets, intervention sessions).
- Steps are dispatched in the live cockpit: a card opens its session there rather than sending the step from the console.
