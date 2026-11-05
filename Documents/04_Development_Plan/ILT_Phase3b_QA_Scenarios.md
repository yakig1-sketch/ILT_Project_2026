# ILT Phase 3b — QA Scenarios: Settings (System, Domain and Region values)

**Build:** Phase 3b, on top of Phase 3a, not yet committed
**Date:** 2026-11-04
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 §3 (FR-ORG-3…7), §5.4 (FR-CAN-12…14), FR-ROLE-3, FR-LANG-5; DDD v1.6 §6, §14

## 1. Before you start

| Item | Value |
|---|---|
| Administrator cockpit | https://10.0.0.14:5174/admin → **Settings** tab |
| Evaluator cockpit | https://10.0.0.14:5174 (in a private window) |
| Accounts | **Dev Admin**; **Dev Evaluator**; a Researcher with a director PIN (for example `qa3a-dir@ilt.local`, PIN `246810`, from the 3a tests, or create one in **Users**) |
| Test Domain and Region | Create `QA3B_D1` (Domains tab) and `QA3B_R1` (Regions tab) and use them for the Domain and Region scenarios, so the real ones are not changed |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 3 QA Take#N* with the scenario id.

**How the screen works:**

- Pick a **level** (System, Domain or Region). For a Domain or Region, also pick which one.
- Each row shows a setting: its description, its key, the default and the allowed range.
- Changes are collected and highlighted. A bar at the bottom counts them; **Review and save** shows them all before saving, and saves them together.
- Settings marked **Needs a Research Director PIN** ask for the director's email and PIN when you save.

**Watch out:** System values apply to every new session. Note what you change and put it back afterwards (§3).

## 2. Scenarios

### A. The screen

| Id | Steps | Expected |
|---|---|---|
| A1 | Settings tab | Level **System**. Four groups: Scoring, ILT process, Languages (Enabled languages, then Hebrew, then English), and Governance, privacy, device and log. Each row has an editable value |
| A2 | Hover over a setting's description | A tooltip shows the default and, for numbers, the allowed range (FR-ORG-7) |
| A3 | Level **Domain** | The Domain list appears. Only Scoring and Languages are shown. A row with no value of its own says "Follows default: …" or "Follows System: …" and has **Set own value** |
| A4 | Level **Region** | Only ILT process settings are shown (timers, cue, lock, margin, warm-up, video, templates) |
| A5 | Make a change, then click another level | You are asked whether to discard the changes; **Cancel** keeps you where you were |

### B. Editing and saving at System level

| Id | Steps | Expected |
|---|---|---|
| B1 | Change **Inactivity cue type** to Sound | The row is highlighted with **Undo** and **Back to default**; the bottom bar says "1 unsaved change" |
| B2 | **Undo** | The change goes; the bar disappears |
| B3 | Change it again; **Review and save** | A table shows the setting, before ("Visual (follows the inherited value)") and after ("Sound"). Not governed, so no director fields. **Save** → "1 change saved" |
| B4 | **Back to default** on that row; **Review and save**; **Save** | Saved; the row is back to Visual with no own value |
| B5 | Change two settings, then **Discard changes** | Both go back; nothing saved |
| B6 | Type a value outside the range (for example pen-lift gap 5 ms); **Review and save**; **Save** (with the PIN) | Back on the list, the row shows "Outside the allowed range" in red, with "Some values are not allowed" above; nothing is saved |

### C. Director approval (FR-ROLE-3)

| Id | Steps | Expected |
|---|---|---|
| C1 | Change **Inactivity before the cue** (a timer); **Review and save** | The review says a Research Director approves the change and shows **Research Director email** and **Director PIN** |
| C2 | Enter the director's email and a wrong PIN; **Save** | "The director email or PIN is wrong"; nothing saved |
| C3 | Enter the right PIN; **Save** | Saved |
| C4 | Change one governed and one ungoverned setting together | One approval covers both; both are saved |
| C5 | Turn **Clinical changes need the research director PIN** off; **Review and save** | Director email and PIN are asked even though the switch is not governed: turning approval off always needs a director. Turn it back on afterwards |
| C6 | With the switch off, change a timer | Saved without a PIN. Turn the switch back on |

### D. Composite weights

| Id | Steps | Expected |
|---|---|---|
| D1 | Scoring: change the speed weight from 50 to 60 | The line above the group turns red: "The three weights total 110% (they must total 100%)" |
| D2 | Try to save it like that (with the PIN) | Refused: "The three composite weights must total 100%" |
| D3 | Change accuracy to 20 and pen lifts to 20; save with the PIN | The total is 100%; saved. Put the weights back to 50 / 25 / 25 afterwards |

### E. Domain overrides (FR-ORG-3/4)

