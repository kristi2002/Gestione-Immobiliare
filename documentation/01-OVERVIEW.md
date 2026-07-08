# 01 — Project Overview

> **Project:** Gestionale Immobiliare (real-estate agency management platform)
> **Client:** Orlandi Immobiliare, Civitanova Marche (Italy)
> **Live at:** https://testdemo.it
> **Consolidated from:** README, docs/README, docs/ARCHITECTURE, docs/PRODUCTION_READINESS, CLAUDE.md
> **Last source update:** June 2026

---

## What it is

A web-based admin dashboard for a real-estate agency to manage the full operational
lifecycle: property **owners** (proprietari), **listings** (immobili), **documents**,
**tenant leases** (inquilini), **communications**, **reminders/maintenance**,
**finances** (payments, invoices, expenses, commissions), and **social media** — plus
two self-service portals (one for tenants, one for owners).

Built as a **classic PHP monolith** with a **MySQL** backend and a **vanilla-JavaScript
single-page-app** frontend loaded via AJAX. No frontend framework, no build step.

---

## Three login surfaces

| Portal | Entry | Session cookie | Users table |
|--------|-------|----------------|-------------|
| **Admin** | `login.php` → `index.php` | admin cookie — see note below | `admin_users` |
| **Tenant** | `tenant/login.php` → `tenant/index.php` | `gestionale_tenant_session` | `tenant_users` + `tenants` |
| **Owner** | `owner/login.php` → `owner/index.php` | owner session (`$_SESSION['owner_*']`) | `clients.portal_*` columns |

Isolation between the three surfaces is the central security property of the app.

> ⚠️ **Cookie-name discrepancy to resolve from a live login:** `ARCHITECTURE.md` calls the
> admin cookie `gestionale_session`; `DEPLOY.md` sets `SESSION_NAME=gi_session`. Confirm the
> real value against a running instance before scripting any auth test. See
> [07-AUTHENTICATION-SECURITY.md](07-AUTHENTICATION-SECURITY.md).

---

## Tech stack

| Layer | Technology | Status |
|-------|------------|--------|
| Runtime | PHP 8.3 (Apache + `mod_rewrite`, `mod_headers`) | ✅ |
| Database | MySQL 8 (InnoDB, `utf8mb4_unicode_ci`) — Coolify container named `default` | ✅ |
| Frontend | HTML partials + CSS + vanilla JS SPA (no framework) | ✅ |
| Auth | PHP sessions (separate cookies per portal), bcrypt password hashing, optional TOTP 2FA | ✅ |
| Config | Coolify env vars (prod) / `.env` file (local) + `app_settings` DB table | ✅ |
| Hosting | Hetzner VPS → Coolify → Docker → Traefik | ✅ |
| DNS | Cloudflare (`testdemo.it` → `91.99.137.240`) | ✅ |
| TLS | Let's Encrypt via Traefik | ✅ |
| Email | Mailgun SMTP EU (`smtp.eu.mailgun.org:587`, STARTTLS) | ✅ |
| WhatsApp | Twilio **sandbox** | ⚠️ demo-only |
| Social | Meta Graph API — Facebook ✅ / Instagram ✅ (requires image) — **Development mode** | ⚠️ dev-only |
| Payments | Stripe — code ready, **not configured** | ⚠️ |
| Backup | Cloudflare R2 / S3-compatible | 🔄 in progress |
| PDF | `lib/SimplePdf.php` (vendored, no external dep) | ✅ |

---

## Repository top-level layout

```
├── index.php / login.php / logout.php / setup.php   # Admin shell + auth
├── view.php                 # Auth-gated HTML partial loader
├── branding.css.php         # Dynamic CSS vars from DB settings
├── meta_oauth.php / meta_callback.php               # Meta OAuth
├── api/                     # 59 JSON REST-style endpoints (one file per resource)
├── assets/  (css/ + js/)    # Global styles + per-module JS (app.js router)
├── config/                  # 24 PHP service files (bootstrap, db, auth, roles, integrations)
├── cron/                    # 5 CLI cron scripts (blocked from web)
├── database/                # schema.sql, schema_production.sql, migrations/ (phase3–phase28)
├── docker/                  # Docker build assets
├── docs/                    # Original source documentation
├── documentation/           # ← THIS consolidated 10-file set
├── ecommerce/               # Undocumented sub-area (not covered by source docs)
├── lib/                     # SimplePdf and shared libraries
├── owner/                   # Owner portal (login + dashboard + report + logout + auth)
├── scripts/                 # docker-up.ps1 and helpers
├── tenant/                  # Tenant portal (login + dashboard)
├── tests/                   # PHPUnit 11 suite (Unit/)
├── uploads/                 # User-uploaded files (logos, documents, media)
└── views/                   # 44 HTML partials (only reachable via view.php)
```

Sensitive paths (`config/`, `database/`, `cron/`, `backups/`, `.env`) are blocked by root
`.htaccess`. `views/` has its own deny rule. `uploads/.htaccess` blocks PHP execution but
**does not require auth** — files are otherwise publicly served (a known liability).

---

## Status summary (June 2026)

```
✅ App live at https://testdemo.it
✅ MySQL 8 (Coolify container "default")
✅ Email via Mailgun EU (STARTTLS :587)
✅ WhatsApp via Twilio sandbox (demo-only)
✅ Facebook + Instagram via Meta Graph API (Development mode)
✅ HTTPS via Let's Encrypt (Traefik)
✅ Cloudflare DNS
✅ Cron jobs configured on VPS (per GAPS.md — verify against /var/log/gestione-cron.log)
🔄 Cloudflare R2 backup: in progress
⚠️ Stripe: code ready, not configured
❌ Automated tests beyond unit stubs, CI, monitoring, GDPR layer: absent
```

### Honest selling posture (from CLAUDE.md §9)
The core **CRUD + documents + reminders + PDF** is the genuinely working product.
**WhatsApp / Social / Stripe** are sandbox / dev / unconfigured and should be presented as
*"in attivazione,"* not "working." The **public `uploads/` exposure** should be closed before
real client documents are placed in front of a real client.

---

## The 10-file documentation set

| File | Contents |
|------|----------|
| [01-OVERVIEW.md](01-OVERVIEW.md) | This file — project, stack, layout, status |
| [02-ARCHITECTURE.md](02-ARCHITECTURE.md) | Request flow, SPA design, config service layer, sequence diagrams |
| [03-FEATURES-MODULES.md](03-FEATURES-MODULES.md) | All 33 modules, key concepts, connections, platform gaps |
| [04-DATABASE-SCHEMA.md](04-DATABASE-SCHEMA.md) | 40 tables, ERD, table details, constraints |
| [05-DATABASE-INDEXING.md](05-DATABASE-INDEXING.md) | Indexing strategy, index inventory, composite rationale |
| [06-API-REFERENCE.md](06-API-REFERENCE.md) | Every endpoint, conventions, rate limits, cron triggers |
| [07-AUTHENTICATION-SECURITY.md](07-AUTHENTICATION-SECURITY.md) | Auth, roles, isolation, security model, GDPR |
| [08-INTEGRATIONS.md](08-INTEGRATIONS.md) | Email, WhatsApp, Meta, Stripe, backup + WhatsApp Cloud migration plan |
| [09-DEPLOYMENT-OPERATIONS.md](09-DEPLOYMENT-OPERATIONS.md) | Infra, env vars, Docker, migrations, cron, troubleshooting |
| [10-ROADMAP-GAPS-VERIFICATION.md](10-ROADMAP-GAPS-VERIFICATION.md) | Gap register, roadmap, verification protocol, discrepancies |
