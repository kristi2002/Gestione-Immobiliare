# Gestionale Immobiliare

Web-based admin dashboard for real estate agencies. Manage property owners, listings, documents, tenant leases, communications, reminders, and social media — with a separate portal for tenants.

**Stack:** PHP 8+ · MySQL · Apache · Vanilla JavaScript (no build step)

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

## Requirements

- PHP 8.0+ with extensions: `pdo_mysql`, `json`, `mbstring`, `openssl`
- MySQL 8+ or MariaDB 10.4+
- Apache with `mod_rewrite` (or equivalent URL routing)
- Composer **not** required

---

## Quick start (local)

### 1. Clone and configure

```bash
git clone <repository-url> gestionale
cd gestionale
cp .env.example .env
```

Edit `.env` with your database credentials. For MAMP, defaults are usually fine:

```env
DB_HOST=localhost
DB_NAME=gestione_immobiliare
DB_USER=root
DB_PASS=root
APP_URL=http://localhost/gestionale
SETUP_ENABLED=true
```

> **Windows + OneDrive:** Apache can fail when the project lives under OneDrive. Copy the folder to your web root instead, e.g. `C:\MAMP\htdocs\gestionale`.

### 2. Create the database

**Fresh install (recommended):**

```bash
mysql -u root -p < database/schema_production.sql
```

**Existing database (upgrade):** run migrations in order — see [database/migrations/README.md](database/migrations/README.md).

### 3. Create the admin user

1. Open `http://localhost/gestionale/setup.php`
2. Set username and password (min. 8 characters)
3. Set `SETUP_ENABLED=false` in `.env` after setup completes

### 4. Log in

Open `http://localhost/gestionale/` and sign in with the credentials you created.

**Tenant portal:** `http://localhost/gestionale/tenant/login.php` (credentials are set when creating a tenant in the admin UI).

---

## Configuration

| Source | Used for |
|--------|----------|
| `.env` | Database, secrets, bootstrap flags, integration fallbacks |
| **Impostazioni** UI | Branding, SMTP, Twilio, S3 backup, Meta app ID (stored in `app_settings`) |

Copy [`.env.example`](.env.example) as a reference for all available variables.

Key production settings:

```env
APP_ENV=production
APP_DEBUG=false
FORCE_HTTPS=true
SETUP_ENABLED=false
CRON_SECRET=<long-random-string>
```

---

## Cron jobs

Run via CLI (preferred) or HTTP with `CRON_SECRET`.

| Job | Suggested schedule | Script |
|-----|-------------------|--------|
| Reminders | Every 15 min | `php cron/process_reminders.php` |
| Social posts | Every 10 min | `php cron/publish_social_posts.php` |
| DB backup | Daily | `php cron/backup_database.php` |

HTTP trigger example:

```bash
curl -H "X-Cron-Secret: YOUR_SECRET" https://your-domain.com/api/process_reminders.php
```

---

## Project structure

```
api/           JSON endpoints (one file per resource)
assets/        CSS and JavaScript
config/        Bootstrap, auth, DB, integrations
cron/          CLI background jobs
database/      Schema and migrations
tenant/        Tenant portal (separate session)
uploads/       Documents, media, logos
views/         HTML partials (loaded via view.php)
index.php      Admin app shell
```

---

## Documentation

| Document | Contents |
|----------|----------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the app works — request flow, auth, APIs, data model |
| [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) | Production checklist, security, deploy guide (Italian) |
| [database/migrations/README.md](database/migrations/README.md) | Migration order for existing databases |

---

## User roles

| Role | Access |
|------|--------|
| `super_admin` | Full access including Settings and user management |
| `admin` | All modules except Settings |
| `agent` | Day-to-day operations (no Social, no Settings) |
| `readonly` | View only — writes are blocked |

---

## Security notes

- `.htaccess` blocks direct web access to `config/`, `database/`, `cron/`, and `.env`
- HTML views are served only through authenticated `view.php`
- API endpoints require a valid admin session (401 otherwise)
- Never commit `.env` or `.setup_complete` to version control

For the full production hardening checklist, see [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).

---

## License

Private / internal use — add a license file if you plan to distribute this project.
