# ILT Phase 3c — QA Scenarios: Canvas library

**Build:** Phase 3c, on top of commit `a3a4045`, not yet committed
**Date:** 2026-11-05
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 §5.1–5.3 (FR-CAN-1…8), FR-ROLE-3; DDD v1.6 §7, §12, §14

## 1. Before you start

| Item | Value |
|---|---|
| Administrator cockpit | https://10.0.0.14:5174/admin → **Canvases** tab |
| Evaluator cockpit | https://10.0.0.14:5174 (in a private window) |
| Accounts | **Dev Admin**, **Dev Evaluator**, and a Researcher with a director PIN (for example the one you used in 3b) |
| Sample files | [QA_Phase3c](QA_Phase3c): `ILT_4DOT_geometry.json` (a 4-dot ILT grid), `ILT_4DOT_problems_geometry.json` (too wide, and dot D outside its box), `ILT_4DOT_profile.json` (a scoring profile for the 4-dot grid) |
| Test names | Start every canvas code and set name with `QA3C` (for example code `QA3C_4DOT_HE`) |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 3 QA Take#N* with the scenario id.

**How the library works:**

- Canvases are grouped by **language → canvas set → canvas**. A set has a type: ILT blocks, notebook pages or intervention letters.
- A new canvas is loaded as a **Draft**. A Draft can be edited, checked and deleted. **Activate** makes it **Active**; an Active canvas never changes. **New version** makes an editable Draft copy; activating it retires the version before it.
- Settings name a canvas by its **code** (for example `ILT_3X5_HE`). New sessions always get the Active version of that code.
- Activating an ILT or intervention canvas puts its **scoring profile** into use, so a Research Director approves it with their email and PIN (when director approval is on in Settings). Domain overrides of the profile are approved the same way.

**Watch out:** don't retire or replace the seeded canvases (`ILT_3X5_HE`, `ILT_3X5_EN`, `NOTEBOOK_HE`, `NOTEBOOK_EN`). Every session uses them. Work on your own `QA3C` canvases.

## 2. Scenarios

### A. The library

