# Deployment Guide

How to run **Gestionale Immobiliare** without MAMP — locally with Docker, and in production on Render (or any Docker host).

---

## Option A — Local development (Docker)

Replaces MAMP entirely. You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed.

### 1. One-time setup

```powershell
cd "C:\Users\krsit\OneDrive\Desktop\Gestione Immobiliare"
copy .env.docker.example .env.docker
```

### 2. Start the stack

```powershell
docker compose up --build
```

**Live reload during development** — edits to PHP, JS, CSS, and HTML sync automatically:

```powershell
docker compose watch
```

Or: `docker compose up --build --watch`

Wait until you see the app container running (MySQL healthcheck passes first).

### 3. Open the app

| Page | URL |
|------|-----|
| **Admin** | http://localhost:8090/ |
| **Setup** (first time) | http://localhost:8090/setup.php |
| **Login** | http://localhost:8090/login.php |
| **Tenant portal** | http://localhost:8090/tenant/login.php |

### 4. First admin user

1. Visit http://localhost:8090/setup.php
2. Create username + password (min. 8 chars)
3. Log in at http://localhost:8090/

### 5. Stop

```powershell
docker compose down
```

Data persists in Docker volumes (`db_data`, `uploads_data`). To wipe everything: `docker compose down -v`

---

## Option B — Production on Render

### What you need

| Component | Provider |
|-----------|----------|
| **Web app** | Render (Docker web service) |
| **MySQL 8** | External — Render has Postgres only. Use [PlanetScale](https://planetscale.com), [Aiven](https://aiven.io/mysql), [DigitalOcean Managed MySQL](https://www.digitalocean.com/products/managed-databases-mysql), or [Railway](https://railway.com). |
| **File uploads** | Render persistent disk (included in `render.yaml`) |
| **DB backups** | S3-compatible bucket (configure in Impostazioni or env vars) |

### Deploy steps

1. **Push code** to GitHub (repo: `kristi2002/Gestione-Immobiliare`)

2. **Create MySQL database** on your provider and import schema:
   ```bash
   mysql -h YOUR_HOST -u USER -p < database/schema_production.sql
   ```

3. **Open Render Blueprint:**
   ```
   https://dashboard.render.com/blueprint/new?repo=https://github.com/kristi2002/Gestione-Immobiliare
   ```

4. **Fill secret env vars** in the Render Dashboard:

   | Variable | Example |
   |----------|---------|
   | `APP_URL` | `https://gestionale-immobiliare.onrender.com` |
   | `APP_SECRET` | 32+ random characters |
   | `CRON_SECRET` | 32+ random characters |
   | `DB_HOST` | Your MySQL host |
   | `DB_NAME` | `gestione_immobiliare` |
   | `DB_USER` | DB username |
   | `DB_PASS` | DB password |
   | `ADMIN_USERNAME` | `admin` |
   | `ADMIN_PASSWORD` | Strong password for setup |

5. Click **Apply** and wait for deploy (~5–10 min first build).

6. **Run setup once:**
   - Visit `https://YOUR-APP.onrender.com/setup.php`
   - Create admin account
   - Set `SETUP_ENABLED=false` in Render env vars

7. **Configure integrations** in Impostazioni (SMTP, Twilio, Meta, S3 backup).

### Cron jobs (automatic)

`render.yaml` provisions three cron services:

| Job | Schedule | Script |
|-----|----------|--------|
| Reminders | Every 15 min | `cron/process_reminders.php` |
| Social posts | Every 10 min | `cron/publish_social_posts.php` |
| DB backup | Daily 03:00 UTC | `cron/backup_database.php` |

Enable **cloud backup** (`BACKUP_CLOUD_ENABLED=true` + S3 credentials) — local backup files on Render are ephemeral.

### Custom domain

1. Render Dashboard → your web service → **Settings** → **Custom Domains**
2. Add `gestionale.tuaagenzia.it`
3. Update DNS (CNAME to Render)
4. Set `APP_URL=https://gestionale.tuaagenzia.it`
5. Set `FORCE_HTTPS=true` (already in blueprint)

---

## Option C — VPS (any Linux server)

Same Docker image, no Render:

```bash
# On the server
git clone https://github.com/kristi2002/Gestione-Immobiliare.git
cd Gestione-Immobiliare
cp .env.docker.example .env.docker
# Edit .env.docker: production values, external DB host, APP_URL, secrets

docker compose up -d --build
```

Put **Nginx** or **Caddy** in front for HTTPS:

```
your-domain.it → reverse proxy → localhost:8090
```

Schedule cron on the host:

```cron
*/15 * * * * docker compose exec -T app php /var/www/html/cron/process_reminders.php
```

---

## Production checklist

```env
APP_ENV=production
APP_DEBUG=false
FORCE_HTTPS=true
SETUP_ENABLED=false
APP_URL=https://your-real-domain.com
```

**Security**
- [ ] Strong `APP_SECRET` and `CRON_SECRET` (32+ char hex — `php -r "echo bin2hex(random_bytes(32));"`)
- [ ] Dedicated DB user (not root)
- [ ] Change default admin password after first login
- [ ] Enable 2FA on all admin accounts (Settings → Sicurezza 2FA)
- [ ] Block `.env` from web access (Apache: `<Files ".env"> Require all denied </Files>`)
- [ ] Uploads directory not executable by PHP

**Database migrations** — run ALL in order (they are idempotent):
```bash
for f in 000_helpers phase3 phase4 phase5 phase6 phase7 phase8 phase9 phase10 phase11 phase12 phase13 phase14_email_templates; do
  mysql -u USER -p DBNAME < database/migrations/${f}.sql
done
```

**Directories** — must exist and be writable by the web server:
```bash
mkdir -p uploads/{properties,documents/generated,social,branding} backups logs
chown -R www-data:www-data uploads/ backups/ logs/
```

**Cron jobs** (every environment):
```cron
*/5 * * * *  php /path/cron/process_reminders.php
0 8   * * *  php /path/cron/process_contract_expirations.php
0 */6 * * *  php /path/cron/publish_social_posts.php
0 3   * * *  php /path/cron/backup_database.php
```

**Post-login setup** (in app Settings):
- [ ] Branding — agency name, logo, primary colour
- [ ] Email SMTP — host/user/password, test send
- [ ] WhatsApp — Twilio credentials (optional)
- [ ] Backup cloud — S3 credentials (required on Render — ephemeral disk)
- [ ] Meta OAuth redirect URL updated to production domain
- [ ] Create agent and readonly user accounts

**Go-live smoke test:**
- [ ] `https://yourdomain.com/login.php` loads
- [ ] Admin login works
- [ ] Create client + property + reminder → confirm they save
- [ ] Upload a document → confirm download works
- [ ] Map view loads with Leaflet
- [ ] Tenant portal login works (`/tenant/login.php`)
- [ ] Owner portal login works (`/owner/login.php`)
- [ ] Test email sends from Settings

Full security checklist: [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `docker compose` not found | Install Docker Desktop, restart terminal |
| DB connection error | Wait for MySQL healthcheck; check `DB_HOST=db` in `.env.docker` |
| 403 on setup | Set `SETUP_ENABLED=true`; delete `.setup_complete` if re-running |
| Uploads lost after Render deploy | Disk must be attached (`render.yaml` includes 1 GB disk) |
| Blank page | Set `APP_DEBUG=true` temporarily, check Render logs |
