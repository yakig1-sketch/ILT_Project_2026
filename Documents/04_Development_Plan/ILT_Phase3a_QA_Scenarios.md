# ILT Phase 3a — QA Scenarios: Administration (users, Domains, Regions)

**Build:** Phase 3a, on top of commit `5713c89`, not yet committed
**Date:** 2026-11-03, revised 2026-11-04 after Phase 3 QA Take#1 (separate Administrator cockpit, Deactivate in the list, Status in Edit, Settings tab)
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 §2 (FR-ROLE-1…3), §3 (FR-ORG-1/2), §13 (FR-LOG-1/2); DDD v1.6 §12, §14

## 1. Before you start

| Item | Value |
|---|---|
| Administrator cockpit | https://10.0.0.14:5174/admin (LAN), System Administrator only |
| Evaluator cockpit | https://10.0.0.14:5174 (LAN), every other role |
| Accounts | **Dev Admin** (System Administrator), **Dev Evaluator**, **Dev Research Director**. Use their usual development passwords |
| Second browser | A private (incognito) window, to sign in as a second user while staying signed in as the administrator |
| Test names | Start every test user, Domain and Region with `QA3A` so they are easy to find and remove afterwards (for example `qa3a-eval@ilt.local`, Domain code `QA3A_D1`) |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**. Report failures as *Phase 3 QA Take#N*, quoting the scenario id (for example "C3 fails: …").

Passwords made with **Generate** are shown only in the form. Copy one before you press **Create** if you will sign in with it.

## 2. Scenarios

### A. Access and navigation (FR-ROLE-1/2)

| Id | Steps | Expected |
|---|---|---|
| A1 | Open the **Administrator cockpit** address | The card says **Administrator sign-in**; the top bar and the browser tab say "ILT Research System · Administrator cockpit" |
| A2 | Sign in as **Dev Admin** | The Administration card opens on the **Users** tab, with the tabs Users, Domains, Regions and Settings. There is no **Sessions** link. The address ends with `/admin#/users` |
| A3 | Click **Domains**, **Regions**, **Settings**, then **Users** | Each tab opens and the address follows (`#/domains`, `#/regions`, `#/settings`, `#/users`). Browser Back returns to the previous tab |
| A4 | Sign out. Open the **Evaluator cockpit** address and sign in as **Dev Admin** | Refused: "The System Administrator signs in at the administration address: https://10.0.0.14:5174/admin". You stay on the sign-in card |
| A5 | In the private window, open the **Administrator cockpit** address and sign in as **Dev Evaluator** | Refused: "This address is for the System Administrator. Other users sign in at the evaluator cockpit: https://10.0.0.14:5174/" |
| A6 | In the private window, sign in as **Dev Evaluator** at the **Evaluator cockpit** | The session list shows as before; the card says **Evaluator sign-in**; there is no Administration link |

### B. User list

| Id | Steps | Expected |
|---|---|---|
| B1 | Users tab, default filters | Active users only, with name, email, role, Domain, Region and status. Your own row says "(you)". Dev Research Director has a green **Research Director** badge |
| B2 | Type part of a name, then part of an email, in **Search** (try different case) | The list narrows as you type, ignoring case |
| B3 | **Role** = Evaluator | Only Evaluators |
| B4 | **Status** = Inactive, then All | Inactive users only (greyed), then everyone |
| B5 | Search for text that matches nobody | "No user matches the filters" |

### C. Create a user (FR-ROLE-1)

