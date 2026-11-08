# ILT — QA Scenarios: Phase 3d, Reference recordings and true-size preview

**Build:** on top of commit `8b80f5e`, not yet committed
**Date:** 2026-11-07
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-CAN-6, FR-CAN-9, FR-CAN-10, FR-CAN-11, FR-CAN-14, FR-TAB-8; DDD v1.6 §5.3, §7.3, §14

## 1. Before you start

| Item | Value |
|---|---|
| Administrator cockpit | https://10.0.0.14:5174/admin → **Canvases** tab |
| Tablet | https://10.0.0.14:5173 on the DTH-A116, with the pen |
| Accounts | A System Administrator; a Research Director (email and PIN) for D and E |
| A ruler | For the true-size check (B2) |

**Test canvas (recommended).** Recording into a canvas's own profile needs a **Draft**, and a Draft that has recordings can't be deleted, because recordings are kept for audit. So that you don't create a v2 of the live `ILT_3X5_HE`, load a test canvas: **+ Load a canvas** in a new Hebrew ILT set (for example "QA 3d"), code `QA3D_GRID`, geometry `Documents/04_Development_Plan/QA_Phase3c/ILT_4DOT_geometry.json`, profile `ILT_4DOT_profile.json`. When testing is done, activate and then retire it (or tell me and I'll remove it).

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 3d QA Take#N* with the scenario id.

**How it works:**
1. The canvas screen has a new section, **Reference tablet and recordings**. **Pair a tablet in reference mode** shows a 6-digit code, which you type on the tablet's usual PIN screen.
2. The tablet then shows an amber **Reference recording** bar.
3. From the canvas screen you can show the canvas at true size, or record a sample block or the normal speed.
4. The tablet sends what was written when you tap **[Done]** on the tablet, or **Finish** in the cockpit.
5. The cockpit shows the derived values with **Accept** and **Clear**.

## 2. Scenarios

### A. Pairing in reference mode

| Id | Steps | Expected |
|---|---|---|
| A1 | Open any canvas (for example `ILT_3X5_HE`) | Below the preview: "Reference tablet and recordings", with **Pair a tablet in reference mode** |
| A2 | Click it | "Tablet not connected" and "On the tablet, type the code" with a 6-digit code |
| A3 | Type the code on the tablet | The tablet shows the amber bar "Reference recording (not a child session)" and "Reference mode: waiting for the administrator". The cockpit shows **Tablet connected** |
| A4 | Wrong code on the tablet | "Wrong code", as for a session |
| A5 | Move to another canvas in the cockpit (back to the library, open another) | The tablet stays paired: **Tablet connected** on the new canvas too |

### B. True-size preview (FR-CAN-6)

| Id | Steps | Expected |
|---|---|---|
| B1 | **Show on the tablet at true size** | The tablet shows the canvas with "True-size preview" in the bar, the note "Check the size with a ruler, then tap Done." and **[Done]**. The cockpit: "True-size preview — Writing on the tablet…" with **Finish** |
| B2 | Measure a box with the ruler | `ILT_3X5_HE` boxes are 35 × 25 mm (within about 1 mm; if not, recalibrate the tablet) |
| B3 | Write on it, then **[Done]** with the pen | The tablet returns to waiting; nothing is added to the recordings |
| B4 | Show the notebook canvas (`NOTEBOOK_HE`) | It previews too (notebook canvases can be previewed, not recorded) |
| B5 | While a canvas is on the tablet, click **Show on the tablet** again | The buttons are disabled until the tablet finishes |

### C. Sample block on a Draft (FR-CAN-9, FR-CAN-14)

| Id | Steps | Expected |
|---|---|---|
| C1 | Open the test Draft `QA3D_GRID`. **Record for** shows "This Draft (QA3D_GRID v1)" | Selected by default |
| C2 | **Record a sample block**; on the tablet fill **every box** in the order a child should (one stroke per letter, lifting the pen between letters); **[Done]** | The cockpit shows "Sample block · Canvas profile", the **fill order** (box ids), "*N* pen lifts · *all* of *all* boxes", and what the profile has now. **Accept** is enabled |
| C3 | Fill the boxes in an order different from the Hebrew direction (for example left to right) | A warning: "This order differs from the language's fill direction:" with the direction's order |
| C4 | **Accept** | "The recording was accepted into the profile". In **Scoring profile**, *Fill order* and *Expected pen lifts* show the new values |
| C5 | Record again, but leave some boxes empty | "Not every box was written…"; **Accept** is disabled. **Clear** → "The recording was cleared (it is kept for audit)" |
| C6 | Open **Recordings of this canvas** | Each recording: time, kind, for, values, status (Accepted / Cleared / Waiting), recorded by and decided by |

### D. Normal speed (FR-CAN-10)

