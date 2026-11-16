# ILT — QA Scenarios: Phase 5h, User guides and in-app Help

**Build:** on top of commit `13b576f`, not yet committed
**Date:** 2026-11-15
**Prepared by:** Claude, for the owner's QA
**Request (owner, 2026-11-15):** user guides for the System Administrator, Analyst, Evaluator and Researcher, in HTML, in English and Hebrew; Help or (?) on each page shows the related part of the user's guide in the page's language; each sign-in page has a link to the user guide, opened in full in a new tab.

**What was built:**
- Four guides × two languages: `packages/help/public/help/{en,he}/{evaluator,researcher,admin,analyst}.html`, with an index page per language. Served by the cockpit and the analyst portal at `/help/…`.
- A **Help** button in the top bar of every page of the Evaluator cockpit, the Administrator cockpit and the analyst portal. It opens a side panel with the section about that page, in the page's language and theme, without leaving the page. The panel has **Open the full guide in a new tab** and ✕ (Esc also closes it).
- Small **(?)** buttons next to the main panels, opening the section about that panel.
- Which guide: the user's own. A Researcher gets the Researcher guide where it covers the page, otherwise the Evaluator guide (cockpit) or the Analyst guide (portal).
- **User guides** links on each sign-in card.

## 1. Before you start

| Item | Value |
|---|---|
| Evaluator cockpit | **https://10.0.0.17:5174** |
| Administrator cockpit | **https://10.0.0.17:5174/admin** |
| Analyst portal | **https://10.0.0.17:5175** |
| Accounts | An Evaluator, a Researcher (for example `yakig@wondernet.co.il`), the System Administrator, and `dev-analyst@ilt.local` (Analyst) |
| Guides directly | https://10.0.0.17:5174/help/en/index.html and https://10.0.0.17:5174/help/he/index.html |

Reload each page first. Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**. Report failures as *Phase 5h QA Take#N* with the scenario id. Content findings (a wrong label, a wrong step, a missing explanation) are welcome too: quote the guide, the section and what the screen shows instead.

## 2. Scenarios

### S. Sign-in pages

| Id | Steps | Expected |
|---|---|---|
| S1 | Evaluator cockpit sign-in, English | Under **Sign in**: "User guides: Evaluator guide · Researcher guide". Each opens the whole guide in a **new tab**, in English |
| S2 | Switch the sign-in page to **עברית**, then click the links | "מדריכים למשתמש: מדריך לבוחנים · מדריך לחוקרים"; the guides open in Hebrew, right to left |
| S3 | Administrator cockpit sign-in (`/admin`) | One link: **System Administrator guide** / **מדריך למנהל המערכת** |
| S4 | Analyst portal sign-in | **Analyst guide** and **Researcher guide** |
| S5 | **Help** in the top bar of a sign-in page | The panel opens at **Signing in** of that app's guide |

### H. The Help button (Evaluator, in the cockpit)

| Id | Steps | Expected |
|---|---|---|
| H1 | Sign in as an Evaluator. **Help** on **Sessions** | A panel opens at the side (left in Hebrew, right in English) with the guide's **Sessions** section outlined in blue. The title reads "Help · Evaluator guide" |
| H2 | Keep the panel open and click in the page | The page still works; the panel stays until you close it |
| H3 | ✕, then open again and press **Esc** | The panel closes both ways |
| H4 | **Help** on each screen: a participant's **Protocol** (Dispatch Console), **Participant record**, a session (**Open**), **Comparative summary**, a **Replay** | The sections: The Dispatch Console · The participant record · The live session screen · The Comparative summary · Replay |
| H5 | **Open the full guide in a new tab** | The whole guide opens in a new tab at the same section, with the contents list |
| H6 | With the panel open, switch the language, then the theme (Light / Dark) | The panel shows the same section in the other language, then in the other theme |

### P. The (?) buttons

| Id | Steps | Expected section |
|---|---|---|
| P1 | **Sessions**: (?) next to **New session**; **+ New participant**, then (?) next to its title | A new session · A new participant |
| P2 | **Participant record**: (?) next to **Consent**; for a paper-cohort child next to **Paper scores**; for a LEG child next to **Results from the old application** | Consent · Paper scores · Results from the old application |
| P3 | **Dispatch Console**: (?) next to **Intervention program** | The intervention program |
| P4 | A session: (?) next to **Tablet pairing**, **Session steps**, **Clinical telemetry**, **Hand video** (when cameras are set up) | Pairing the tablet · Running the steps · Live mirror and clinical telemetry · Hand video (camera) |
| P5 | An intervention session: (?) next to the **Marks** panel title | Marking intervention sheets |
| P6 | Admin → **Canvases** → open a canvas: (?) next to **Reference tablet and recordings** | Reference recordings on the tablet |

