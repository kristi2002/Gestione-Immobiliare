# Documentation Index — Gestione Immobiliare

> **Live:** https://testdemo.it | **Server:** Hetzner VPS + Coolify | **Last updated:** June 2026

This folder contains all project documentation.

---

## Documents

| File | Description |
|------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, tech stack, request flow, class diagrams, sequence diagrams for all integrations |
| [DATABASE.md](./DATABASE.md) | Full ERD (40 tables), table descriptions, relationships, indexes |
| [DEPLOY.md](./DEPLOY.md) | How to deploy on Hetzner/Coolify, env vars, DNS setup, cron jobs, troubleshooting |
| [INTEGRATIONS.md](./INTEGRATIONS.md) | Mailgun, Twilio WhatsApp, Meta Graph API, Stripe, Cloudflare R2 — setup status and known issues |
| [MODULES.md](./MODULES.md) | All 33 application modules described |
| [GAPS.md](./GAPS.md) | Known bugs, security gaps, missing features — with severity ratings and fixes |
| [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md) | Security checklist, deployment checklist (Italian) |
| [MIGRATIONS.md](./MIGRATIONS.md) | Database migration history and how to run migrations |

---

## Quick status

```
✅ App live at https://testdemo.it
✅ MySQL 8 (Coolify container "default")
✅ Email via Mailgun EU (STARTTLS :587)
✅ WhatsApp via Twilio sandbox
✅ Facebook + Instagram via Meta Graph API
✅ HTTPS via Let's Encrypt (Traefik)
✅ Cloudflare DNS

⚠️  URGENT: Change ADMIN_PASSWORD (currently "admin")
⚠️  URGENT: Change CRON_SECRET (currently placeholder)
⚠️  URGENT: Set up cron jobs on server
⚠️  Twilio webhook has no signature validation
🔄  Cloudflare R2 backup: in progress
```

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
| WhatsApp | Twilio |
| Social | Meta Graph API |
| Payments | Stripe (ready, not configured) |
