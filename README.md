# Gestionale Immobiliare

Web-based admin dashboard for real estate agencies. Manage property owners, listings, documents, tenant leases, communications, reminders, and social media — with a separate portal for tenants.

**Live:** https://testdemo.it | **Stack:** PHP 8.3 · MySQL 8 · Apache · Docker · Vanilla JavaScript

> 📁 **Full documentation is in the [`/docs`](./docs/) folder** — architecture, database ERD, integrations, gaps, and deploy guide.

---

## Run locally (Docker — recommended)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```powershell
cd "Gestione Immobiliare"
copy .env.docker.example .env.docker
.\scripts\docker-up.ps1
```

> **OneDrive users:** use `scripts\docker-up.ps1` — copies to `%LOCALAPPDATA%` before build (fixes Docker + OneDrive errors).

**With live reload** (syncs PHP/JS/CSS/HTML changes into the container):

```powershell
.\scripts\docker-up.ps1 watch
```

Or: `.\scripts\docker-up.ps1 up --build --watch`

Or in one command: `docker compose up --build --watch`

| Page | URL |
|------|-----|
| **App** | http://localhost:8090/ |
| **Setup** (first time) | http://localhost:8090/setup.php |
| **Login** | http://localhost:8090/login.php |

Stop with `docker compose down`. Full guide: **[DEPLOY.md](DEPLOY.md)**

> MAMP is **not** required. Docker runs PHP + Apache + MySQL together.

---

## Deploy to production

Use **Render** (Docker) + external **MySQL** — see **[DEPLOY.md](DEPLOY.md)** for step-by-step instructions.

Blueprint: `render.yaml` — apply via:
```
https://dashboard.render.com/blueprint/new?repo=https://github.com/kristi2002/Gestione-Immobiliare
```

---

## Features

| Module | Description |
|--------|-------------|
| **Dashboard** | Overview stats and quick links |
| **Proprietari** | Owner (client) CRM with soft-archive |
| **Immobili** | Properties linked to owners, photo gallery |
| **Documenti** | File uploads (contracts, invoices, IDs) |
| **Comunicazioni** | Email and WhatsApp message history |
| **Promemoria** | Scheduled reminders with automatic email notifications |
| **Inquilini** | Tenant records + dedicated tenant portal |
| **Social Media** | Schedule and publish to Facebook / Instagram (Meta API) |
| **Impostazioni** | Branding, SMTP, WhatsApp, cloud backup, admin users, Meta OAuth |
| **PDF** | Generate contracts and property reports |

**Also included:** multi-user roles (`super_admin`, `admin`, `agent`, `readonly`), responsive mobile UI, session-based auth, cron jobs for reminders/social/backup.

---

## Configuration

| Source | Used for |
|--------|----------|
| `.env` / `.env.docker` | Database, secrets, bootstrap flags |
| **Impostazioni** UI | Branding, SMTP, Twilio, S3 backup, Meta (stored in `app_settings`) |

Production settings:

```env
APP_ENV=production
APP_DEBUG=false
FORCE_HTTPS=true
SETUP_ENABLED=false
APP_URL=https://your-domain.com
```

---

## Documentation

| Document | Contents |
|----------|----------|
| [DEPLOY.md](DEPLOY.md) | Docker local setup + Render/VPS production |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the app works — request flow, auth, APIs |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | Security checklist (Italian) |
| [database/migrations/README.md](database/migrations/README.md) | DB migration order |

---

## License

Private / internal use — add a license file if you plan to distribute this project.