### R. Researcher

| Id | Steps | Expected |
|---|---|---|
| R1 | Sign in to the cockpit as a Researcher. **Help** on **Sessions** | "Help · Researcher guide", section **Sessions and planning** |
| R2 | **Help** on the Dispatch Console, the participant record, the summary | Researcher guide: The Dispatch Console · The participant record · Results: the Comparative summary |
| R3 | **Help** in a live session, and (?) next to **New session** | The **Evaluator guide** (the Researcher guide has no such section): The live session screen · A new session |
| R4 | Sign in to the analyst portal as the Researcher; **Help** on **Overview** | The **Analyst guide**, The Overview tab |

### A. Administrator cockpit

| Id | Steps | Expected |
|---|---|---|
| A1 | **Help** on each tab: Users, Domains, Regions, Canvases, a canvas (Open), Cameras, Settings, Ethics approvals, Legacy data, Action log | "Help · System Administrator guide" at: Users · Domains · Regions · The canvas library · A canvas: preview, profile, versions · Cameras · Settings · Ethics approvals · Legacy data · Action log |

### N. Analyst portal

| Id | Steps | Expected |
|---|---|---|
| N1 | Sign in as `dev-analyst@ilt.local`. **Help** on **Overview**, **Research sessions**, a session, its **Replay** and **Kinematics**, **Paper and legacy**, **Exports** | "Help · Analyst guide" at: The Overview tab · Research sessions · One session · Replay · Kinematics · Paper and legacy · Exports |
| N2 | On **Research sessions**: (?) next to **Filters** and **Cohort** | Filters · The cohort table |

### W. The guide pages

| Id | Steps | Expected |
|---|---|---|
| W1 | Open https://10.0.0.17:5174/help/en/index.html | Four guides, each with a short description |
| W2 | Open a guide | Top bar with the guide's name, **עברית** / **English** and **All guides**; a contents list (on the left in English, on the right in Hebrew); numbered sections |
| W3 | Click a contents entry, then **עברית** | The section is outlined; the Hebrew link opens the **same section** in Hebrew |
| W4 | Links inside the guides (for example "see Pairing", or from the Researcher guide to the Evaluator guide) | Each opens the right section |
| W5 | Print a guide (Ctrl+P, preview only) | No top bar or contents list; the sections follow one another |
| W6 | A phone or a narrow window | The contents list moves above the text; nothing scrolls sideways (tables may scroll inside themselves) |
| W7 | The computer in dark mode, open a guide directly | The guide is dark; in light mode it is light |

### C. Content review (owner)

Read each guide with the screen beside it. In particular:

| Id | Guide · section | Check |
|---|---|---|
| C1 | Evaluator · How a block ends; Pairing the tablet | The rules you set: Manual finish only after the last house + 30 s; Next block by pen tap only, no countdown; pairing code 10 minutes; Release tablet and its limits |
| C2 | Evaluator · Marking intervention sheets | The three rows, who decides, the similarity hint, scoring once every mark is set |
| C3 | Evaluator · New session; Researcher · Research sessions | The three conditions for Research |
| C4 | Researcher · The Research Director's approval | Which changes need the PIN, and how it is typed on the administrator's screen |
| C5 | System Administrator · Settings, Canvases, Reference recordings, Cameras | Button and setting names match the screens (setting names as in the Settings tab) |
| C6 | Analyst · Overview, Exports | Matches the Phase 5g Overview and the Exports tab |
| C7 | Hebrew guides | Natural Hebrew; terms as on the Hebrew screens (בית, הצגה חוזרת in the cockpit, הפעלה חוזרת in the portal, תחום / אזור, …) |

## 3. Notes

- The guides are plain HTML: they can be printed, saved, or opened without signing in. They hold no personal data.
- Addresses in the guides are examples (`https://<server>:5174`), not the test IP.
- The tablet (child station) has no Help button: children don't use it; the Evaluator guide covers the tablet.
- When a screen changes later, its section in both languages has to be updated with it.
- **Cleanup:** none: the guides add no data.
