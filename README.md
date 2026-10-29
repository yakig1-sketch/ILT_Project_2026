# ILT Research System

An open-source, non-commercial research and intervention platform built around the **Invented Letter Task (ILT)**. Children write an invented letter on a Wacom DTH-A116 pen tablet while an evaluator watches a live mirror. The system measures handwriting learning (speed, accuracy and pen lifts) across sessions and supports the follow-up intervention program with real letters. Hebrew (right-to-left) and English.

- **Specifications:** [FRS v3.5](Documents/01_Requirements/ILT_Functional_Requirements_Specification_v3.5_EN.md) · [Architecture v5.6](Documents/02_System_Architecture/ILT_System_Architecture_and_Specifications_v5.6_EN.md) · [DDD v1.6](Documents/03_Detailed_Design/ILT_Detailed_Design_Specification_v1.6_EN.md) · [Clinical Decisions Register](Documents/04_Development_Plan/ILT_Clinical_Decisions_2026-10-25.md)
- **All project documents:** [Documents/](Documents/README.md)

## Status

Phase 0 (foundations) is in place: monorepo, database schema, scoring engine, binary pen protocol, settings catalogue, translations, and skeletons of the services and apps. Phase 1 (pairing, pen capture, live mirror, persistence) is next.

## Repository layout

| Path | What it is |
|---|---|
| `apps/tablet-kiosk` | Child's tablet app (React + Vite). Phase 0: true-size ILT page preview |
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

Python analytics (from `services/analytics`, in a virtual environment): `pip install -e ".[dev]"` then `pytest`.

## License

To be decided.
