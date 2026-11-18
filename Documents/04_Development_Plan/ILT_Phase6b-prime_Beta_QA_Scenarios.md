# ILT — QA Scenarios: Phase 6b′, Beta access

**Build:** branch `phase-6b-prime-beta` (on top of `c049ba0`); release tag `beta-1` once merged
**Date:** 2026-11-18
**Prepared by:** Claude, for the owner's QA
**Request (owner, 2026-11-17/18):** make the system available to invited beta testers over the internet, through Cloudflare Tunnel and Cloudflare Access at `beta.ilt.network`, without opening the home router; some testers use the DTH-A116, some use touch-screen tablets.

**What was built:**
- **Beta stack** (`infra/beta`): the whole system on NucBox as its own Docker project `ilt-beta` (database, storage, gateway, analytics, Caddy), separate from development, reachable only on `127.0.0.1:8088` by the `cloudflared` service. Built from a release tag; secrets in `beta.env` (never committed, never in an image). README with install, upgrade, reset and checks.
- **Tester's address behind the tunnel:** Caddy passes Cloudflare's `CF-Connecting-IP` to the gateway, which trusts it from the Docker network only (`TRUST_PROXY`). The tablet-code lockout and the security log then work per tester.
- **Fix:** the tablet-code lockout ("5 wrong codes lock pairing for 15 minutes") never triggered: every failure restarted the count. It now locks after 5 wrong codes.
- **Touch-screen testers:** the beta build's tablet app asks **Pen** or **Touch screen** on the code screen. In touch mode the first finger (or a passive stylus) writes and taps **Next block**; other fingers and the palm are ignored. **Set the screen size** calibrates a touch tablet once with a bank card, so the ILT page shows at true size. Pilot builds are unchanged: pen only.
- **Touch sessions are labelled and kept out of research data:** each session stores how it was written (`input_kind` PEN or TOUCH, migration 0014). The cockpit shows a "Touch screen" label; the research views, and so the analyst portal and the exports, leave touch sessions out.
- **Two install fixes found while testing the beta stack** (they affected the cloud install in `infra/cloud` too): the image now carries the intervention letter files the seed reads (`Documents/05_Measures/Intervention_Letters/*.json`), so `seed.ts` no longer stops; and the analytics service no longer crashes on start in its container (it looked for the repository's `.env` four folders up).
- **Tested before handing over** (in a cloud test environment, not on NucBox): the images build; the stack starts with only `127.0.0.1:8088` published; migrations 0001–0014 and the seed run; the health checks answer; through Caddy with a simulated `CF-Connecting-IP` the lockout applies per tester; a touch-mode tablet in Chromium writes with a finger (and with a palm down only the first finger writes), a pen-mode tablet ignores the finger, the bank-card calibration is saved; the touch session is stored as TOUCH and left out of `v_research_sessions`; all 58 gateway tests pass against the migrated database.
- **Not published:** the analytics service (it has no sign-in of its own; the gateway calls it), the cameras and the development servers.

## 1. Before you start

| Item | Value |
|---|---|
| Beta, through Cloudflare | **https://beta.ilt.network** (`/cockpit/`, `/tablet/`, `/analyst/`) |
| Beta, on NucBox only | **http://127.0.0.1:8088** |
| Install | `infra/beta/README.md`, *First install* |
| Accounts | The beta System Administrator (created with `create-user.ts`); testers' accounts created under **Admin → Users** |
| Devices | A DTH-A116; a touch-screen tablet; a phone or second computer that is **not** NucBox |
| Cloudflare | Your email on the **Beta testers** policy; a second email that is **not** on it |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**. Report failures as *Phase 6b′ QA Take#N* with the scenario id.

## 2. Scenarios

### I. Install and separation (on NucBox)

| Id | Steps | Expected |
|---|---|---|
| I1 | Follow the README *First install*, steps 1–6 | Every command ends without an error; `migrate.ts` prints "Migrations up to date"; `seed.ts` prints "Seeded" and uploads two videos |
| I2 | `docker compose --env-file beta.env -f compose.beta.yml ps` | db, s3, gateway, analytics and web are running; only web shows a port: `127.0.0.1:8088->80/tcp` |
| I3 | `curl.exe -s http://127.0.0.1:8088/api/v1/health` and `.../analytics/api/v1/health` | Both answer `"status":"ok"` |
| I4 | The development stack (`pnpm infra:up`, the Vite servers) | Still works on its own ports with its own data; nothing from the beta appears in it |
| I5 | `git status` in the repository | `infra/beta/beta.env` is not listed (ignored) |
| I6 | From another computer on the home network: `http://10.0.0.17:8088` | Does not connect (the beta listens on NucBox itself only) |

### C. Cloudflare in front

| Id | Steps | Expected |
|---|---|---|
| C1 | On a phone (mobile data, not the home Wi-Fi): `https://beta.ilt.network` | Cloudflare asks for an email; your code arrives; then the ILT cockpit sign-in appears (not "Caddy works!") |
| C2 | Same, with an email **not** on the list | The page says a code was sent, but **no code arrives** |
| C3 | `https://beta.ilt.network/analytics/api/v1/kinematics/sessions/x` after signing in to Cloudflare | Not found (the cockpit opens instead); the analytics service is not reachable from outside |
| C4 | `https://beta.ilt.network/tablet/`, `/cockpit/`, `/analyst/` | Each app loads, in its own address |

### P. Pen tester (DTH-A116)

| Id | Steps | Expected |
|---|---|---|
| P1 | Sign in to the beta cockpit as an Evaluator. Create participant `BETA-001` (made-up data) and a Day 1 session | Created as in development |
| P2 | On the DTH-A116, open `https://beta.ilt.network/tablet/`. The code screen shows **This tablet writes with**: choose **Pen** | The choice is kept after a reload |
| P3 | Pair with the session code; run the first block with the pen | Live mirror in the cockpit; the block is stored and scored |
| P4 | Touch the canvas with a finger during a block | No ink: touch is ignored in pen mode (palm rejection) |
| P5 | The session in the cockpit | No "Touch screen" label |

### T. Touch-screen tester

| Id | Steps | Expected |
|---|---|---|
| T1 | On a touch tablet, open `https://beta.ilt.network/tablet/` and choose **Touch screen** | The page reloads with Touch selected and shows **Set the screen size** |
| T2 | **Set the screen size**: hold a bank card to the screen, press − / + until the blue box matches it, **Save** | The page reloads; "Calibration: … px per mm" shows the new value |
| T3 | Pair with a new session's code; write a block with one finger | Ink follows the finger; the live mirror shows it in the cockpit |
| T4 | During the block, rest the palm or a second finger on the screen while writing | Only the first finger writes; the other touch leaves no ink |
| T5 | After the last house, tap **Next block** with a finger | The next block starts |
| T6 | The session in the cockpit | A **"Touch screen (beta, not in research data)"** label next to the purpose |
| T7 | Complete a Research session in touch mode; open the analyst portal | The touch session is **not** listed in Research sessions or the Overview, and is not in an export |

### L. Tablet-code lockout

| Id | Steps | Expected |
|---|---|---|
| L1 | On one tablet, type a wrong 6-digit code 5 times | The 5th answer is "The code is wrong"; the 6th try says "Too many attempts. Try again in 15 minutes" |
| L2 | While L1's tablet is locked, pair a **second** device (another network, for example a phone on mobile data) with a valid code | It pairs: the lock applies to the first device only |
| L3 | Admin → Action log | The failed attempts show each device's own address, not one shared address |

### U. Upgrade and reset (owner, when a `beta-2` exists)

| Id | Steps | Expected |
|---|---|---|
| U1 | README *Upgrade to a new release* | The data and accounts are still there afterwards |
| U2 | README *Reset* on a copy you can lose | All beta data is gone; *First install* step 5 brings it back empty |

## 3. Known limits of the beta

- Touch results are not comparable with the DTH-A116: no hover (no air time or in-air path), no pressure or tilt, a lower and less regular sample rate. Touch testers check the flow, the screens and the timing.
- No cameras or hand video.
- The beta is up only while NucBox, Docker Desktop, `cloudflared` and the home internet are.
