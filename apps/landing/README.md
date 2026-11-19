# ILT System landing page

The main entry to the system: served at `/` by the beta's Caddy (`infra/beta/Caddyfile.beta`) and copied into the
web image (`infra/cloud/ilt.Dockerfile`, target `web`). Static files only, no build step, no external fonts or scripts.

- **About:** the system in Hebrew, English or Japanese (`landing.js`, `about`).
- **Login:** a menu by role. Evaluator and Researcher → `/cockpit/`, Analyst → `/analyst/`, System administrator → `/cockpit/admin`; the child's tablet → `/tablet/`.
- **Language:** Hebrew, English, Japanese, with drawn flags (flag emoji do not show on Windows). The choice is kept in the browser; Hebrew and English are passed on to the staff apps (`ilt.ui_language`), Japanese is not (the staff apps speak Hebrew and English).
- **Texts:** all in `landing.js` (`T.he`, `T.en`, `T.ja`). The Hebrew and Japanese texts and the About content are drafts for the owner's review.

To look at it locally: `python3 -m http.server 5180 --directory apps/landing`, then http://127.0.0.1:5180/ (the login links need the beta stack).
