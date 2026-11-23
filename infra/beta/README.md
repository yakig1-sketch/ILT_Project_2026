# ILT beta stack (Phase 6b′)

The whole ILT system on one machine (NucBox), for invited beta testers at **https://beta.ilt.network**.

```
Tester's browser → Cloudflare (HTTPS + Access: invited emails only) → Cloudflare Tunnel (cloudflared service)
  → 127.0.0.1:8088 → Caddy (web) → /tablet/ /cockpit/ /analyst/ and /api, /ws → gateway → db, s3, analytics
```

- **The landing page** (`apps/landing`) is the entry at `https://beta.ilt.network/`: About, Login by role and Language (Hebrew, English, Japanese).
- **Separate from development.** Project name `ilt-beta`, its own database, storage and Docker volumes. The development stack (`infra/docker-compose.yml`, ports 5432, 8333, 1984) and the Vite servers (5173–5175) are untouched and never exposed.
- **One port only:** the web front on `127.0.0.1:8088`. Nothing listens on the network; only `cloudflared` on the same machine reaches it.
- **Test data only.** Beta testers create made-up participants (study codes starting `BETA-`). No real child's data goes into the beta, and no camera is connected.
- **Pen and touch.** The tablet app of this build lets the tester choose **Pen** (DTH-A116) or **Touch screen** on the code screen. Touch sessions carry a "Touch screen" label in the cockpit and are left out of the analyst portal and the exports (`sessions.input_kind`, migration 0014).
- The Cloudflare side (domain, Access, tunnel) is in *ILT Beta Access Setup Guide v3*.

All commands below run in **PowerShell on NucBox, in this folder**:

```powershell
cd C:\Users\Yaki\Documents\GitHub\ILT_Project_2026\infra\beta
```

## First install

1. **Secrets.** Copy the example and fill in every empty value:
   ```powershell
   Copy-Item beta.env.example beta.env
   notepad beta.env
   ```
   For each password and key, paste a new value made with this command (64 letters and digits; run it once per value):
   ```powershell
   [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
   ```
   `beta.env` is ignored by git and never goes into an image. Keep a copy in your password manager: without `SCHOOL_CODE_HMAC_KEY` the school codes already stored can no longer be matched.

2. **Check out the release** (a git tag; the first is `beta-1`) and set `BETA_TAG` in `beta.env` to the same name:
   ```powershell
   git fetch --tags
   git checkout beta-1
   ```

3. **Build** the images (several minutes the first time):
   ```powershell
   docker compose --env-file beta.env -f compose.beta.yml build
   ```

4. **Free port 8088.** The Cloudflare placeholder page holds it until now:
   ```powershell
   docker rm -f ilt-beta-hello
   ```

5. **Start, create the database and load the reference data** (languages, domains, regions, settings, canvases, day plans, the instruction videos). The seed creates **no** accounts in this stack:
   ```powershell
   docker compose --env-file beta.env -f compose.beta.yml up -d
   docker compose --env-file beta.env -f compose.beta.yml run --rm ops src/migrate.ts
   docker compose --env-file beta.env -f compose.beta.yml run --rm ops src/seed.ts
   docker compose --env-file beta.env -f compose.beta.yml restart gateway analytics
   ```
   If the seed stops with "... is a Git LFS pointer; run git lfs pull first", the two instruction videos were not downloaded with the repository: run `git lfs pull` in the repository folder, then `build` (step 3) and the seed again.

6. **The first System Administrator.** The password is typed hidden and passed through the environment, never on the command line. Change the email and name:
   ```powershell
   $env:ILT_USER_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host 'Password, 12+ characters' -AsSecureString)).Password
   docker compose --env-file beta.env -f compose.beta.yml run --rm -e ILT_USER_EMAIL=yakig@penflow.com -e "ILT_USER_NAME=Beta Administrator" -e ILT_USER_ROLE=ADMIN -e ILT_USER_PASSWORD ops src/create-user.ts
   Remove-Item Env:ILT_USER_PASSWORD
   ```
   Then sign in at `http://127.0.0.1:8088/cockpit/` and create the testers' accounts under **Admin → Users** (evaluators, a researcher, analysts). A Research Director, who needs a 6-digit director PIN, is created the same way as the administrator, with `-e ILT_USER_ROLE=RESEARCHER -e ILT_USER_PIN` and `$env:ILT_USER_PIN` set first.

7. **Check** (section *Checks* below), then invite the testers in Cloudflare Access.

## Everyday commands

