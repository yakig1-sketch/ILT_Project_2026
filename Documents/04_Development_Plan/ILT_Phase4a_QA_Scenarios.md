# ILT — QA Scenarios: Phase 4a, Analyst portal

**Build:** on top of commit `86a11c9`, not yet committed
**Date:** 2026-11-08
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-AN-1, FR-AN-3, FR-REP-4, §2 roles; DDD v1.6 §9 (research views), §14

Phase 4 (research portal and analytics) is built in four parts: **4a** the analyst portal (this document), **4b** pen-movement (kinematic) views, **4c** Parquet and CSV exports, **4d** import of the old application's data and paper-cohort entry.

## 1. Before you start

| Item | Value |
|---|---|
| Analyst portal | **https://10.0.0.17:5175** (the PC's address changed from 10.0.0.14 on Nov 10; accept the self-signed certificate once more) |
| Evaluator cockpit | https://10.0.0.17:5174 |
| Accounts | `dev-analyst@ilt.local` (Analyst) and a Researcher account such as `yakig@wondernet.co.il`; also an Evaluator, to check the refusal |
| Database | Migration `0005_research_portal` is already applied on the dev machine |
| Test data | One research session prepared for this QA: **S261108-QA4A**, participant **QA4A-01** (Grade 1, Female, SES Middle, right hand, Domain General, no Region), a copy of the pen data of session S261102-EJX5, under a Research approval "QA 4a". Tell me when you are done and I'll remove it |

Note: `dev-director@ilt.local` currently has the Analyst role (changed during an earlier QA), so it can also sign in to the portal.

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 4a QA Take#N* with the scenario id.

## 2. Scenarios

### A. Sign-in

| Id | Steps | Expected |
|---|---|---|
| A1 | Open the portal | Title "Analyst portal", the ILT sign-in card, theme and language switches |
| A2 | Sign in as an Evaluator | Refused: "The analyst portal is for analysts and researchers…" |
| A3 | Sign in as `dev-analyst@ilt.local` | The research screen; your name and role at the top |
| A4 | Sign out, then sign in as a Researcher | Also allowed |

### B. Research sessions and filters (FR-AN-1, FR-AN-3)

