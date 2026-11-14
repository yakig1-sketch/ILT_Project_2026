# ILT — QA Scenarios: Phase 5f, Session video capture

**Build:** on top of commit `dbfa1ee`, not yet committed
**Take#2 (2026-11-14):** the camera log says *retired* / *restored* / *named …* / *own account set …*; **Last seen** updates whenever the camera gives a picture or video; **Rename** edits the name in the list (Enter saves, Escape cancels); the replay's hand video and the live view have **↻ Rotate 180°** (remembered in this browser). Please re-run **C4** (the wrong own account needs you to type it), **C6**, **R4** (rotate), **R6** (finish the session: the camera is released by itself) and **N1** on the tablet's QR and frame screens.
**Date:** 2026-11-14
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 §14.1 (FR-VID-1…7), FR-PRIV-2, FR-REP-3; DDD v1.6 §5, §9, §14
**Decisions (2026-11-14):**
- One **site camera account**, entered by the administrator; a camera can have its own.
- Cameras are paired **per session** by a QR code on the tablet; a camera serves one session at a time. A Multi-Student Cockpit is a later phase.
- **Pan/tilt** arrow buttons in the positioning view, for cameras that can turn.
- **One clip per writing step** (each attempt), from its dispatch to its end. Video only, no sound.

## 1. Before you start

| Item | Value |
|---|---|
| Camera | The **Tapo C211** at 10.0.0.23, on the same network as the ILT server. In the **Tapo app**: the camera → Settings → Advanced settings → **Camera account**: set a user name and password (this is not your TP-Link account) |
| Camera relay | Started with the other services (`pnpm infra:up`); Administrator → **Cameras** warns when it is not answering |
| Administrator | **https://10.0.0.17:5174/admin** → **Cameras** |
| Evaluator | **https://10.0.0.17:5174**, and the tablet kiosk |
| Video allowed | System setting **Hand video recording (subject to consent)** (`ilt.video.recording_enabled`) on, and a participant whose consent has **hand video** allowed, for example **QA5F-V**. A second participant without hand-video consent, **QA5F-N**. Both sessions are created *after* the setting and consents are in place |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**. Report failures as *Phase 5f QA Take#N* with the scenario id.

## 2. Scenarios

### C. Cameras (Administrator)

| Id | Steps | Expected |
|---|---|---|
| C1 | Open **Cameras** before the account is set | The C211 is listed (address 10.0.0.23) with status **No account**. If not, **Search the network** finds it within a few seconds |
| C2 | Enter the camera account under **Site camera account**, **Save** | "Saved. The cameras were checked…". The C211 becomes **Ready**, Pan/tilt **Yes**. The password field is empty again and the password is never shown |
| C3 | **Picture** on the C211 | A current picture from the camera appears |
| C4 | **Rename** it "Camera 1"; then enter a wrong password under **Own account** | The name shows. With the wrong own account the status becomes **Wrong account**; **Use the site account** brings it back to **Ready** |
| C5 | **Retire**, then **Restore** | Retired: greyed out, and it is not used for pairing (see P5). Restored: Ready again |
| C6 | **Action log**, area **Cameras** | "Camera account changed" (as a security event) and "Camera changed", without any password |

### P. Pairing and positioning (Evaluator)

| Id | Steps | Expected |
|---|---|---|
| P1 | Open QA5F-N's session (no hand-video consent) | The **Hand video** line says it is off for this session; no pairing button |
| P2 | Open QA5F-V's session before the tablet is paired | **Hand video** panel: **Pair a camera** is disabled until the tablet is connected |
| P3 | Pair the tablet, then **Pair a camera** | The tablet shows a large **QR code** ("Camera pairing"). The cockpit says it is looking for the code in 1 free camera, until a time 3 minutes on |
| P4 | Point the camera at the tablet | Within a few seconds: the cockpit shows **Camera: Camera 1** and opens the live view; the tablet shows the **framing guide** (blue edge, black corners) |
| P5 | *(Optional)* Before P4, retire the camera; or let 3 minutes pass without showing the code | Nothing is paired; after 3 minutes the pairing expires, the tablet returns to its waiting screen and **Pair a camera** is offered again |
| P6 | In the live view, use the **arrow buttons** | The camera turns a small step each time; the live view follows within about a second |
| P7 | Frame the whole tablet, then **Done** | The tablet returns to its waiting screen. The panel shows **Position the camera** and **Release camera** |

### R. Recording and replay

| Id | Steps | Expected |
|---|---|---|
| R1 | Dispatch the warm-up block and write it | While the block runs the panel shows **● Recording**; **Release camera** is disabled. After the block it shows "Records each writing step" |
| R2 | Write two ILT blocks; repeat one | Each attempt gets its own clip (the repeated one too). **Action log**: "Hand video stored" per attempt, with its length and size |
| R3 | Play a video step | Nothing is recorded during the video |
| R4 | **Comparative Summary** → replay of a recorded block | Under the canvas: **Hand video**. Play, pause, the timeline and the speed move the video with the pen. The picture shows the child's hand writing what the replay draws, give or take about half a second |
| R5 | Replay a block of QA5F-N's session | No hand video section |
| R6 | **Release camera**, then complete the session | The panel offers **Pair a camera** again. A completed session releases its camera by itself |

### M. Several sessions

| Id | Steps | Expected |
|---|---|---|
| M1 | *(Needs a second tablet; a second camera if you have one)* While QA5F-V's session holds Camera 1, open another session with hand video, pair its tablet and **Pair a camera** | With one camera: it says no free camera is ready; Camera 1 stays with the first session. With a second camera pointed at the second tablet: that camera is paired to the second session only |

### N. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| N1 | **English** and **Hebrew** | The Cameras tab, the Hand video panel, the tablet's QR and frame screens and the replay's Hand video are translated |
| N2 | **Dark** | The Cameras tab and the Hand video panel are readable |

## 3. Notes

- **Checked by the developer with the real C211 (2026-11-14):** found on the network; Ready with the site account; a picture in about 1 s; the live view plays in Chrome (1280×720, the camera's second stream); a pan step turns the camera and a step back returns it; a recorded step gives a clip of H.264 2304×1296 without sound (about 1.3 Mbit/s, so roughly 30 MB for a 3-minute block), and replay loads it at the right offset. Fixed on the way: the camera's smallest stream is MJPEG, which browsers can't play, so only H.264 streams are used; and the live view lost its first request while the sign-in was checked. **Not checked yet: the QR code read by the real camera (P3–P4).**

- **Sync:** each clip starts at the step's dispatch, a moment before the child starts. The camera's own delay (usually under a second) is not corrected yet; R4 tells us whether that is needed.
- **No sound** is recorded.
- **Consent changes:** whether video is recorded is decided when the session is created (setting and consent then), as before.
- **Cleanup by the developer after QA:** QA5F-V and QA5F-N with their sessions and clips, the camera pairings, the site camera account if you want it removed, and the setting change.