| What | Command |
|---|---|
| Status | `docker compose --env-file beta.env -f compose.beta.yml ps` |
| Logs of the gateway | `docker compose --env-file beta.env -f compose.beta.yml logs --tail 100 gateway` |
| Stop the beta (data kept) | `docker compose --env-file beta.env -f compose.beta.yml stop` |
| Start it again | `docker compose --env-file beta.env -f compose.beta.yml up -d` |
| Take it off the internet at once (Administrator PowerShell) | `Stop-Service cloudflared` (back with `Start-Service cloudflared`) |

The containers start again by themselves after a restart of NucBox or Docker Desktop (`restart: unless-stopped`).

## Add the landing page to a running beta

The landing page is on the branch `landing-page` (the beta branch plus the landing page; no database change). Only the web front is rebuilt:

```powershell
git fetch origin
git checkout landing-page
git pull
docker compose --env-file beta.env -f compose.beta.yml build web
docker compose --env-file beta.env -f compose.beta.yml up -d web
```

Back to the previous front page: `git checkout phase-6b-prime-beta`, then the same `build web` and `up -d web`.

## Update the running beta to the branch `beta`

The branch `beta` carries the changes asked for during the beta: **Show again** for the intro video, the Hebrew intro video version 2 (with the arc), the English intro video, the Japanese user guides and the landing page changes. No database migration; the seed adds the new video version and keeps the old one as Retired:

```powershell
git fetch origin
git checkout beta
git pull
git lfs pull
docker compose --env-file beta.env -f compose.beta.yml build
docker compose --env-file beta.env -f compose.beta.yml up -d
docker compose --env-file beta.env -f compose.beta.yml run --rm ops src/seed.ts
```

The seed prints `Uploaded intro/he version 2` and `Uploaded intro/en version 1` for videos it has not loaded yet. Sessions planned from then on, and video steps not yet played, show the new video.

## Upgrade to a new release

```powershell
git fetch --tags
git checkout beta-2
notepad beta.env        # BETA_TAG=beta-2
docker compose --env-file beta.env -f compose.beta.yml build
docker compose --env-file beta.env -f compose.beta.yml up -d
docker compose --env-file beta.env -f compose.beta.yml run --rm ops src/migrate.ts
docker compose --env-file beta.env -f compose.beta.yml restart gateway analytics
```

The data stays in the `ilt-beta` volumes. Go back to development afterwards with `git checkout main`; the running beta keeps the images it was built from.

## Reset (delete all beta data)

This deletes every beta participant, session, pen sample and account. It cannot be undone.

```powershell
docker compose --env-file beta.env -f compose.beta.yml down -v
```

Then repeat *First install* from step 5.

## Checks

**One command checks everything on NucBox** (it only reads, and changes nothing): Docker and the five containers, the health checks, the three apps, the database (migrations, reference data, videos, accounts, no development accounts, no Japanese), the `cloudflared` service and the Cloudflare sign-in, and that NucBox does not sleep. Every line says PASS, WARN or FAIL, with what to do for each FAIL:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\Yaki\Documents\GitHub\ILT_Project_2026\infra\beta\check-beta.ps1
```

The same checks by hand, on NucBox:

```powershell
curl.exe -s http://127.0.0.1:8088/api/v1/health
curl.exe -s http://127.0.0.1:8088/analytics/api/v1/health
```

Both answer with `"status":"ok"`. Then from **another device** (not NucBox), through Cloudflare:

1. `https://beta.ilt.network/`: Cloudflare email code, then the landing page. **Login → Evaluator** opens the ILT sign-in of the cockpit. Create a made-up participant (`BETA-001`) and a session.
2. `https://beta.ilt.network/tablet/` on a DTH-A116 (choose **Pen**) and on a touch tablet (choose **Touch screen**, then **Set the screen size** once with a bank card). Pair with the session code and write one block.
3. The touch session shows the "Touch screen" label in the cockpit; `https://beta.ilt.network/analyst/` loads and lists only pen sessions.
4. Five wrong tablet codes from one device lock that device for 15 minutes; another tester's device can still pair.

The full list is `Documents/04_Development_Plan/ILT_Phase6b-prime_Beta_QA_Scenarios.md`.

## Not in the beta

- **Cameras and hand video:** no camera relay runs, and camera features stay off.
- **The analytics service** is not reachable from outside: it has no sign-in of its own, and only the gateway calls it. Only its health check is published.
- **Real children's data:** waits for the pilot installation (Phase 6c) and the ethics checks (Phase 6e).
