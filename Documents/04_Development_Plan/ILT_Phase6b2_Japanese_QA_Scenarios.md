# ILT — QA Scenarios: Phase 6b″, Japanese canvases (beta only)

**Build:** branch `phase-6b2-japanese` (on top of `phase-6b-prime-beta`)
**Date:** 2026-11-18
**Prepared by:** Claude, for the owner's QA
**Request (owner, 2026-11-18):** Japanese canvases from the *ILT Japanese Canvas Proposal* (tategaki ILT grid and kokugo notebook page), with a placeholder glyph until the research team decides; **not deployed to the beta until the owner asks**.

**What was built:**
- **Japanese as a session language** (`ja`): the child's tablet speaks Japanese; staff screens stay in Hebrew and English. **Off by default**: a Japanese session is refused until the System Administrator adds Japanese to *Enabled languages*, and still refused while its canvases are Drafts.
- **Two Draft canvases** in the canvas library, set *Japanese*, both **upright (portrait)**: `ILT_TATEGAKI_JA` (3 columns × 5 boxes of 24 mm, filled down each column, columns from the right; **placeholder glyph**) and `NOTEBOOK_KOKUGO_JA` (5 columns of 8 masu of 18 mm with dashed cross-guides; the top 5 of the 3 right-hand columns are written, locked column by column).
- **Tablet upright for Japanese sessions** (owner decision 2026-11-18): a canvas carries its orientation; the tablet shows "turn the tablet upright / on its side" in the session language instead of a page held the wrong way, and the activation check uses the screen upright for a portrait canvas.
- **Vertical guide lines** in the canvas format, and the fill direction *Top to bottom, column by column from the right*.
- **Japanese tablet texts** (draft for review): `ILT_Phase6b2_Japanese_Tablet_Texts_Review.md`.
- **Fix:** the seed's new per-canvas status had a database type error, found and fixed while testing.

**Open decisions (research team) before the ILT canvas is used with children:** the glyph (the proposal's draws く), the dot rules (proposal: all 3.5 mm, no weights) and norms. *The fit is decided: the tablet upright.*

**Tested before handing over** (in a cloud test copy, not the beta): all builds, typechecks and unit tests; Japanese refused while off (409 `LANGUAGE_DISABLED`) and while Drafts (409 `NO_CANVAS`); with both switched on in the test database, Day 1 uses both canvases. At the DTH-A116's screen size (1097 × 617 CSS px): held on its side, the tablet shows only たてむき (no page, no writing surface); upright, both pages fit (499 × 707 and 584 × 748 CSS px in 617 × 1097) and pen strokes reach the cockpit; a Hebrew session is unchanged on its side and asks to be turned on its side when upright (screenshots sent to the owner).

## 1. Before you start

Only when the owner decides to deploy this branch to the beta (`infra/beta/README.md`, *Upgrade*, **plus the seed**: `run --rm ops src/seed.ts`, which adds Japanese and the two Drafts and changes nothing else).

**Turning the DTH-A116 upright** (Japanese sessions): Windows **Settings → System → Display**, select the DTH-A116, **Display orientation: Portrait**, keep the change. Check that the pen lands under its tip; if not, set the pen display's orientation to match in **Wacom Center**. Turn it back to **Landscape** for Hebrew and English sessions.

## 2. Scenarios

| Id | Steps | Expected |
|---|---|---|
| J1 | After the seed: Admin → Canvases | A **Japanese** set with `ILT_TATEGAKI_JA` and `NOTEBOOK_KOKUGO_JA`, both **Draft**. The Hebrew and English canvases are unchanged and Active |
| J2 | Plan a session for a participant with language Japanese | Not offered (Japanese is not in *Enabled languages*) |
| J3 | Admin → Settings: the Japanese group | ILT canvas `ILT_TATEGAKI_JA`, notebook canvas `NOTEBOOK_KOKUGO_JA`, fill direction *Top to bottom, column by column from the right* |
| J4 | Open `NOTEBOOK_KOKUGO_JA`, preview it on the reference tablet held **upright** | 5 columns of 8 masu with dashed cross-guides, a furigana strip right of each column, true size (check with a ruler: 18 mm squares) |
| J5 | Preview either Japanese canvas with the tablet **on its side** | Only "タブレットを たてむきに してください"; no page. Turn the tablet: the page appears |
| J6 | Add Japanese to *Enabled languages*, activate `NOTEBOOK_KOKUGO_JA` only, plan a Japanese Day 1 | Refused (no Active ILT canvas) |
| J6a | **Activate** `ILT_TATEGAKI_JA` (placeholder glyph: for testing only) | Accepted: it fits the screen upright |
| J7 | Tablet upright: run a Japanese Day 1 on the DTH-A116 | Header つくりもじの かだい and ブロック n / 8; countdown じゅんびしてね…; boxes fill down the right-hand column first; a passed box is locked; つぎへ after the last box; the notebook pages use the kokugo page, locked per column; no turning between steps |
| J7a | A Hebrew session with the tablet still **upright** | "סובבו את הטאבלט לרוחב (שוכב) כדי להמשיך" instead of the page; on its side the session runs as before |
| J8 | Switch the cockpit to Hebrew/English on the same computer as a Japanese tablet | The cockpit stays in Hebrew or English (a tablet's Japanese is never kept as the staff language) |
| J9 | Remove Japanese from *Enabled languages* | No new Japanese sessions; existing ones keep their data |
