# ILT — QA Scenarios: Phase 3e, Action log search and CSV export

**Build:** on top of commit `8b80f5e` with Phase 3d, not yet committed
**Date:** 2026-11-07
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-LOG-1…4; DDD v1.6 §12, §14

## 1. Before you start

| Item | Value |
|---|---|
| Administrator cockpit | https://10.0.0.14:5174/admin → new **Action log** tab (after Settings) |
| Evaluator cockpit | https://10.0.0.14:5174, for B and the non-admin check |
| Accounts | The System Administrator; an Evaluator or Researcher account |
| A spreadsheet | Excel (or LibreOffice) for the CSV checks in E |

The log already holds every action since Phase 1 (about 1,500 entries in the last 7 days on the dev machine). Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 3e QA Take#N* with the scenario id.

## 2. Scenarios

### A. The screen

| Id | Steps | Expected |
|---|---|---|
| A1 | Open **Action log** | The address is `#/log`. Filters at the top. The table shows the newest entries first, with the count ("*n* entries"). **From** is 7 days ago |
| A2 | Look at a row | Time (to the second), severity tag, the event's name with its code under it (`auth.login.succeeded`), user with role, session code, Domain · Region, message |
| A3 | Click a row, then click it again | The details open under the row (event type, user email, record, device, address, and the details as JSON), then close |
| A4 | Scroll to the end, **Show more** | The next 100 entries are added below, with no repeats. Rows with the same time and text can be separate entries |
| A5 | Refresh the page | Still on **Action log** |
| A6 | Sign in to the evaluator cockpit as an Evaluator and open `/api/v1/log/events` in the browser | Refused (401 or 403). The log is for the System Administrator only |

### B. Filters

| Id | Steps | Expected |
|---|---|---|
| B1 | **Event types** → under *Sign-in and security* tick **Whole area** → **Search** | The button reads "6 event types"; only sign-in events are listed |
| B2 | Open **Event types**, tick a single type, then click outside the panel | The panel closes; the button shows that type's name |
| B3 | **Severity**: tick only **Security** → **Search** | Only failed sign-ins, director-PIN failures and user changes |
| B4 | **User**: pick yourself → **Search** | Only your actions |
| B5 | **Session code**: type a code from the Sessions list (small letters are fine) → **Search** | Only that session's events: pairing, steps, blocks, replays |
| B6 | **Domain**: GENERAL → **Search** | Entries with GENERAL in the Domain column |
| B7 | **Free text**: the start of a session code (for example `S2611`), or a word from a message (`QA3A`) → **Search** | Entries that contain it, in the message or the details |
| B8 | **Last 24 hours** / **Any time** links, then **Search** | **From** changes; the count follows |
| B9 | Set **To** before **From** | "From must be before To"; **Search** is disabled |
| B10 | A filter that matches nothing | "No entries match the filter"; **Export to CSV** is disabled |
| B11 | **Clear filters** | Back to the last 7 days, everything else empty |

### C. Do the actions you take appear?

| Id | Steps | Expected |
|---|---|---|
| C1 | Sign out and sign in again, change a setting, then open the log (Last 24 hours) | *Signed out*, *Signed in*, *Setting changed* (with old and new values in the details) appear at the top |
| C2 | Sign in with a wrong password, then look | *Sign-in failed* with **Security** severity and the email tried in the details |

### D. Append-only (FR-LOG-4)

| Id | Steps | Expected |
|---|---|---|
| D1 | Look for any way to edit or delete an entry | There is none |

### E. CSV export

| Id | Steps | Expected |
|---|---|---|
| E1 | Filter (for example one session) → **Export to CSV** | A file `ilt_action_log_<date time>.csv` downloads; "*n* rows exported", the same *n* as the count |
| E2 | Open it in Excel | Hebrew text (Domain names, details) reads correctly; one row per entry, newest first; times are UTC (`…Z`) |
| E3 | Check the columns | occurred_at, severity, event_type, user_email, user_name, role, device_id, domain, region, session_code, entity_type, entity_id, client_ip, message, details |
| E4 | Look at the log after exporting | *Data exported* with "Action log exported to CSV: *n* rows" and the filter in the details |
| E5 | Export with **Any time** and no other filter | All entries (up to 50,000; more than that shows "Only the first 50,000 rows were exported") |

### F. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| F1 | Hebrew, then English | Every label, severity and event name translated; codes, emails and messages read left to right in Hebrew |
| F2 | Dark, then Light | Tags, the type panel and the details stay readable |

## 3. Notes

- Messages are in English by design (DDD §12): the screen translates the event name, not the message.
- Exports of the action log are logged too, so each export adds one entry.
- Test runs leave log entries (for example sign-ins of throwaway accounts that were deleted afterwards: their user shows as "—"). The log is append-only, so these stay.
