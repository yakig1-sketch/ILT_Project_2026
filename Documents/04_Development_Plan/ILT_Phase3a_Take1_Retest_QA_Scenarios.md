# ILT Phase 3a — Retest Scenarios after Phase 3 QA Take#1

**Build:** Phase 3a with the Take#1 changes (and Phase 3b on top), not yet committed
**Date:** 2026-11-05
**Prepared by:** Claude, for the owner's QA
**Covers:** only what changed after *Phase 3 QA Take#1*. The full 3a list is in [ILT_Phase3a_QA_Scenarios.md](ILT_Phase3a_QA_Scenarios.md); section R below names the scenarios from it worth running again.

## 1. What changed after Take#1

| Take#1 finding | Change |
|---|---|
| Dev Admin should not have the Sessions tab, only Administration | The administrator no longer sees the evaluator screens at all: no Sessions link, no nav bar, only the Administration card |
| The administrator must sign in at a different entry point | A separate **Administrator cockpit** address: `…/admin`. The administrator is refused at the evaluator address, and every other role is refused at the admin address |
| After signing in as admin the page still says Evaluator cockpit | The admin address says **Administrator cockpit** in the top bar, the browser tab and the sign-in card |
| Add a Deactivate button in the user list | Each user row has **Deactivate** (with a confirmation) or, for an inactive user, **Reactivate** |
| Edit User should allow activating an inactive user | The Edit form has a **Status** field (Active / Inactive) |

Also changed as a result:

- The interim pass-threshold form moved from the evaluator's Comparative summary to the admin's **Settings** tab, since the admin no longer opens the summary.
- The Deactivate / Reactivate buttons inside the Edit form were removed (the Status field replaces them).
- The Hebrew **Generate** password button now reads **הפקת סיסמה**, so it is no longer the same as **Create**.

## 2. Before you start

| Item | Value |
|---|---|
| Administrator cockpit | https://10.0.0.14:5174/admin |
| Evaluator cockpit | https://10.0.0.14:5174 |
| Accounts | **Dev Admin**, **Dev Evaluator**, plus one test user you create (`qa3a-r1@ilt.local`, Evaluator, password from **Generate**, copied before **Create**) |
| Second browser | A private window for the second user |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 3 QA Take#2* with the scenario id.

## 3. Scenarios

### N. Two entry addresses

| Id | Steps | Expected |
|---|---|---|
| N1 | Open the **Evaluator cockpit** address, signed out | Card **Evaluator sign-in**; top bar and browser tab "ILT Research System · Evaluator cockpit" |
| N2 | Open the **Administrator cockpit** address, signed out | Card **Administrator sign-in** ("Sign in to manage users, Domains and Regions"); top bar and browser tab "… · Administrator cockpit" |
| N3 | At the admin address, sign in as **Dev Admin** | The Administration card opens on **Users**, with tabs Users, Domains, Regions, Settings. **No Sessions link** and no Sessions / Administration navigation bar; above the card there is only your name and **Sign out**. The address ends with `/admin#/users` straight after sign-in |
| N4 | Click each tab; then press browser **Back** twice; then **Refresh** (F5) | The address follows the tab (`#/domains`, `#/regions`, `#/settings`); Back returns to the previous tabs; Refresh keeps you signed in on the same tab |
| N5 | Sign out; at the **evaluator** address, sign in as **Dev Admin** | Refused: "The System Administrator signs in at the administration address: https://10.0.0.14:5174/admin". Still on the sign-in card, not signed in |
| N6 | In the private window, at the **admin** address, sign in as **Dev Evaluator** | Refused: "This address is for the System Administrator. Other users sign in at the evaluator cockpit: https://10.0.0.14:5174/". Not signed in |
| N7 | Repeat N6 with a Researcher and with an Analyst | Both refused the same way |
| N8 | In the private window, sign in as **Dev Evaluator** at the evaluator address | The session list as before; no Administration link anywhere |
| N9 | As Dev Evaluator, open a participant's **Comparative summary** | No pass-threshold form on the page (it is now in the admin's Settings tab) |
| N10 | Type `/admin/` (with a trailing slash) instead of `/admin` | The Administrator cockpit opens the same way |
| N11 | Repeat N2–N6 in **עברית** | The sign-in titles, the cockpit name and both refusal messages are in Hebrew; the addresses inside the messages read left to right |

