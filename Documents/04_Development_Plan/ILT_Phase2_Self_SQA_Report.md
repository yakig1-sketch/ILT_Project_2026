# ILT Phase 2 — Self-SQA Report

**Build:** Phase 2 (full test session and scores), on top of commit `cd68ed8`, not yet committed
**Date:** 2026-11-01
**Tested by:** Claude (developer self-test before the owner's SQA)
**Environment:** Windows 11 development PC; TimescaleDB and SeaweedFS in Docker; gateway, kiosk and cockpit on the same PC. Browser runs used the built-in Chromium browser with the mouse standing in for the pen (development builds only). **Not yet run on the DTH-A116.**

## 1. Scope

What Phase 2 adds, with the requirement for each:

| Area | Requirement | Delivered |
|---|---|---|
| Video steps | FR-PLAN-6/7/8 | The cockpit plays the intro and notebook-demo videos on the tablet in the session language, full screen. The evaluator can stop a video or skip it. A video missing in the session language is flagged in the step list |
| Day flows | FR-PLAN-3 | Day 1, Day 2 and Day 14 run start to finish. A **[Next step]** button runs the first step not yet done, whatever its type |
| Inactivity | FR-TAB-5 | The tablet shows a soft amber glow around the page after 20 s without writing (30 s after the last house). After 10 s more, the cockpit's telemetry panel turns amber. Both alerts are logged |
| Live telemetry | FR-COCK-2 | The cockpit's live panel now also shows internal pen lifts (with house numbers), width outside the band, dot B hits and average ILT speed. These lines said "In Phase 2" before |
| Scoring | FR-SCORE-1…14, DDD §8 | Each block is measured and scored as soon as it is stored, and the cockpit shows a result card. Results are written to `letter_measures`, `score_versions` (version 1, with the settings and profile used) and `letter_scores` |
| Warm-up and notebook pages | FR-PLAN-3/5 | Warm-up is measured but not scored. Notebook pages record time and pen lifts only |
| Repeat block | FR-COCK-3 | The finished attempt is kept as REPEATED, for audit, with its reason; the block is sent again as the next attempt |
| Paper notebook pages | FR-COCK-4 | The evaluator times the page in the cockpit (start, stop, continue) and adds notes |
| Comparative Summary | FR-SUM-1…4 | Five anchor boxes: Day 1 first and last pair, Day 2 first and last pair, Day 14. Each shows time, pen lifts, accuracy %, average speed, the component scores, the composite and Pass/Fail, with [Replay] per block. The weights and threshold in effect are shown |
| Pass threshold | FR-SUM-4, FR-ROLE-3 | A System Administrator changes it on the dashboard. The change needs a Research Director's PIN, which the server checks, and is stored in the history |
| Replay | FR-REP-1/2 | Play and pause, a timeline scrubber, speed 0.25× to 4×, and one-sample steps forward and back. The speed is shown under each house, ink is coloured by pressure, and the hover path is shown |

## 2. Automated tests

Command: `pnpm turbo run build typecheck test` (forced, no cache). **Result: 27 of 27 tasks pass.**

| Suite | Tests | Result |
|---|---|---|
| Scoring engine (golden examples, segmentation) | 23 | Pass |
| Canvas and protocol schemas, including the new forward-only locking tests | 11 | Pass |
| Translations: Hebrew and English key sets identical | 3 | Pass |
| Gateway unit tests | 4 | Pass |
| **Gateway Phase 1 flow against the database** | 1 | Pass |
| **Gateway Phase 2 flow against the database** (new) | 2 | Pass |

What the new Phase 2 database test checks:

- **Intro video:**
  - the Hebrew video resolves and downloads with the tablet token;
  - a request without a token gets 401;
  - no block can start while the video plays;
  - the step is marked DONE when the video ends.
- **Warm-up:** 15 letter measures stored, no score version.
- **ILT block:** scored as version 1, with the settings used stored. A perfect block at Normal speed scores 100 / 100 / 100 / composite 100.
- **Repeat block:**
  - attempt 1 becomes REPEATED, with its reason;
  - attempt 2 is scored, and a slower block gets a lower speed score;
  - repeating a step that hasn't finished is refused.
- **Inactivity:** an AMBER alert is forwarded to the cockpit and logged.
- **Notebook page:** time and pen lifts only.
- **Summary:** the first pair uses the repeated attempt and the second block, and the averages are correct.
- **Pass threshold:**
  - refused for an evaluator;
  - refused for an admin without a PIN, or with a wrong PIN;
  - accepted with the director's PIN;
  - Pass/Fail follows the threshold, and the history records the approver.
- **Replay data:** every sample, and 15 per-house speeds.
- **English Day 1:** no English intro video exists, so playing it is refused with `NO_VIDEO` and the evaluator can skip the step.
- **Day 2 paper page:**
  - a wrong step type gets 409 and a negative time gets 400;
  - a correct save works, and a second save gets 409;
  - the save is logged.
- **Clean-up:** the test restores the pass threshold it changes.

## 3. Manual walkthrough (browser, Hebrew Day 1 + Day 2)

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | [Next step] on a new session | Reads "Next step: Intro video" | Pass |
| 2 | Play the intro video on the tablet | Plays full screen in Hebrew, 79 s; the cockpit shows "Playing on the tablet" | Pass |
| 3 | Stop the video from the cockpit | The tablet returns to waiting; the step is Done; [Next step] moves to the warm-up | Pass |
| 4 | Notebook-demo video plays to the end | The step becomes Done by itself after 31 s | Pass |
| 5 | Live telemetry during the warm-up | 15 pen lifts, 0 internal, width 0/15 outside the band, dot B 15/15, 33.7 mm/s | Pass |
| 6 | Inactivity after the last house | Tablet glow at 30 s; at 40 s the cockpit panel turns amber ("No writing: check the child") and Manual finish blinks | Pass |
| 7 | Pen tap on [Next block] | Next block starts with no countdown; the glow clears | Pass |
| 8 | Warm-up result card | Time, pen lifts, accuracy and speed; "measured, not scored" | Pass |
| 9 | ILT block result card, no Normal speed recorded | Speed score and composite "not configured"; accuracy 100, pen lifts 100 | Pass (see §5.1) |
| 10 | ILT block with Normal speed 20 mm/s (test value) | 19.15 mm/s gives speed 100 and composite 100 | Pass |
| 11 | Repeat block 1 (reason: disruption) | Block resent with the countdown; row shows "1 earlier attempt(s) repeated" | Pass |
| 12 | Slow repeat (11.15 mm/s) | Speed score 61.9 (100 ÷ (18 ÷ 11.15)); composite 81.0 | Pass (hand-checked) |
| 13 | Replay | 15 per-house speeds; play at 4×; scrubber; one sample forward and back; pressure and pen lifts read out | Pass |
| 14 | Summary, Day 1 first pair | Uses the repeat (attempt 2) and block 2: time 28.0 s, speed score 81.0, composite 90.5 | Pass (hand-checked) |
| 15 | Summary as an evaluator | The threshold form is hidden | Pass |
| 16 | Threshold as admin with a wrong director PIN | "The director email or PIN is wrong"; nothing saved | Pass |
| 17 | Threshold 85, then 95, with the right PIN | Pass at 85, Fail at 95; the history records each change and the approver; cleared back to "not configured" | Pass |
| 18 | Hebrew RTL on the summary | Layout mirrored, numbers readable | Pass |
| 19 | Notebook page, compact writing | [Next block] off after 14 letters, on after the 15th; result card: time and pen lifts only, "timed only" | Pass |
| 20 | Day 2 paper page | Start, stop at 3.0 s, note saved; the row shows "Paper page: 3.0 s · note" | Pass |
| 21 | Gateway log during the walkthrough | No errors | Pass |

### Defects found during self-SQA and fixed

1. **Lost integrity line:** the block result card dropped its "Block saved / integrity" line when [Next block] started the next block. Fixed: it now keeps the line.
2. **Clipped replay labels:** in Replay, the speed labels under the bottom row of houses were cut off. Fixed by adding space below the canvas.
3. **Console warning:** the blinking Manual finish button produced a React style warning, because its style mixed `border` and `borderColor`. Fixed.

## 4. Data left in the development database

These are test participants and sessions only:
- BROWSER-03, with Day 1 session S261101-B8GU and a Day 2 session;
- TEST2-… and TEST2B-…, from the automated test.

Session S261101-B8GU has a **test Normal speed of 20 mm/s** written into its own step snapshots, used to check the composite. No canvas, setting or other session was changed. The pass threshold is back to "not configured". The throwaway accounts are deactivated.

## 5. Open items and limits

1. **No composite until a Normal speed is recorded.** The seeded ILT canvases have no Normal speed. As FRS 9.4 requires, the speed score, and so the composite and Pass/Fail, show "not configured" in real sessions. They will show once the reference recording (Phase 3, FR-CAN-9/10) or an administrator sets the Normal speed. Until then the summary shows the time, pen-lift and accuracy figures, but no composite.
2. **Tap to play.** If Android Chrome refuses to start a video with sound (for example right after the tablet page reloads), the tablet shows a "Tap to play the video" button. The browser here allowed autoplay, so this path is **not yet seen on the DTH-A116**.
3. **Inactivity cue is visual only.** The `ilt.inactivity_cue` setting also allows AUDIO and BOTH; those are not built.
4. **Notebook page time-out not used.** The `ilt.timer.notebook_page_timeout_sec` setting (60 s) exists but nothing uses it yet. Its meaning needs confirming: should a notebook page end itself after 60 s?
5. **Hand video is not in this phase.** Recording hand video and playing it in sync during replay (FR-REP-3) needs the camera, consent and storage path, which belong to a later phase.
6. **Changing a step's canvas before dispatch (FR-PLAN-4) is not built yet.**
7. **Pen timing in this self-test.** The mouse stood in for the pen with timed synthetic events. Real pen timing, the pen-only [Next block] tap, full-screen return, the glow brightness and video autoplay all need your test on the DTH-A116.

## 6. Owner's SQA script (DTH-A116 + second PC)

Use these addresses:
- Tablet: `https://10.0.0.14:5173`
- Cockpit: `https://10.0.0.14:5174`

Reload both pages first.

1. **Create:** create a new participant (participant code, school, birth month) and a **Hebrew Day 1** session. Pair the tablet with the PIN.
2. **Intro video:** press **[Next step: Intro video]**.
   - Expected: the video plays full screen on the tablet, with sound.
   - Let it end, or press **Stop video**.
   - If a "Tap to play" button appears instead, tap it, and please note it.
3. **Warm-up:** press **[Next step]** to start the warm-up.
   - Write all 15 houses, then stop writing.
   - Expected: after 30 s a soft amber glow appears around the tablet page. 10 s later the cockpit panel turns amber and Manual finish blinks.
4. **Next block:** tap **[Next block]** with the pen. Expected: ILT block 1 starts at once.
5. **Live telemetry:** while writing, watch the cockpit's live panel. Expected: internal pen lifts, width, dot B hits and average speed update about once a second.
6. **Result card:** finish block 1.
   - Expected: a result card shows time, pen lifts, accuracy and speed.
   - Speed score and composite show "not configured" (see §5.1).
7. **Repeat:** choose a repeat reason, then press **Repeat block** on block 1.
   - Expected: block 1 is sent again after the countdown.
   - The step list shows "1 earlier attempt(s) repeated".
8. **Replay:** press **Replay** on the result card.
   - Try play, the 0.25× and 4× speeds, the scrubber, and the ⏮ / ⏭ sample steps.
   - Check the speed under each house.
9. **Notebook pages:**
   - Continue to the **notebook demo video** and let it play to the end.
   - Then write notebook page 1. Expected: [Next block] comes on after 5 letters in the last row.
   - The result card shows time only.
10. **Summary:** press **Comparative summary**. Expected: the Day 1 first pair shows the repeated block 1 and block 2.
11. **Pass threshold (optional):** this step needs an administrator login and the Research Director's PIN.
    - Set the pass threshold on the summary page.
    - Check Pass/Fail. It shows only for blocks that have a composite, so see §5.1.
    - Then clear the threshold.
12. **Day 2 paper pages:** create a **Day 2** session.
    - On a paper notebook page press Start, then Stop, add a note, and press **Save page**.
    - Expected: the row shows the time and the note.
13. **English video warning:** create an **English Day 1** session. Expected: the intro video row warns that there is no video in the session language. Skip it.
