# ILT System landing page

The entry page of the system, served at `/` by the beta's Caddy (`infra/beta/Caddyfile.beta`) and copied into the
web image (`infra/cloud/ilt.Dockerfile`). Static files only, no build step: `index.html`, `landing.css`,
`landing.js` and the photo `child-writing.jpg` (960 px, about 80 KB). The look follows the ILT Google Site design
(ink #16324f, amber #d97706, sky #0284c7, paper #faf8f4 with a 28 px grid), in plain CSS with no external scripts or fonts.

- **About**: the research summary, in English, Hebrew or Japanese.
- **Login**: one item per role, each opens the real sign-in page:
  Evaluator and Researcher `/cockpit/`, Analyst `/analyst/`, Sys. Admin `/cockpit/admin`, the child's tablet `/tablet/`.
- **Language**: English, Hebrew (right to left) or Japanese, with SVG flags (flag emoji do not show on Windows).
  The choice is kept in the browser (`ilt.landing_language`); Hebrew and English are also passed to the staff
  apps (`ilt.ui_language`). `?lang=he|en|ja` in the address chooses a language too.
- **Preview ILT Stroke / Replay**: draws the 3-dot continuous stroke of the ILT letter.

Try it locally: `python3 -m http.server 5180 --directory apps/landing`, then open http://127.0.0.1:5180/.
