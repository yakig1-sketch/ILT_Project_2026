# ILT Research System

An open-source, non-commercial research and intervention platform built around the **Invented Letter Task (ILT)**. Children write an invented letter on a Wacom DTH-A116 pen tablet while an evaluator watches a live mirror. The system measures handwriting learning (speed, accuracy and pen lifts) across sessions and supports the follow-up intervention program with real letters. Hebrew (right-to-left) and English.

- **Specifications:** [FRS v3.5](Documents/01_Requirements/ILT_Functional_Requirements_Specification_v3.5_EN.md) · [Architecture v5.6](Documents/02_System_Architecture/ILT_System_Architecture_and_Specifications_v5.6_EN.md) · [DDD v1.6](Documents/03_Detailed_Design/ILT_Detailed_Design_Specification_v1.6_EN.md) · [Clinical Decisions Register](Documents/04_Development_Plan/ILT_Clinical_Decisions_2026-10-25.md)
- **All project documents:** [Documents/](Documents/README.md)

## Status

Phases 0–2 are in place. An evaluator signs in to the cockpit, creates a participant and a session, and pairs the tablet with a 6-digit PIN. A Day 1, Day 2 or Day 14 session runs start to finish: instruction videos play on the tablet in the session language, writing blocks run with the inactivity cue, and the evaluator watches a live mirror with live telemetry. Every pen sample is saved and checked (SHA-256), with nothing lost if the network drops. Each block is measured and scored as soon as it is stored; blocks can be repeated; Day 2 paper notebook pages are timed in the cockpit. The Comparative Summary shows the anchor pairs with their component scores, composite and Pass/Fail, with Replay. Phase 3 (administration) is next.

To try it without the tablet, run the gateway, cockpit and kiosk (below); development builds accept the mouse as a pen.

## Repository layout

| Path | What it is |
|---|---|
| `apps/tablet-kiosk` | Child's tablet app (React + Vite): PIN pairing, true-size canvas, pen capture, offline buffer |
| `apps/evaluator-cockpit` | Evaluator cockpit and administration (React + Vite) |
| `apps/analyst-portal` | De-identified research portal (React + Vite) |
| `services/telemetry-gateway` | REST/WebSocket gateway (Node + Fastify): persistence, scoring, application log |
| `services/analytics` | Python 3.12 + FastAPI + DuckDB: kinematics, exports, legacy import |
| `packages/shared-types` | Pen sample, enums, control-event contracts, log vocabulary, settings catalogue |
| `packages/emr-protocol` | Binary telemetry packet codec with CRC-16 |
| `packages/ilt-metrics` | Scoring engine: letter segmentation, dot hits, speed, pen lifts, composite |
| `packages/template-schemas` | Canvas, scoring-profile and protocol-template schemas; seed canvases |
| `packages/i18n`, `packages/ui` | Hebrew/English translations; shared right-to-left-aware UI |
| `infra/` | Docker Compose (TimescaleDB, SeaweedFS S3, go2rtc), migrations, seed |
| `tools/pen-probe` | Device measurement page used to profile the DTH-A116 |

## Getting started (Windows 11)

Prerequisites: Git, Docker Desktop (WSL2), Node.js 24 LTS, pnpm 9, Python 3.12.

```bash
pnpm install
```

Copy `.env.example` to `.env` and replace every `change-me` value, then start the database and object storage:

```bash
pnpm infra:up
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

Run the gateway and an app (each in its own terminal):

```bash
pnpm --filter @ilt/telemetry-gateway dev
```

```bash
pnpm --filter @ilt/tablet-kiosk dev
```

The kiosk opens at http://localhost:5173, the cockpit at :5174, the analyst portal at :5175; the gateway answers at http://localhost:8080/api/v1/health.

Tests:

```bash
pnpm turbo run build typecheck test
```

The gateway's end-to-end tests (`services/telemetry-gateway/src/phase1.db.test.ts`, `phase2.db.test.ts`) run only when `TEST_DATABASE_URL` points at a migrated and seeded database as the `ilt_app` role; CI sets it. They leave their test participants and sessions (`TEST…` codes) in that database; the Phase 2 test restores the pass threshold it changes.

Python analytics (from `services/analytics`, in a virtual environment): `pip install -e ".[dev]"` then `pytest`.

## License

To be decided.
