# Documentation Index — Gestione Immobiliare

> **Project:** Gestionale Immobiliare (Orlandi Immobiliare, Civitanova Marche)
> **Stack:** PHP 8.3 + MySQL 8 + Apache · vanilla-JS SPA · three login portals (admin / tenant / owner)
> **Live:** https://testdemo.it · Hetzner VPS + Coolify

All project documentation lives under `docs/`, organised into themed subfolders.
Filenames are stable — other project files reference these docs by name, so only
their folder location changed. Start with the **Guides** set below for a curated,
top-to-bottom read; the themed subfolders hold the deeper, source-of-truth docs.

---

## Guides — curated walkthrough (`docs/guides/`)

A numbered 10-part set meant to be read in order; the best entry point for someone new.

| Guide | Contents |
|-------|----------|
| [01 — Overview](./guides/01-OVERVIEW.md) | Project, stack, repo layout, status |
| [02 — Architecture](./guides/02-ARCHITECTURE.md) | Request flow, SPA design, config service layer, sequence diagrams |
| [03 — Features & Modules](./guides/03-FEATURES-MODULES.md) | All 33 modules, key concepts, connections, platform gaps |
| [04 — Database Schema](./guides/04-DATABASE-SCHEMA.md) | 40 tables, ERD, table details, constraints |
| [05 — Database Indexing](./guides/05-DATABASE-INDEXING.md) | Indexing strategy, index inventory, composite rationale |
| [06 — API Reference](./guides/06-API-REFERENCE.md) | Every endpoint, conventions, rate limits, cron triggers |
| [07 — Authentication & Security](./guides/07-AUTHENTICATION-SECURITY.md) | Auth, roles, isolation, security model, GDPR |
| [08 — Integrations](./guides/08-INTEGRATIONS.md) | Email, WhatsApp, Meta, Stripe, backup + WhatsApp Cloud migration plan |
| [09 — Deployment & Operations](./guides/09-DEPLOYMENT-OPERATIONS.md) | Infra, env vars, Docker, migrations, cron, troubleshooting |
| [10 — Roadmap, Gaps & Verification](./guides/10-ROADMAP-GAPS-VERIFICATION.md) | Gap register, roadmap, verification protocol, discrepancies |

---

## Architecture (`docs/architecture/`)

| Doc | Description |
|-----|-------------|
| [ARCHITECTURE.md](./architecture/ARCHITECTURE.md) | System design, tech stack, request flow, class & sequence diagrams for all integrations |
| [FUTURE_ARCHITECTURE.md](./architecture/FUTURE_ARCHITECTURE.md) | Target/future-state architecture direction |
| [DATABASE.md](./architecture/DATABASE.md) | Full ERD (40 tables), table descriptions, relationships, indexes |
| [INDEXING.md](./architecture/INDEXING.md) | Database indexing strategy and rationale |
| [MODULES.md](./architecture/MODULES.md) | All 33 application modules described |

## API (`docs/api/`)

| Doc | Description |
|-----|-------------|
| [API.md](./api/API.md) | Full REST endpoint reference, conventions, auth, rate limits |

## Deployment (`docs/deployment/`)

| Doc | Description |
|-----|-------------|
| [DEPLOY.md](./deployment/DEPLOY.md) | How to deploy on Hetzner/Coolify, env vars, DNS, cron, troubleshooting |
| [DEPLOYMENT_PLAN.md](./deployment/DEPLOYMENT_PLAN.md) | Master deployment / go-live plan |
| [MIGRATIONS.md](./deployment/MIGRATIONS.md) | Database migration history and how to run migrations |
| [PRODUCTION_READINESS.md](./deployment/PRODUCTION_READINESS.md) | Security & deployment readiness checklist (Italian) |

## Integrations (`docs/integrations/`)

| Doc | Description |
|-----|-------------|
| [INTEGRATIONS.md](./integrations/INTEGRATIONS.md) | Mailgun, Twilio WhatsApp, Meta Graph API, Stripe, Cloudflare R2 — setup status and known issues |
| [PORTAL_INTEGRATION.md](./integrations/PORTAL_INTEGRATION.md) | Tenant/owner portal integration notes |
| [WHATSAPP_MIGRATION_PLAN.md](./integrations/WHATSAPP_MIGRATION_PLAN.md) | Plan to move WhatsApp off the Twilio sandbox to a Business number |

## Security & Compliance (`docs/security/`)

| Doc | Description |
|-----|-------------|
| [GDPR.md](./security/GDPR.md) | GDPR posture, legal basis, retention, DPA notes |
| [UPLOADS_SECURITY.md](./security/UPLOADS_SECURITY.md) | `uploads/` exposure hardening and path-containment guard |

## Planning (`docs/planning/`)

| Doc | Description |
|-----|-------------|
| [GAPS.md](./planning/GAPS.md) | Known bugs, security gaps, missing features — with severity ratings and fixes |
| [ROADMAP_KILLER_FEATURES.md](./planning/ROADMAP_KILLER_FEATURES.md) | Roadmap of high-impact ("killer") features |
| [FEATURE_IMPLEMENTATION_PLAN.md](./planning/FEATURE_IMPLEMENTATION_PLAN.md) | Implementation plan for planned features |

## Reports (`docs/reports/`)

| Doc | Description |
|-----|-------------|
| [VERIFICATION_REPORT.md](./reports/VERIFICATION_REPORT.md) | Verification-run results against the app |
| [DRY_RUN_2026-07-12.md](./reports/DRY_RUN_2026-07-12.md) | Demo/deploy dry-run log (2026-07-12) |
| [CHANGES_2026-07.md](./reports/CHANGES_2026-07.md) | Change log for July 2026 |

---

## Tech stack summary

| Layer | Technology |
|-------|------------|
| Runtime | PHP 8.3 + Apache |
| Database | MySQL 8 |
| Frontend | Vanilla JS SPA (no framework) |
| Hosting | Hetzner VPS + Coolify |
| Proxy | Traefik (coolify-proxy) |
| DNS | Cloudflare |
| Email | Mailgun EU |
| WhatsApp | Twilio (sandbox — demo only) |
| Social | Meta Graph API (development mode) |
| Payments | Stripe (code ready, not configured) |
