# ILT — QA Scenarios: Phase 4c, Research exports

**Build:** on top of commit `279cd98`, not yet committed
**Date:** 2026-11-11
**Prepared by:** Claude, for the owner's QA
**Requirements:** FRS v3.5 FR-AN-2 (Parquet and CSV exports), FR-AN-3, FR-LOG-1; Architecture v5.6 §4.4; DDD v1.6 §9, §14

Phase 4c adds an **Exports** tab to the analyst portal. It exports the research sessions that match the research screen's filters as one zip file, for DuckDB, Python/Jupyter, R, Superset, Metabase or a spreadsheet.

## 1. Before you start

| Item | Value |
|---|---|
| Analyst portal | **https://10.0.0.17:5175** |
| Evaluator cockpit | https://10.0.0.17:5174 (Administrator: `/admin`) |
| Accounts | `dev-analyst@ilt.local` (Analyst) and your Researcher account |
| Test data | **S261108-QA4A** is back for this QA (participant QA4A-01: Grade 1, Female, a copy of the pen data of S261102-EJX5). Tell me when you are done and I'll remove it, with any exports you made |
| Opening the files | Optional. To look inside a Parquet file, open https://shell.duckdb.org in Chrome and drag the file in, or use DuckDB or Python if installed. CSV files open in Excel or any text editor |

Mark each scenario **Pass**, **Fail** (with what you saw) or **Skip**, and report failures as *Phase 4c QA Take#N* with the scenario id.

## 2. Scenarios

### X. The Exports tab

| Id | Steps | Expected |
|---|---|---|
| X1 | Sign in as `dev-analyst@ilt.local` | Two tabs above the content: **Research sessions** and **Exports** |
| X2 | **Research sessions**: set Gender **Female** and Grade **Grade 1**. Then **Exports** | "1 research session matches your current filters." with "Grade: Grade 1 · Gender: Female" under it |
| X3 | **Change filters**, set Gender **Male**, return to **Exports** | **Change filters** goes back to Research sessions with the filters kept. On Exports: "0 research sessions…", and **Create export** is disabled |
| X4 | **Clear filters**, then **Exports** | "No filters: all research sessions." |
| X5 | Read **Format** and **Contents** | Parquet (selected) or CSV, each with what it is for. Contents: the always-included tables, plus two options: raw pen samples (large) and kinematics (slower) |

### Y. Creating and downloading

| Id | Steps | Expected |
|---|---|---|
| Y1 | Parquet, no options. **Create export (1 session)** | A row in **My exports**: now, 1 session, Parquet, "tables", the filters, **Preparing…**; within a few seconds **Ready**, with its size and **Download** |
| Y2 | **Download** | Chrome saves `ilt-research-export-<date>-<time>-parquet.zip`. The time in the name is UTC, two hours behind Israel time |
| Y3 | Open the zip | `sessions.parquet`, `blocks.parquet`, `letters.parquet`, `score_versions.parquet`, `README.txt` and `manifest.json` |
| Y4 | Read `README.txt` and `manifest.json` | README: what the export holds, a description of each file, units and codes. Manifest: the filters, the options and the row counts (sessions 1, blocks 13, letters 135, score_versions 8) |
| Y5 | CSV, with **both** options | **Ready** at about 0.9 MB. The zip also holds `samples.csv` (35,572 rows) and `kinematics_blocks.csv`, `kinematics_letters.csv` and `kinematics_strokes.csv` |
| Y6 | Open `sessions.csv` (Excel or a text editor) | A header row and one row: S261108-QA4A, QA4A-01, school key `112957e7`, GRADE_1, FEMALE, MID, RIGHT; times in UTC |
| Y7 | Optional: open `blocks.parquet` in DuckDB | 13 rows; `counts` is true for ILT blocks 1–8 only |

### Z. Privacy, access and logging

| Id | Steps | Expected |
|---|---|---|
| Z1 | Look through `sessions` and `letters` in any export | No name, school name, birth date or national ID: only the study code and the short school key |
| Z2 | Sign out, sign in as your **Researcher** account, open **Exports** | Your own (empty) list: the Analyst's exports are not shown |
| Z3 | Copy a **Download** link. Wait more than 15 minutes, or edit a character of it, then open it | "This download link has expired or is not valid…" (a short error message, no file) |
| Z4 | (Admin) **Action log**: types *Data exported* and *Export downloaded* | One "Research export created: 1 session(s), PARQUET" (or CSV) per export, with the filters, options and row counts in the details; one "Research export downloaded" per download |
| Z5 | In the cockpit, record a consent for QA4A-01 **without** research use, then on **Exports** reload | "0 research sessions…": nothing to export. Restore a consent **with** research use |

### W. Languages and themes

| Id | Steps | Expected |
|---|---|---|
| W1 | Hebrew and English | Everything translated; in Hebrew the size reads "506 KB", not "KB 506" |
| W2 | Dark and Light | The tabs, options, table and status pills are readable |

## 3. Notes

- The export is built by the analytics service from the research views only, as the analyst role. Like the portal, it can never include an Intervention session or a participant without research consent.
- The files are kept in a private storage bucket on the development PC. The download goes through the gateway with a link signed for 15 minutes, so the bucket is never exposed to the network.
- Exports are not deleted automatically yet. Delete the downloaded files when you are done, as they hold research data.

## 4. Results

### Take#1 (2026-11-11)

Passed: X1–X5, Y1–Y7 (Y7 checked in `blocks.csv`), Z1, Z4, Z5, W1 and W2. Z3 partly passed. Z2 is still open: it needs a sign-in with the Researcher account.

| Finding | Fix |
|---|---|
| Z3: a bad or expired download link was refused correctly (403, no file), but the browser showed raw JSON with the untranslated key `analyst.export.link_expired` | A refused link now shows a short page in Hebrew and English: "קישור ההורדה הזה פג או אינו תקף…" / "This download link has expired or is not valid…". A missing file gets a similar page. Test added |
| Minor (Z4): a HEAD request on a download link was logged as "Export downloaded", although no file was sent | HEAD requests are no longer logged. Test added |
| Minor: a mistyped address got the framework's default 404, which repeated the full address, user id included | Every unknown address in the gateway now answers with the usual short error, without the address. Test added |

The three zips downloaded during Take#1 are on the test machine, in Chrome's Downloads folder; delete them there.

Re-test in Take#2: **Z2** (as the Researcher: an empty **My exports** list), **Z3** (open a tampered link: the bilingual page) and **Z4** (one "Export downloaded" row per actual download).

### Take#2 (2026-11-11)

Every Phase 4c scenario has passed, with no open findings.

- **Z3:** a link with an edited signature, and one with an old expiry, both return 403 with the bilingual page; no file is sent.
- **Z4:** a HEAD request adds no log row, and a real download adds exactly one "Research export downloaded" row.
- **The 404 fix:** unknown addresses, inside the export path and elsewhere under `/api/v1/`, return the short `error.404` reply without repeating the address.
- **Z2:** checked by the developer with a throwaway Researcher account (since deleted). Its **My exports** list was empty, and asking for a download link to the Analyst's export returned 404.

**Cleanup done:**
- Session S261108-QA4A, with its blocks and pen data;
- participant QA4A-01 and its three QA4A consent records;
- the "QA 4a" approval;
- the two exports (their database rows and their files in the exports bucket);
- the throwaway Researcher account;
- the session's 9 log rows: 2 "Data exported" and 7 "Export downloaded";
- the 2 consent log rows.

**Still for the tester:** delete the three zips from Take#1 in Chrome's Downloads folder on the test machine.