### O. Role changes reach the right cockpit

| Id | Steps | Expected |
|---|---|---|
| O1 | Create `qa3a-r1@ilt.local` as Evaluator; sign in with it in the private window (evaluator address) | Signs in |
| O2 | As admin, change its role to **System Administrator**; in the private window keep working for up to 15 minutes (or sign out and in again) | At the next renewal the user is signed out of the evaluator cockpit. Signing in again at the evaluator address is refused (N5 message); at the admin address it opens the Administrator cockpit |
| O3 | Change it back to **Evaluator**; sign in at the admin address | Refused (N6 message); the evaluator address works |

### P. Deactivate and Reactivate in the user list

| Id | Steps | Expected |
|---|---|---|
| P1 | Users tab, Status Active | Every row except your own has a red **Deactivate** button next to **Edit** |
| P2 | **Deactivate** on `qa3a-r1`; **Cancel** the confirmation | Nothing changes |
| P3 | **Deactivate** again; read the confirmation; **OK** | The confirmation names the user and says they can't sign in and their data is kept. Notice "Changes to … saved"; the row leaves the Active list |
| P4 | Status **Inactive** | The row is greyed with an **Inactive** pill and a **Reactivate** button (no Deactivate) |
| P5 | In the private window, sign in as `qa3a-r1` | "Wrong email or password" |
| P6 | **Reactivate** on the row | No confirmation; notice "Changes to … saved"; Active again, and the user can sign in |
| P7 | Lock `qa3a-r1` (5 wrong passwords), refresh the Users tab | The row shows **Locked** and still offers **Deactivate** |
| P8 | Your own row ("you") | No Deactivate button |

### Q. The Status field in Edit

| Id | Steps | Expected |
|---|---|---|
| Q1 | **Edit** an active user | The form has a **Status** field showing Active. There are no Deactivate / Reactivate buttons in the form |
| Q2 | Set Status to **Inactive**; **Save**; **Cancel** the confirmation | Not saved; the form stays open |
| Q3 | Same, but **OK** | Saved; the user is inactive (Status Inactive filter shows it) |
| Q4 | Status Inactive; **Edit** that user; set Status to **Active**; **Save** | No confirmation; saved; the user is active and can sign in (the Take#1 request) |
| Q5 | Edit an inactive user, set Status Active **and** change the name in the same save | Both saved together |
| Q6 | **Edit** your own row | **Status** and **Role** are disabled |
| Q7 | Change only the name of an active user; **Save** | No confirmation asked; Status stays Active |

### S. Hebrew labels

| Id | Steps | Expected |
|---|---|---|
| S1 | In **עברית**, **+ New user** | The password button reads **הפקת סיסמה** and the submit button **יצירה**: two different labels |
| S2 | In Hebrew, the row buttons, the Status field and its choices, the confirmation text | All in Hebrew |

### R. Regression — rerun from the full 3a list

From [ILT_Phase3a_QA_Scenarios.md](ILT_Phase3a_QA_Scenarios.md), run again: **B1, B4** (list and filters), **C3, C4** (create and first sign-in), **D3, D6** (roles and PIN), **E1–E3** (lock and unlock, now that the form changed), **F1–F2** (password reset), **H2** (editing your own name), **I6–I9** (Domain deactivation, whose row buttons share code with the user rows), **K1, K3** (Hebrew and themes on both sign-in cards and the new buttons), and **L1, L3** (each row Deactivate / Reactivate and each Status change logs `users.user.deactivated` or `users.user.updated`, with no password or PIN).

## 4. After testing

Tell me which test users (for example `qa3a-r1`) you created and I'll remove them with their log rows. If you changed Dev Admin's or Dev Evaluator's role, put it back.