| Id | Steps | Expected |
|---|---|---|
| C1 | **+ New user** | A form opens with role Evaluator, interface language Hebrew, Domain General, and a 16-character generated password. A note says to give the password to the user in person |
| C2 | Press **Generate** twice | A new password each time |
| C3 | Fill name `QA3A Evaluator`, email `qa3a-eval@ilt.local`, Region any; copy the password; **Create** | Green notice "User qa3a-eval@ilt.local created"; the form closes; the user is in the list as Evaluator, Active |
| C4 | Switch the private window to English, then sign in as `qa3a-eval@ilt.local` with the copied password | Signs in; the interface switches to Hebrew, the user's interface language (FR-LANG-4); no Administration link |
| C4b | Edit QA3A Evaluator: interface language **English**; sign out and in again in the private window | The interface opens in English. The language switcher still changes it for the current visit |
| C5 | Create another user with the same email in capitals (`QA3A-EVAL@ILT.LOCAL`) | Refused: "A user with this email already exists" |
| C6 | Type a password shorter than 12 characters and **Create** | The browser refuses the form (at least 12 characters) |
| C7 | Choose role **Researcher** | A **Research Director PIN** field appears (6 digits; letters can't be typed). Choose Evaluator again: the field disappears |
| C8 | Create `qa3a-dir@ilt.local` as Researcher with PIN `246810` | Created; the row has the **Research Director** badge |
| C9 | **Cancel** in an open form | The form closes; nothing is saved |

### D. Edit a user: roles and the director PIN (FR-ROLE-3)

| Id | Steps | Expected |
|---|---|---|
| D1 | **Edit** on QA3A Evaluator | The form shows the current values; the email can't be changed; the password field says it stays unchanged if left empty |
| D2 | Change the name and the Region; **Save** | Notice "Changes to … saved"; the list shows the new values |
| D3 | Change the role to **Researcher**, enter PIN `135792`, **Save** | Role Researcher with the **Research Director** badge |
| D4 | Edit again; leave the PIN empty; **Save** | The badge stays (PIN unchanged) |
| D5 | Edit; tick **Remove the Research Director PIN**; **Save** | The badge disappears; role still Researcher |
| D6 | Give the PIN again; then change the role to **Evaluator** | Before saving, a note says the PIN will be removed. After **Save**: Evaluator, no badge |
| D7 | Role change reaches a signed-in user: keep QA3A Evaluator signed in (private window), change their role to Analyst, wait 15 minutes and use the cockpit there | After the next automatic renewal (at most 15 minutes) the new role applies. A user changed to System Administrator is signed out of the evaluator cockpit instead. (Optional: long wait) |
| D8 | Approve with a PIN: in the Administrator cockpit, **Settings** tab, level **System**, change the **pass threshold**, **Review and save**, approve with `qa3a-dir@ilt.local` and PIN `246810`; then again with a wrong PIN | The right PIN is accepted; the wrong one is refused. As Dev Evaluator, a participant's **Comparative summary** shows Pass/Fail by the new threshold. Put the threshold back as it was (**Back to default** if it was not configured). Phase 3b scenarios cover the Settings screen in full |

### E. Locked account and unlock

| Id | Steps | Expected |
|---|---|---|
| E1 | In the private window, sign in as QA3A Evaluator with a wrong password 5 times, then once more with the right password | Tries 1–5 say "Wrong email or password". The 6th, even with the right password, says the account is locked for 15 minutes |
| E2 | As admin, refresh the Users tab | QA3A Evaluator shows an amber **Locked** status |
| E3 | Edit the user; **Unlock** | Status back to Active; the user signs in with the right password straight away |

### F. Password reset

| Id | Steps | Expected |
|---|---|---|
| F1 | Edit QA3A Evaluator; **Generate** a new password; copy it; **Save** | Saved |
| F2 | Sign in with the old password, then with the new one | Old: "Wrong email or password". New: signs in |
| F3 | Lock the account again (E1), then reset the password (F1) | The reset also unlocks: the new password works at once |

### G. Deactivate and reactivate

| Id | Steps | Expected |
|---|---|---|
| G1 | **Deactivate** on QA3A Evaluator's row in the list; confirm | Notice "Changes to … saved"; the user moves out of the Active list. Under Status Inactive it is shown greyed with an **Inactive** pill and a **Reactivate** button |
| G2 | Sign in as that user | "Wrong email or password" |
| G3 | If the user was still signed in in the private window, keep working there for 15 minutes | Within 15 minutes they are signed out (their sign-in can't be renewed) |
| G4 | Status = Inactive; **Reactivate** on the row | Active again; can sign in |
| G5 | **Deactivate**, then **Cancel** in the confirmation | Nothing changes |
| G6 | **Edit** the user: the form has a **Status** field. Set it to Inactive and **Save** | A confirmation is asked first; after it the user is inactive |
| G7 | Status = Inactive; **Edit** the user; set **Status** to Active; **Save** | Active again; can sign in |

### H. The administrator can't lock themself out

| Id | Steps | Expected |
|---|---|---|
| H1 | Look at your own row ("you"), then **Edit** it | The row has no **Deactivate** button; in the form, **Role** and **Status** are disabled |
| H2 | Change your own name or interface language; **Save** | Saved |

### I. Domains (FR-ORG-1/2)

| Id | Steps | Expected |
|---|---|---|
| I1 | Domains tab | An explanation of what a Domain is; the list shows **GENERAL** with its Hebrew and English names and description, Active |
| I2 | **+ New Domain**: code `qa3a_d1` (lower case), Hebrew and English names, both descriptions; **Create** | Created with code **QA3A_D1** (upper-cased). The description shows in the interface language |
| I3 | Create another Domain with code `QA3A_D1` | "This code already exists" |
| I4 | Try a code with a space or a Hebrew letter, or a single character | The browser refuses the form |
| I5 | **Edit** QA3A_D1: the code is greyed out; change the English name; **Save** | The new name shows; the code is unchanged |
| I6 | **Deactivate** QA3A_D1; confirm | Status **Inactive**; the row stays in this list |
| I7 | In the private window, as Dev Evaluator: **+ New participant** | The Domain list doesn't offer QA3A_D1 |
| I8 | Users → **+ New user** | The Domain list doesn't offer QA3A_D1 |
| I9 | **Reactivate** QA3A_D1 | Offered again in I7 and I8 |
| I10 | Put a user in QA3A_D1; deactivate QA3A_D1; edit that user and change only their name; **Save** | Saved: a user may keep a Domain that was deactivated later |
| I11 | Deactivate every Domain except one, then try the last one | The last one is refused: "At least one Domain must stay active". Reactivate the others afterwards |

### J. Regions

| Id | Steps | Expected |
|---|---|---|
| J1 | Regions tab | An explanation of what a Region is; the six seeded districts. Regions have no description |
| J2 | Create `QA3A_R1` with both names | Created and Active |
| J3 | Rename it, deactivate it, check New participant and New user, reactivate it | As in I5–I9 for Domains |
| J4 | Deactivate every Region | Allowed (a Region is optional for participants) — reactivate them afterwards |

### K. Languages, right-to-left and themes (FR-LANG-1/3)

| Id | Steps | Expected |
|---|---|---|
| K1 | Switch the interface to **עברית** on each of the four tabs and on both sign-in cards | Every label, button, message and confirmation is in Hebrew; the layout is right-to-left; emails and codes still read left to right |
| K2 | Switch to **English** | Every text in English, left to right |
| K3 | Theme **Dark**, then **Light**, on each tab and with a form open | Readable in both: the forms, the status pills, the Research Director badge, the green notice and the red errors |
| K4 | Narrow the browser window to about half the screen | The form fields wrap onto more rows; nothing is cut off |

### L. Action log (FR-LOG-1/2)

The log search screen comes in Phase 3e. Until then, the log can be checked in the database:

```sql
SELECT occurred_at, event_type, severity, message, details
  FROM app_events
 WHERE event_type LIKE 'users.%' OR event_type LIKE 'organisation.%'
 ORDER BY occurred_at DESC LIMIT 30;
```

| Id | Expected |
|---|---|
| L1 | Each create, edit, deactivation and reactivation in sections C–J has one row: `users.user.created`, `users.user.updated`, `users.user.deactivated`, `organisation.domain.created/updated`, `organisation.region.created/updated` |
| L2 | `details.changed` lists each changed field with its old and new value |
| L3 | A password change appears only as `"password": "reset"`, a PIN change only as `set`, `changed` or `removed`. **No password or PIN appears anywhere** in the log |
| L4 | User events have severity `SECURITY`; Domain and Region events `INFO` |

## 3. After testing

Tell me the `QA3A` users, Domains and Regions you created, and I'll remove them together with their log rows. Check that the pass threshold (D8) and every Domain and Region you deactivated in I11 and J4 are back as they were.

## 4. Known limits in 3a

- A role change or deactivation reaches a user who is already signed in only at the next automatic renewal, within 15 minutes (D7, G3).
- Both cockpits are the same web application at two addresses.
- There is no email service: the administrator passes new passwords on in person.
- The email address of an existing user can't be changed; create a new user and deactivate the old one.
- Users and their history are never deleted, only deactivated.
- Signing in switches the interface to the user's own language (the dev accounts are set to Hebrew). Changing it with the language switcher does not change the user's saved language; only the administrator's Edit form does.
