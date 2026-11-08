# ILT — QA Scenarios: Phase 3f, Participants and consent

**Build:** on top of commit `8b80f5e` with Phases 3d and 3e, not yet committed
**Date:** 2026-11-07
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-PART-1…4, FR-PLAN-1, FR-PRIV-1/2, FR-LOG-1; DDD v1.6 §12, §14

## 1. Before you start

| Item | Value |
|---|---|
| Evaluator cockpit | https://10.0.0.14:5174 (an Evaluator or Researcher account) |
| Administrator cockpit | https://10.0.0.14:5174/admin → new **Ethics approvals** tab (before Action log) |
| Accounts | An Evaluator or Researcher; the System Administrator; a Research Director (email and PIN) if Settings asks for approval in D |
| Database | Migration `0004_participants_consent` is already applied on the dev machine |

**Use a test participant** (for example `QA3F-01`), not `YG1102`: consent records are kept by design and cannot be removed from the cockpit. Tell me afterwards and I'll remove the participant and its records directly in the database.

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 3f QA Take#N* with the scenario id.

## 2. Scenarios

### A. New participant

| Id | Steps | Expected |
|---|---|---|
| A1 | **Sessions** → **+ New participant** | A new field, **Socio-economic group** (—, Low, Middle, High), between Gender and Dominant hand |
| A2 | Create `QA3F-01` with a school name and SES Middle | Created and chosen in the participant field |
| A3 | Create `qa3f-01` (same code, small letters) | "This participant code already exists" |

### B. Participant record

| Id | Steps | Expected |
|---|---|---|
| B1 | **Sessions** → choose `QA3F-01` → **Participant record** (next to the participant field). Also from a Dispatch Console: **Participant record** at the top | The address ends with `/record`. Details: Domain, Region, School "Kept as a protected code", Birth month, Grade, Gender, SES group, Dominant hand; the number of sessions; created / last changed |
| B2 | **Edit** → change the grade and type a new school name → **Save** | "Saved"; the new grade shows. The school still reads "Kept as a protected code" (the name is never shown) |
| B3 | **Edit** → **Save** without changing anything | "Nothing changed" |
| B4 | In **Edit**, look at the participant code | Greyed out: the code cannot change |
| B5 | **Action log** (admin) → free text `QA3F-01` | *Participant updated* with the old and new grade; the school appears only as `"school": "changed"`, never its name |
| B6 | **← Dispatch Console** | Back to the console |

### C. Consent (FR-PART-4)

| Id | Steps | Expected |
|---|---|---|
| C1 | A participant with no consent | "No consent recorded. The most private defaults apply: …"; the button **Record consent** |
| C2 | **Record consent** | Version, Signed on (today), and three boxes **all unticked**: Hand video, Research use, Open-science sharing |
| C3 | A date in the future | The date field does not accept it (the gateway refuses it too) |
| C4 | Version `2026-A`, tick **Research use** → **Record consent** | "Consent recorded"; the card shows the version, the date and Yes/No for each permission |
| C5 | **Record a new consent** | The version is filled in from the current one; the boxes start unticked again |
| C6 | Record it with only **Hand video** ticked, then open **Consent history** | Two rows, newest first: the new one **Current**, the first "Replaced *time*", each with who recorded it |
| C7 | **Action log** → *Consent recorded* | The details show the old and new version and permissions |

### D. Research sessions (FR-PLAN-1)

| Id | Steps | Expected |
|---|---|---|
| D1 | **Sessions** → choose `QA3F-01` | **Purpose**: Intervention (default); Research is greyed out, with the reason under the form: "Research sessions are turned off in the system settings." The record says the same under **Research sessions** |
| D2 | Admin → **Ethics approvals** | The two seeded approvals (Intervention programme, Previous IRB), **Valid now**; above them "Research sessions are turned off in Settings" |
| D3 | **+ Add an approval** with Valid from after Valid until | "Valid from must not be after Valid until"; **Save** disabled |
| D4 | Add a **Research** approval, authority "QA IRB", valid from today | "The approval was recorded"; **Valid now** |
| D5 | Admin → **Settings** → turn on **Allow research sessions** (director PIN if asked) | Saved. Ethics approvals now says "Research sessions are turned on in Settings" |
| D6 | Back in Sessions, choose `QA3F-01` again (its current consent has no research use after C6) | Research still greyed out: "The participant's consent does not allow research use." |
| D7 | Record a new consent with **Research use** ticked, then choose the participant again in Sessions | **Research** can be chosen; create a Day 1 session with it |
| D8 | Ethics approvals | The Research approval shows "Used by 1 session" |
| D9 | **Withdraw** it (confirm) | **Withdrawn**, kept in the list with **Restore**; Research is greyed out again for new sessions: "There is no research ethics approval valid today." |
| D10 | Put things back: **Restore** or leave withdrawn, and turn **Allow research sessions** off again | As you prefer; tell me what to remove |