| Id | Steps | Expected |
|---|---|---|
| D1 | On the Draft: **Rows** 1, **Writer** "skilled adult writer", **Record the normal speed** | The tablet note: "Write one row at a natural pace, then tap Done." |
| D2 | A skilled writer writes the **first row** (in the fill order) through the dots, at a natural pace; **[Done]** | The cockpit shows the speed in mm/s (FRS example: 19.45 mm/s), "*n* of *n* letters · line length … mm in … ms" and the current Normal speed ("not configured" before) |
| D3 | **Accept** | The profile's **Normal speed** is the measured value |
| D4 | Record again but write only part of the row; press **Finish** in the cockpit instead of [Done] | The tablet stops; "The row is not complete…"; only **Clear** is possible |
| D5 | Activate the Draft (director's PIN) | New sessions now get a **speed score** and a **composite** (the Comparative summary stops showing "not configured" for sessions created after this) |

### E. Domain profile on an Active canvas

| Id | Steps | Expected |
|---|---|---|
| E1 | Open an **Active** canvas | **Record for** asks to "Choose a Domain…"; a note says the canvas's own profile changes only in a Draft |
| E2 | Choose a test Domain (for example `QA3A_D1`), record the normal speed, then **Accept** | The director's email and PIN fields appear; **Accept** stays disabled until both are filled. A wrong PIN: "The director email or PIN is wrong" |
| E3 | Correct PIN → **Accept** | The Domain overrides section lists the Domain with the new Normal speed |

### F. Interruptions and closing

| Id | Steps | Expected |
|---|---|---|
| F1 | Start a recording, then reload the tablet page mid-writing | The cockpit: "The tablet restarted and lost the canvas. Show it again."; the buttons are available again |
| F2 | Turn the tablet's Wi-Fi off for a few seconds while writing, then on, then **[Done]** | The recording arrives complete (the tablet buffers, as in sessions) |
| F3 | **Disconnect the tablet** | The tablet returns to the PIN screen; the cockpit shows **Pair a tablet in reference mode** again |
| F4 | Try to delete a Draft that has recordings | "This Draft has reference recordings, which are kept: it cannot be deleted" |

### G. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| G1 | Cockpit and tablet in Hebrew, then English | All new texts translated; box ids and mm/s read left to right in Hebrew |
| G2 | Dark, then Light | The panel, the result card and the history stay readable |

## 3. After testing

Tell me which test canvases, Domain overrides and recordings to remove. Recordings can't be removed from the cockpit by design (FR-CAN-11), so I'll remove them directly in the database.

## 4. Notes

- Pen lifts follow the scoring rule: a pen-up shorter than 50 ms (setting `scoring.pen_lift.min_gap_ms`) is not a lift. Lift the pen clearly between letters in the sample block.
- The normal speed uses the same formula as a child's block (line from dot A's radius to dot C's radius), so write **through the dots**.
- Recordings are made on the canvas as stored (not mirrored). Mirroring doesn't change box ids or the fill order.

## 5. Results

### Take#1 (2026-11-07, Yaki at the tablet, Claude in Chrome driving the cockpit)

| Ids | Result | Notes |
|---|---|---|
| A1–A3, A5 | Pass | |
| A4 | Not reported | |
| B1–B5 | Not reported | B2 needs the ruler reading |
| C1 | Pass | |
| C2 | Partial | 15 of 15 boxes, 15 pen lifts, but recorded for Domain GENERAL on `ILT_3X5_HE`, not on the Draft |
| C3–C6 | Skipped | |
| D1–D3 | Pass | 17.08 mm/s accepted on the `QA3D_GRID` Draft |
| D4 | Skipped | |
| D5 | Partial | Activated with the director's PIN; the speed score in new sessions not checked |
| E1–E3 | Pass | On GENERAL; the wrong-PIN message not confirmed |
| F1–F3 | Not reported | |
| F4 | Skipped | The Draft was activated first |
| G1–G2 | Not run | |

**Findings:**
1. *"Approved by" cut off ("Jacob Gr").* Not a defect: that is the full name stored on the account `yakig@wondernet.co.il`. Correct it in **Users** if wanted.
2. *Opening a canvas didn't change the address.* Fixed: an open canvas is now `#/canvases/<id>`, so a refresh keeps it open, browser Back returns to the library and Forward reopens it.

**Data left by Take#1:** removed from the database on 2026-11-07: the three GENERAL recordings on `ILT_3X5_HE` (its GENERAL override had already been removed in the cockpit), and the retired `QA3D_GRID` with its recording. The Standard ILT set keeps `ILT_3X5_HE` v1 (Active).

**For Take#2:** C3–C6, D4, the D5 scoring check, F1–F4, G1–G2, A4 and B1–B5. Load a fresh test canvas (for example `QA3D_GRID2`) so there is a Draft. Do C3–C6, D4 and F4 on it **before** activating it, then D5.