| Id | Steps | Expected |
|---|---|---|
| B1 | Look at the top of the screen | The note that only completed Research sessions with research consent are shown, by study code and a short school code. **Filters**: "Research sessions: 1 · participants: 1" |
| B2 | **Research sessions** table | One row: S261108-QA4A, QA4A-01, Day 1, Hebrew, Grade 1, Female, Middle, Right, General, Region "Not recorded", a school code, today, **8** blocks |
| B3 | Filters one at a time: Gender **Male**; then **Female** | Male: "0 sessions" and "No research session matches these filters."; Female: the session again |
| B4 | Try Grade, SES (including "Not recorded"), Language, Session stage, Canvas (ILT_3X5_HE), Inactivity timer (20 s), the school code, and a date range that includes and excludes today | Each narrows the list and the cohort table as expected |
| B5 | **Clear filters** | All filters back to "All"; the button is disabled when nothing is set |
| B6 | Open the session, come back with **← Research sessions** | The filters you set are kept |
| B7 | *(Take#2)* **Region**: choose **Not recorded** | The session again (it has no Region); a named Region shows "0 sessions" |
| B8 | *(Take#2)* Read the count next to **Filters** | "All research sessions: 1 · participants: 1": the total, which does not follow the filters (the list and cohort table do) |

### C. Cohort table

| Id | Steps | Expected |
|---|---|---|
| C1 | **Group by: No grouping** | One row "All selected sessions": 1 participant, 1 session, 8 blocks, accuracy about 78.9, ILT speed about 51.35, pen lifts 15.50, time about 18.7 s. Composite and speed score show "—" (the copied session was scored before those weights were set) |
| C2 | Group by Grade, Gender, SES, Canvas, Inactivity timer, Domain, Region | One row each, labelled in the interface language (for example "Grade 1", "20 s", "Not recorded" for the Region) |
| C3 | Read the note under **Cohort** | "Means over the counted blocks: the latest finished attempt of each scored ILT block. The warm-up and the notebook pages do not count." |
| C4 | *(Take#2)* English interface: the **Language** column, the session details and **Group by: Language** | "Hebrew" (in Hebrew: "עברית"). The same in the cockpit's session list, session page and Dispatch Console; the interface-language switch still shows each language in its own name |

### D. One session

| Id | Steps | Expected |
|---|---|---|
| D1 | Click **S261108-QA4A** | The address ends with `#/session/…`. Title: session code · QA4A-01 · Day 1. **Session details**: language, age (6 y 7 m), grade, gender, SES, hand, Domain, Region, school code, device, started, completed |
| D2 | **Settings used** | Inactivity timer 20 s, last box 30 s, pass threshold, and the composite weights |
| D3 | **Blocks and attempts** | The warm-up, ILT blocks 1–8 and notebook pages 1–4, each with its canvas, attempt, status and samples. ILT blocks are marked **Counted**; the warm-up and notebook pages are not and are greyed |
| D4 | Nothing identifying | No name, school name, birth date or national ID anywhere; only the study code and the short school code |

### E. Replay (FR-REP-4)

| Id | Steps | Expected |
|---|---|---|
| E1 | **Replay** on ILT block 1 | The cockpit's replay: the page as written, the speed under each house, play/pause, timeline, speed 0.25×–4×, sample steps |
| E2 | **Back** | Back to the session |
| E3 | (Admin) **Action log**, type *Replay opened* | "Research replay opened: S261108-QA4A step 2, attempt 1", with `"portal": "analyst"` in the details; **one row per opening** (Take#2) |
| E4 | *(Take#2)* Open a replay in the cockpit, then check the Action log | One "Replay opened" row per opening there too |

### F. What analysts cannot see

| Id | Steps | Expected |
|---|---|---|
| F1 | In the cockpit, look at the participant record of QA4A-01 → **Record consent** with **Research use** unticked. Back in the portal's tab (Take#2: no reload needed; the list refreshes when you return to the tab) | The session disappears ("Research sessions: 0"), with the note that there are no research sessions yet. Record a new consent **with** research use to bring it back |
| F2 | Any Intervention session (for example YG1102's) | Never appears in the portal |

### G. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| G1 | Hebrew and English | All texts translated; the back arrow points to the start of the line (→ in Hebrew) |
| G2 | Dark and Light | Filters, tables and pills readable; the Domain and Region boxes keep their arrow |

## 3. Notes

- The portal reads through the gateway; every research query runs under the database's analyst role, which can read only the research views, so even a mistake in the portal code could not reach names, schools or Intervention sessions.
- A participant's sessions follow their **current** consent: withdrawing research use hides all their sessions from the portal at once.
- Only **completed** sessions appear; a research session that is still planned or running does not.

## 4. Results

### Take#1 (2026-11-10)

All scenarios ran: A, B, D, E1–E2, F and G passed; C1–C2 passed; C3 partial; E3 passed with a finding.

| Finding | Fix |
|---|---|
| E3: each replay opening was logged twice, in the same second | In development the browser asks for the replay twice (React's strict mode). The gateway now logs a replay opening once per user and attempt within 10 seconds, in the portal and in the cockpit. Test added |
| Region filter had no "Not recorded" option | Added (as for SES); the filter can also combine it with named Regions. Test added |
| C3: the cohort note did not say the warm-up and notebook pages don't count | The note now says so |
| The language showed as "עברית" in the English interface | Session language now shows in the interface language ("Hebrew" / "English") in the portal and in the cockpit's session list, session page and Dispatch Console. The interface-language switch keeps each language's own name |
| Minor: the Filters count does not follow the filters | Intended as the total; now reads "All research sessions: N · participants: N" |
| Minor: after withdrawing consent, the open list kept the session until a reload | The portal now refreshes the list when you return to its tab |

Re-test in Take#2: B7, B8, C3, C4, E3, E4 and F1.

### Take#2 (2026-11-10)

All seven retests passed: B7, B8, C3, C4, E3, E4 and F1.

- **E3 and E4:** each replay opening now gives one log row, in the portal and in the cockpit.
- **F1:** the open portal list went from 1 to 0 sessions and back with no reload. The tester triggered the return to the tab from the page's code, because Chrome on the test machine would not switch tabs during the run.

**Cleanup done after Take#2:**
- Session S261108-QA4A with its blocks and pen data;
- participant QA4A-01 and the four QA4A consent records;
- the "QA 4a" research approval;
- the session's eight "Replay opened" log rows and the four consent log rows.