### E. Hand video (FR-PRIV-2)

| Id | Steps | Expected |
|---|---|---|
| E1 | Participant record with the setting off | "Hand video: turned off in the settings." |
| E2 | (Optional) Turn on **Hand video recording** in Settings | "Hand video: allowed by the settings, but not by consent", or "… and by consent" when the current consent allows hand video. Turn it off again afterwards |

### F. Deactivation

| Id | Steps | Expected |
|---|---|---|
| F1 | Participant record → **Deactivate** → confirm | **Deactivated**, with "Deactivated: not offered for new sessions. Results are kept." **Edit** and **Record consent** disappear; **Reactivate** appears |
| F2 | Sessions → **+ New session** → search for the code in the participant field | Not found. (The Sessions list still shows the participant's existing sessions: results are kept.) |
| F3 | Its Dispatch Console and Comparative summary | Still open, with their results |
| F4 | **Reactivate** | Back to normal; found in the search again |

### G. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| G1 | Hebrew, then English, on the record and on Ethics approvals | All new texts translated; a notice ("Saved") follows the language switch |
| G2 | Dark, then Light | Cards, tags and the history table stay readable |

## 3. Notes

- Consent records and ethics approvals are kept by design: the application has no way to delete them (FR-PART-4, audit). Test data is removed directly in the database on request.
- A session's purpose is fixed when it is created; changing consent later does not change past sessions.
- Analysts will see only RESEARCH sessions of participants with research consent (FR-AN-3); the analyst portal comes in a later phase.

## 4. Results

### Take#1 (2026-11-08)

| Id | Result | Notes |
|---|---|---|
| A1–A3 | Pass | |
| B1–B4, B6 | Pass | |
| B5 | Fail → fixed | Free text with a hyphen (`QA3F-01`) found nothing. The log's search index stores `QA3F-01` as `qa3f` and the signed number `-01`; the search now splits the text with the same parser, so `QA3F-01`, `qa3f-01` and `Participant QA3F-01` find the entries. Covered by a gateway test |
| C1–C7 | Pass | The gateway's own refusal of a future date (C3) was not tried in the browser; it is covered by a gateway test |
| D1–D9 | Pass | No director PIN was asked for the research setting |
| D10 | Done | |
| E1–E2 | Pass | |
| F1–F4 | Pass | F2 reworded: the participant picker hides a deactivated participant; their existing sessions stay in the Sessions list by design |
| G1–G2 | Pass | |

Findings fixed after Take#1:

- **B5:** hyphenated free-text search, as above.
- **Session purpose:** the live session screen now shows a **Research** or **Intervention** tag next to the status, and the Sessions list shows "Day 1 · Research" for a research session.
- **Back arrows in Hebrew:** "← Sessions", "← Dispatch Console" and "← Canvases" now point right (→) in Hebrew.
- **Hebrew wording** on Ethics approvals: "…שההגדרה "אפשר מפגשי מחקר" תהיה מופעלת…".

Cleanup done: participant `QA3F-01` with its 3 consent records and session `S261108-F9GE`, and the "QA IRB" approval. `QA3F-UI` had already been removed; it shows only in the action log, which keeps every entry.

For Take#2: B5 (search `QA3F-01` after creating it again), the purpose tag on a session's live screen and in the Sessions list, and the back arrows in Hebrew.

### Take#2 (2026-11-08)

| Check | Result | Notes |
|---|---|---|
| B5: log search | Pass | `QA3F-01`, `qa3f-01` and `Participant QA3F-01` each find the new *Participant created* entry |
| Purpose tag: Intervention | Pass | The live screen of an Intervention session shows **Intervention** next to the status |
| Purpose tag: Research | Pass | D4, D5 and D7 repeated; the research session shows **Research**, and the Sessions list reads "Day 1 · Research" (an Intervention session shows just "Day 1") |
| Back arrows in Hebrew | Pass | "→ מפגשים", "→ מסוף הבקרה", "→ ספריית הקנבסים"; English keeps "←". Checked from the page code |

Also confirmed: the canvas editor's address is `#/canvases/<id>` (Phase 3d finding).

Cleanup done: participant `QA3F-01` with its consent record and sessions `S261108-V3DG` and `S261108-DMZU`, the "QA IRB" approval, and the two Take#2 history rows of **Allow research sessions**. Action log entries stay by design: the log is an append-only audit trail.

Phase 3f QA is complete.