| Id | Steps | Expected |
|---|---|---|
| E1 | Level Domain, `QA3B_D1`. **Set own value** on the pass threshold; type 70; save with the PIN | The row shows 70, with "Without its own value: … (System or default)" under it |
| E2 | Level System | The System threshold is unchanged; the Domain value applies only to `QA3B_D1` |
| E3 | In the private window, as Dev Evaluator, open the **Comparative summary** of a participant in `QA3B_D1` (create one if needed) | Pass/Fail uses 70 |
| E4 | Domain `QA3B_D1`: **Follow System** (or **Follow default**) on the threshold; save with the PIN | The row says "Follows …" again; the summary in E3 follows the System value |
| E5 | Domain weights 60 / 20 / 20 (all three set as own values); save with the PIN | Saved; the other Domains are not affected |

### F. Region overrides (FR-ORG-5)

| Id | Steps | Expected |
|---|---|---|
| F1 | Level Region, `QA3B_R1`. **Set own value** on **Warm-up block** → Off; save | Saved, no PIN asked (not governed) |
| F2 | As Dev Evaluator, create a Day 1 session for a participant whose Region is `QA3B_R1` | The session has no warm-up block. A participant in another Region still gets the warm-up |
| F3 | Region `QA3B_R1`: **Set own value** on **Transition countdown before a block** → 10 s; save with the PIN | Saved. A new session in that Region counts down 10 s before a block |
| F4 | Change a Region value while a session in that Region is open | The open session keeps the values it started with; only new sessions use the new value (FR-ORG-6) |

### G. Language configuration (FR-CAN-12…14, FR-LANG-5)

| Id | Steps | Expected |
|---|---|---|
| G1 | Level Domain, `QA3B_D1`. **Enabled languages**: **Set own value**; untick Hebrew; save | Refused: "The default language must be one of the enabled languages" |
| G2 | Also set **Default language** to English; save | Saved |
| G3 | As Dev Evaluator: **New session**, choose a participant in `QA3B_D1` | The session language list offers only English, already selected. A participant in another Domain still gets Hebrew and English, with Hebrew selected |
| G4 | Domain `QA3B_D1`: English **Box fill direction** → Right to left | A yellow note: "The ILT canvas ILT_3X5_EN has a recorded fill order that differs from this fill direction. Sessions use the recorded order." Choose Left to right again: the note goes |
| G5 | English **Mirror the block's dot pattern** → On; save; create an English session for a participant in `QA3B_D1` | The block's dot pattern on the tablet is mirrored (">" becomes "<") |
| G6 | The canvas choices for **ILT block canvas for English** | Only active English ILT canvases are offered |
| G7 | Put the Domain's language settings back (**Follow System** on each); save | The Domain follows the System languages again |

### H. History

| Id | Steps | Expected |
|---|---|---|
| H1 | Level System, **History** | Every change from these scenarios at System level, newest first: when, setting, before, after, changed by, approved by (for approved changes) and the reason |
| H2 | Pick one setting in the **Setting** list | Only that setting's changes |
| H3 | Level Domain `QA3B_D1`, **History** | Only that Domain's changes. A value that went back to following the System shows "(follows the inherited value)" in **After** |
| H4 | Give a reason in the review before saving | The reason shows in the history |

### I. Languages, right-to-left and themes

| Id | Steps | Expected |
|---|---|---|
| I1 | Switch to **עברית** | Every label, button, choice and message is in Hebrew, right to left. Setting keys, canvas codes and units read left to right |
| I2 | Theme Dark, then Light | Highlighted rows, the red total, the yellow note, the director badge and the bottom bar are readable in both |
| I3 | Narrow the window | The rows wrap; nothing is cut off; the bottom bar stays visible while you scroll |

### J. Action log

Until the log screen in Phase 3e, check it in the database:

```sql
SELECT occurred_at, event_type, entity_id, message, details
  FROM app_events
 WHERE event_type LIKE 'settings.%' OR event_type LIKE 'auth.director_pin.%'
 ORDER BY occurred_at DESC LIMIT 30;
```

| Id | Expected |
|---|---|
| J1 | Each saved change at System level has a `settings.value.changed` row, or `settings.value.removed` when it went back to the default |
| J2 | Each Domain or Region change has a `settings.override.changed` row with the Domain or Region id, the old and new value and `removed` when it went back to following |
| J3 | Each approval has `auth.director_pin.verified`; each wrong PIN `auth.director_pin.failed` (severity SECURITY). No PIN appears anywhere |

## 3. After testing

- Put back every System value you changed: the History at System level lists them. **Back to default** returns a setting to its built-in value.
- Tell me the `QA3B` Domains and Regions and test participants you created, and I'll remove them with their settings.

## 4. Known limits in 3b

- Values are checked when you save. Only the weights total and the fill-direction note are shown while you edit.
- Instruction videos, protocol template editing and recomputing scores with new settings are not part of this phase.
- Language names and the list of languages come from the database; adding a third language still needs its translation file and canvases (FR-LANG-2).
- The history shows the latest 200 changes for the chosen level or setting.
