# ILT — QA Scenarios: Phase 5b, Intervention sessions and the sheet flow

**Build:** on top of commit `dfb98b6`, not yet committed
**Date:** 2026-11-12
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-PLAN-3 (Phase 5b design note), FR-PLAN-8, FR-COCK-7, FR-TAB-4; DDD v1.6 §6.2, §10, §11.1, §17
**Decisions (2026-11-12):**
- Each intervention session works on **one target letter**. **Training** is the letter's video, then 4 training sheets. **Repeat letter** trains the same letter again, and **Next letter** starts the next letter not yet trained. The **2-week retention** check is one sheet.
- Only **Active** letters are offered. The team's four letters stay Draft, so QA uses **temporary test copies**.
- The letter video plays when the library has one. Otherwise the cockpit offers to skip it, as with the missing English videos.

Phase 5 parts:
- 5a: the letter canvases (done).
- **5b: this document.**
- 5c: suggested marks and the evaluator's review.
- 5d: sheet scoring and results.

In 5b, a letter sheet is stored and measured for **time and pen lifts only**. There are no marks or sheet scores yet.

## 1. Before you start

| Item | Value |
|---|---|
| Evaluator cockpit | **https://10.0.0.17:5174** |
| Tablet | The DTH-A116, kiosk at **https://10.0.0.17:5173** |
| Accounts | An Evaluator account, plus an Administrator account for R2 |
| Test letters | A temporary set **"QA test letters (temporary)"** holds Active copies of two letters: `QA_LETTER_HE_HE` (ה) and `QA_LETTER_HE_QOF` (ק). The developer removes it after QA |
| Test data | Create one test participant, for example **QA5B-01** (Hebrew, any school). Every session in this QA belongs to it. Leave it in place for the developer to remove |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**. Report failures as *Phase 5b QA Take#N* with the scenario id.

## 2. Scenarios

### P. Planning in the Dispatch Console

| Id | Steps | Expected |
|---|---|---|
| P1 | Open QA5B-01's **Protocol** (Dispatch Console) | The **Intervention program** panel lists the letters in Hebrew: ה and ק, each "Not trained". **Target letter: ה**. **Video + 4 Training Sheets** is enabled ("First training of ה"), and **Next Letter** says "Start training ק". **2-Wk Retention** ("After the training") and **Repeat Letter** ("After the first training") are disabled. "No intervention session yet." The team's Draft letters (`LETTER_HE_*`) are **not** listed |
| P2 | Click ק, then ה | The target letter follows the click, and the selected letter is outlined in green |
| P3 | With ה as target, click **Video + 4 Training Sheets** | A card appears under **Intervention sessions**: "Training · ה", its session code, "Sheets 0/4", [ DISPATCH ]. The panel says an intervention session is open, and all four buttons are disabled |
| P4 | **Sessions** list, Type **Intervention** | The new session is listed (type Intervention) |
| P5 | Click the card | The session opens. The header reads "QA5B-01 · Intervention · Training · **ה** · Hebrew". Steps: **Letter video** ("No video in the session language": Skip), then **Letter sheet 1** … **Letter sheet 4** |

### T. The sheet on the tablet

| Id | Steps | Expected |
|---|---|---|
| T1 | Pair the tablet with the session's code, and **Skip** the letter video | The video step shows Skipped. The next step is Letter sheet 1 |
| T2 | **Send to tablet** on Letter sheet 1 | The tablet shows **"Sheet 1 of 4"** and the ה sheet at true size, with the model in light blue in the right-most box of row 1. The cockpit's mirror shows the same sheet, with the active box highlighted |
| T3 | Write: trace row 1 right to left, then row 2 from the start dots, then row 3 freehand | Boxes advance right to left, row by row. Finished boxes lock (writing in an earlier box leaves no ink). Ink appears on the mirror live |
| T4 | Look at **Clinical telemetry** while writing | Shown: active box "n of 15", block time, inactivity, pen lifts, internal lifts, skipped boxes. **Not shown:** width outside the band, dot B hit, average ILT speed. Note: "Letter sheet: time and pen lifts only for now; marks and sheet scores are not available yet" |
| T5 | Finish the sheet (**Next block** on the tablet after the last box, or **Finish block manually**) | The result shows the time and pen lifts, no accuracy or composite, and the same note. **Replay** opens the sheet with the ink |
| T6 | If you pressed **Next block** on the tablet | Letter sheet 2 starts on the tablet straight away ("Sheet 2 of 4") |
| T7 | Do sheets 2–4 (a few strokes each is enough), then **Finish session** | The session completes. In the console, the card turns green: "Training · ה", Sheets 4/4, [ COMPLETED ] |
| T8 | Back in the console | ה reads "Trained once · Retention from *(today + 14 days)*". **2-Wk Retention**: disabled, "1 sheet, from *(that date)*". **Video + 4 Training Sheets**: disabled, "Already trained: Repeat". **Repeat Letter** and **Next Letter (ק)**: enabled |

### R. Repeat, retention and next letter

| Id | Steps | Expected |
|---|---|---|
| R1 | **Repeat Letter**, open the new session, then **Abort session** | A second "Training · ה" session is planned, then disappears from the console once aborted. ה is still "Trained once" |
| R2 | As Administrator: **Settings** → QA5B-01's Region → **Days from training to the retention check** = 0. Back in the console, refresh | ה: "Retention due"; **2-Wk Retention**: "1 sheet, due now", enabled |
| R3 | **2-Wk Retention**, open the session | "Retention check · ה": **one** Letter sheet, no video. Run it on the tablet and complete it. In the console, ה reads "Retention done". **Reset the setting** of R2 afterwards |
| R4 | **Next Letter** | A "Training · ק" session is planned, and the target becomes ק |
| R5 | Open it, skip the video, and send Letter sheet 1 | ק's long leg and its last dot reach below row 1, into the gap. Writing the leg there works, and the next box starts at the next letter. Abort the session afterwards |

### N. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| N1 | Console and session screen in **English** | The panel, letter states, buttons, session cards, step names ("Letter video", "Letter sheet 1") and the note are in English. The letters stay Hebrew |
| N2 | **Dark** theme | The panel and cards are readable. The sheet stays white |

### F. Fixes from Take#1 (retest)

| Id | Steps | Expected |
|---|---|---|
| F1 | In an intervention session with no block running, look at **Clinical telemetry** | Width outside band, Dot B hit and Average ILT speed stay hidden between sheets too |
| F2 | With a session open in the cockpit, stop the server (ask the developer), then start it again | As soon as the cockpit shows the server Offline, it also shows **Tablet not connected**. After the server is back and the tablet reconnects, it shows Tablet connected again |
| F3 | During a sheet, let the tablet sleep (or press its power button), then wake it | When the browser bars show again, a **⛶ Full screen** button appears at the bottom corner. Tapping it hides the bars and the button. The sheet and its ink are unchanged |

## 3. Notes

- **For the clinical team:**
  - Letter videos: when the team has a video per letter, it is added to the library under the key `letter_` + the letter's code without "LETTER_", for example `letter_he_he` for `LETTER_HE_HE`.
  - The numbers: 4 training sheets, and retention after 14 days with one sheet, are settings and can be changed.
- **Not in 5b:**
  - Marks per letter and the evaluator's review come in 5c, and sheet scores in 5d.
  - Intervention sessions are not in the Comparative Summary, the analyst portal or the research exports yet.
- **Cleanup by the developer after QA:** the "QA test letters (temporary)" set and its two letters, QA5B-01 with its sessions and their log rows, and any setting changed in R2.