| Id | Steps | Expected |
|---|---|---|
| A1 | Canvases tab | A short explanation, Language and Type filters, **+ New canvas set**, **+ Load a canvas**. The seeded sets are listed: ILT blocks and Notebook pages for Hebrew and English, and the empty Hebrew intervention letters set. Each canvas row: code, name, version, status, activation date, number of Domain overrides, **Open** |
| A2 | Filter Language = English, then Type = Notebook pages | Only the matching sets |
| A3 | Open `ILT_3X5_HE` | Status **Active**; "Used in N session steps"; "Named in Settings: language.he.ilt_canvas · built-in default"; Versions: v1 (Active). A preview of the 15 boxes with their 3 dots; the scoring profile read-only (A → B → C; B 1.3 mm, 90%, required; 15 pen lifts; speed not recorded; ± 10%) |
| A4 | In the preview, tick and untick **Box numbers and fill order** | Blue box numbers (#0–#14) and pink fill positions (1 at the top-right box, right to left) appear and go |
| A5 | Size: **True size (about)**, then **Twice true size**, then **Fit to the window** | The preview resizes; with true size, a box measures about 35 × 25 mm with a ruler (exact on a 96 dpi screen) |
| A6 | Open `NOTEBOOK_HE` | No scoring profile and no Domain overrides section (notebook pages are timed only) |

### B. Canvas sets (FR-CAN-1)

| Id | Steps | Expected |
|---|---|---|
| B1 | **+ New canvas set**: Hebrew, ILT blocks, names `QA3C סט` / `QA3C set`; **Create** | "Canvas set QA3C set created"; the set appears, empty ("No canvases in this set yet") |
| B2 | Create another Hebrew ILT set named `qa3c SET` | Refused: a set with this name already exists for this language and type |
| B3 | **Rename** the set; save | The new names show |
| B4 | **Deactivate** the set; confirm | Greyed with **Inactive**; **+ Load a canvas** no longer offers it. **Reactivate** brings it back |

### C. Loading a Draft (FR-CAN-2/4)

| Id | Steps | Expected |
|---|---|---|
| C1 | **+ Load a canvas**: set `QA3C set`, code `qa3c_4dot_he`, both names; **Read from a file** → `ILT_4DOT_geometry.json`; leave the profile empty; **Load as a Draft** | The canvas opens: `QA3C_4DOT_HE v1`, status **Draft**, "No problems found: this draft can be activated". The preview shows 4 dots per box. The starter profile: A, B, C, D at 3.5 mm and 25% each, none required, 15 pen lifts, fill order empty |
| C2 | Load again with the same code | Refused: "This code already exists" |
| C3 | Load with text that is not JSON (delete a bracket) | "This is not valid JSON"; nothing loaded |
| C4 | Load `ILT_4DOT_geometry.json` into a **Notebook pages** set | Refused: the geometry is of another canvas type than the set |
| C5 | Load `{"canvas_type": "ILT_GRID"}` as the geometry | Refused: "The geometry does not match the canvas schema", with the list of what is missing |
| C6 | Load with code `QA3C_4DOT_B`, geometry `ILT_4DOT_geometry.json` and profile `ILT_4DOT_profile.json` | The profile from the file is used (B and C required, 40% each) |

### D. Editing and checking a Draft (FR-CAN-3/6/7)

| Id | Steps | Expected |
|---|---|---|
| D1 | On `QA3C_4DOT_HE`: change B's weight to 50 | The line under the table turns red: the dot weights total 125%. A bar at the bottom: "Unsaved changes to this draft", **Save draft**, **Discard changes**. **Activate** is disabled until you save or discard |
| D2 | **Save draft** | "Draft saved", then under the actions: "Fix these before activating: The scoring profile is not valid — Dot weights total 125, must total 100" |
| D3 | Set A 10, B 40, C 40, D 10; tick **Required** for B and C; set B and C's radius to 1.3; **Save draft** | "No problems found" |
| D4 | Dot order: type `A B D C`, click elsewhere, save | Saved as A → B → D → C |
| D5 | Fill order: type `0, 1, 2` and save | Problem: the fill order must list every box once. Clear the field and save: no problem (follows the language direction) |
| D6 | Geometry: **Read from a file** → `ILT_4DOT_problems_geometry.json`; the preview updates before saving; **Save draft** | Two problems: larger than the tablet screen at true size (250 mm > 211 mm), and dot D outside its box. The preview also shows the red "Larger than the tablet screen" line |
| D7 | Put `ILT_4DOT_geometry.json` back; save; **Check** | "Checked"; no problems |
| D8 | Change the names in **Names**; **Save** | Saved; the title shows the new name |
| D9 | **Delete draft** on `QA3C_4DOT_B`; confirm | Back to the library; the draft is gone |

### E. Activation with approval (FR-CAN-3, FR-ROLE-3)

| Id | Steps | Expected |
|---|---|---|
| E1 | `QA3C_4DOT_HE` v1: **Activate** | A box explains that new sessions using the code get this version, and asks for the Research Director's email and PIN |
| E2 | Click **Activate** in the box with the fields empty | "Enter the Research Director's email and PIN…"; nothing happens |
| E3 | A wrong PIN | "The director email or PIN is wrong"; still a Draft |
| E4 | The right PIN | "QA3C_4DOT_HE v1 is active"; status **Active**; the profile and geometry are read-only; the only actions are **New version** and **Retire** |
| E5 | In Settings, turn director approval off (with the PIN); load and activate another QA3C draft | Activated without a PIN. Turn approval back on afterwards |

### F. Versions (FR-CAN-3)

| Id | Steps | Expected |
|---|---|---|
| F1 | On the Active v1: **New version** | `QA3C_4DOT_HE v2` opens as a Draft, a copy of v1. Versions: v2 (Draft) · v1 (Active) |
| F2 | Go back to v1 (click **v1** in Versions); **New version** again | "This canvas already has a draft version. Open it?" **OK** opens v2 |
| F3 | On v2, change D's radius to 2.5; save; activate with the PIN | "v2 is active". Versions: v2 (Active) · v1 (Retired). In the library both rows show, v1 greyed |

### G. Domain overrides of the profile (FR-CAN-8)

| Id | Steps | Expected |
|---|---|---|
| G1 | On the Active `QA3C_4DOT_HE`, **Domain overrides**: choose `QA3B_D1` | The profile form opens with the canvas values; a note says changed values are highlighted |
| G2 | Change B's radius to 2.0 | That cell is highlighted |
| G3 | Save with the director's PIN | "Scoring values for … saved". The table lists the Domain with "dots.B.radius_mm 2", who set it and who approved it. The library row shows 1 Domain override |
| G4 | Edit it again, set B's weight to 50 (total 110), save with the PIN | Refused: the canvas has problems (weights must total 100) |
| G5 | **New version** of the canvas, activate it | The new version shows the same `QA3B_D1` override (overrides carry over) |
| G6 | **Follow the canvas profile** for `QA3B_D1`; approve | The override is removed: "No Domain has its own values" |
| G7 | (Optional, with an evaluator) Point `QA3B_D1`'s Hebrew ILT canvas to `QA3C_4DOT_HE` in Settings, give the Domain an override, and create a Day 1 Hebrew session for a participant in `QA3B_D1` | The session's ILT steps use the 4-dot canvas, scored with the Domain's values. Point the setting back afterwards (**Follow System**) |

### H. Retiring

| Id | Steps | Expected |
|---|---|---|
| H1 | Open `ILT_3X5_EN` and **Retire**; confirm | Refused: "A setting still names this canvas. Choose another canvas in Settings first." It stays Active |
| H2 | **Retire** the Active `QA3C_4DOT_HE` (not named in any setting) | Status **Retired**; it can't be changed; **New version** is still offered (to bring it back as a Draft) |
| H3 | Settings → Languages: the canvas lists for Hebrew | `QA3C_4DOT_HE` is offered only while Active |

### I. Languages, right-to-left and themes

| Id | Steps | Expected |
|---|---|---|
| I1 | Switch to **עברית** on the library, a canvas, the load form and the Domain overrides | Every label, button, status, problem and message in Hebrew, right to left. Codes, JSON, sizes ("3×5", "35×25") and dot ids read left to right |
| I2 | Theme Dark, then Light | The preview stays white with black boxes; status pills, highlighted override cells, red totals and problems are readable in both |
| I3 | Narrow the window | Tables scroll sideways; the forms wrap; nothing is cut off |

### J. Action log

Until the log screen in Phase 3e, check it in the database:

```sql
SELECT occurred_at, event_type, entity_id, message, details
  FROM app_events
 WHERE event_type LIKE 'canvas.%' OR (event_type LIKE 'auth.director_pin.%' AND entity_type = 'canvas')
 ORDER BY occurred_at DESC LIMIT 40;
```

| Id | Expected |
|---|---|
| J1 | Rows for each step above: `canvas.set.created/updated`, `canvas.uploaded`, `canvas.updated` (which fields), `canvas.validated` (problem codes), `canvas.activated` (with the retired version and the approver), `canvas.version.created`, `canvas.override.changed` (old and new patch), `canvas.retired`, `canvas.deleted` |
| J2 | Each approval has `auth.director_pin.verified`; each wrong PIN `auth.director_pin.failed`. No PIN appears anywhere |

## 3. After testing

- Point back any setting you changed in G7 and turn director approval back on if you turned it off (E5).
- Tell me the `QA3C` sets and canvases you created, and I'll remove them with their overrides. Canvases that a session used can only be retired, not deleted, so prefer G7 on a test participant I can remove too.

## 4. Known limits in 3c

- **Tablet preview (FR-CAN-6):** the true-size preview on a paired tablet comes with reference mode in Phase 3d. The cockpit preview is true size only on a 96 dpi screen.
- **Background images (FR-CAN-4):** not uploaded yet; a geometry with a `background` is accepted but nothing is drawn.
- **Intervention sheets:** can be loaded, previewed (letters, their dots and model paths) and activated, but sessions don't use letter sets yet.
- **Sample block and Normal speed (FR-CAN-9/10):** recorded on a tablet in Phase 3d. Until then the expected pen lifts, fill order and Normal speed are typed in.
- A canvas is loaded as JSON; there is no drawing editor.
