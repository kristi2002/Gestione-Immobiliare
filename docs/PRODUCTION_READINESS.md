# Guida alla messa in produzione — Gestionale Immobiliare

> ⚠️ **AGGIORNAMENTO 2026-07-10.** Molti punti P1/P2 qui elencati come da fare (CSRF,
> rate limit, firma webhook, cron, `uploads/` pubblico, `DB_USER=root`) sono stati
> **risolti e verificati con evidenze**. Fonti autorevoli aggiornate:
> **`docs/VERIFICATION_REPORT.md`** (stato attuale + test), **`docs/CHANGES_2026-07.md`**
> (tutte le modifiche), **`docs/DEPLOYMENT_PLAN.md`** (log per fasi),
> **`docs/GDPR.md`** (conformità). Considerare le sezioni seguenti come storiche.

Documento di riferimento per capire **cosa è già pronto**, **cosa manca** e **come deployare** l'applicazione in un ambiente reale (agenzia immobiliare).

**Ultimo aggiornamento:** giugno 2026 (superato il 2026-07-10 — vedi banner sopra)  
**Stack:** PHP 8.3 + MySQL 8 + Apache — Hetzner VPS + Coolify + Traefik  
**URL live:** https://immobiliare.testdemo.it ✅ (il dominio nudo testdemo.it non è più collegato all'app: 503)

---

## Sommario esecutivo — Stato attuale (giugno 2026)

L'app è **in produzione** su https://immobiliare.testdemo.it. Le integrazioni principali sono configurate e funzionanti. Rimangono gap di sicurezza critici da risolvere subito (password admin, cron secret, validazione webhook Twilio).

| Area | Stato |
|------|--------|
| Funzionalità core | ✅ Pronta |
| Autenticazione base | ✅ Pronta |
| Deploy su Hetzner/Coolify | ✅ Live |
| DNS (Cloudflare) | ✅ Configurato |
| Email (Mailgun EU) | ✅ Funzionante |
| WhatsApp (Twilio sandbox) | ✅ Funzionante |
| Social (Facebook + Instagram) | ✅ Funzionante |
| HTTPS/SSL (Let's Encrypt via Traefik) | ✅ Attivo |
| Hardening sicurezza | ⚠️ Parziale |
| Cron jobs su server | ⚠️ Non ancora configurati |
| Backup su S3/R2 | 🔄 In corso |
| Stripe payments | ⚠️ Codice pronto, non configurato |
| Test, CI, monitoring | ❌ Assente |
| GDPR / privacy | ❌ Assente |

---

## 1. Cosa è già implementato

### 1.1 Applicazione

- Dashboard con statistiche
- CRUD Proprietari, Immobili (con galleria), Documenti
- Comunicazioni email + WhatsApp (Twilio)
- Promemoria con notifiche email automatiche
- Social Media (Meta API + OAuth Facebook/Instagram)
- Inquilini + portale inquilino
- Generazione PDF (contratti, schede immobile)
- Impostazioni UI: branding, SMTP, WhatsApp, backup cloud, utenti, Meta
- UI responsive per smartphone

### 1.2 Sicurezza (base)

| Funzione | File / nota |
|----------|-------------|
| Login admin con sessione | `login.php`, `config/auth.php` |
| Setup one-time | `setup.php` + `.setup_complete` |
| API protette da sessione | `config/api_bootstrap.php` |
| Cron HTTP protetto da secret | `CRON_SECRET` + header `X-Cron-Secret` |
| Viste HTML non accessibili direttamente | `view.php` + `views/.htaccess` |
| Blocco cartelle sensibili | `.htaccess` root (`config/`, `database/`, `cron/`, `backups/`) |
| Upload: no esecuzione PHP | `uploads/.htaccess` |
| HTTPS forzabile | `FORCE_HTTPS=true` in `.env` |
| Password hash bcrypt | `password_hash()` / `password_verify()` |
| Ruoli utente | `super_admin`, `admin`, `agent`, `readonly` |
| CORS limitato a `APP_URL` | `config/api_helpers.php` |
| Token Meta OAuth con `state` | `meta_oauth.php`, `meta_callback.php` |

### 1.3 Configurazione

- Variabili in `.env` (vedi `.env.example`)
- Impostazioni salvabili anche da DB (`app_settings`) con fallback su `.env`
- Mail SMTP configurabile da UI
- Backup locale + upload S3-compatible opzionale

### 1.4 Database

- Schema completo in `database/schema.sql` (con dati di test)
- Schema produzione senza seed: `database/schema_production.sql` (**da aggiornare**, vedi §3)
- Migrazioni incrementali: `database/migrations/phase3_*.sql` → `phase9_features.sql`

---

## 2. Checklist pre-produzione (obbligatoria)

### P0 — Bloccanti (fare prima del go-live)

- [ ] **Ambiente produzione**
  ```env
  APP_ENV=production
  APP_DEBUG=false
  FORCE_HTTPS=true
  SETUP_ENABLED=false
  APP_URL=https://tuodominio.it/gestionale
  ```
- [ ] **Secret forti** — rigenerare `APP_SECRET`, `CRON_SECRET`, password admin
- [ ] **Database**
  - Creare DB dedicato (non `root`/`root`)
  - Eseguire tutte le migrazioni fino a `phase9_features.sql` **oppure** aggiornare e usare `schema_production.sql` completo
  - Rimuovere dati di test / seed di sviluppo
- [ ] **Setup disabilitato** — verificare che `setup.php` restituisca 403 e che esista `.setup_complete`
- [ ] **HTTPS** — certificato TLS attivo; cookie di sessione `Secure`
- [x] **Fix portale inquilino** — `tenant/login.php` usa `/../config/bootstrap.php`
- [x] **Ruolo readonly** — `requireWriteAccess()` su tutte le API mutanti via `api_bootstrap.php`; job HTTP bloccati per readonly
- [x] **`schema_production.sql` aggiornato** — include fasi 8–9 (ruoli, settings, inquilini, PDF, Meta OAuth)
- [ ] **Hosting non-OneDrive** — su Windows usare una copia fuori da OneDrive (es. `C:\MAMP\htdocs\gestionale` o server Linux). OneDrive blocca Apache.

### P1 — Importante (entro la prima settimana in produzione)

- [ ] **Email reale** — `MAIL_ENABLED=true`, SMTP configurato in Impostazioni, invio test OK
- [ ] **Cron job** sul server (non solo trigger manuale da UI):

  ```cron
  # Promemoria — ogni 15 minuti
  */15 * * * * php /percorso/gestionale/cron/process_reminders.php

  # Social programmati — ogni 10 minuti
  */10 * * * * php /percorso/gestionale/cron/publish_social_posts.php

  # Backup DB — ogni giorno alle 03:00
  0 3 * * * php /percorso/gestionale/cron/backup_database.php
  ```

  Alternativa HTTP (con secret):
  ```bash
  curl -X POST -H "X-Cron-Secret: IL_TUO_SECRET" https://tuodominio.it/gestionale/api/process_reminders.php
  ```

- [ ] **Backup cloud** — abilitare in Impostazioni se usi S3/B2; verificare che un file compaia nel bucket
- [ ] **Test restore backup** — ripristinare un `.sql` su DB di test almeno una volta
- [ ] **Twilio webhook** — se usi WhatsApp, configurare URL webhook e **validare firma Twilio** (oggi `api/whatsapp_webhook.php` accetta qualsiasi POST)
- [ ] **Meta** — App ID/Secret in Impostazioni, redirect OAuth `https://tuodominio.it/gestionale/meta_callback.php`, `META_PUBLIC_BASE_URL` per immagini Instagram
- [ ] **File upload** — `uploads/` è pubblico (solo script PHP bloccati). Valutare proxy autenticato per documenti sensibili
- [ ] **Logo SVG** — disabilitare o sanitizzare (rischio XSS se caricato SVG malevolo)

### P2 — Consigliato (miglioramento continuo)

- [ ] Protezione **CSRF** su form (`login`, `setup`, API mutanti)
- [ ] **Rate limiting** su login e API
- [ ] **Reset password** admin e inquilino
- [ ] **Security headers** (HSTS, `X-Frame-Options`, CSP)
- [ ] **Logging** strutturato + alert su errori cron/backup
- [ ] **Health check** (`/api/health.php` o simile)
- [ ] **Test automatici** (PHPUnit) e pipeline CI
- [ ] Documenti legali GDPR (privacy, cookie, retention)
- [ ] Backup anche dei file in `uploads/` (oggi solo database)

---

## 3. Lacune tecniche note

### 3.1 Sicurezza

| Lacuna | Rischio | Azione suggerita |
|--------|---------|------------------|
| Nessun CSRF su form/API | Medio | Token di sessione su POST |
| Nessun rate limit su login | Medio | Max tentativi per IP |
| `APP_SECRET` non usato nel codice | Basso | Usarlo per firmare token/CSRF o rimuoverlo |
| Webhook WhatsApp senza firma | Alto se esposto | Verifica `X-Twilio-Signature` |
| Upload pubblici in `uploads/` | Medio | Servire file tramite `download_document.php` |
| Account `readonly` può scrivere via API | Medio | `requireWriteAccess()` su tutte le API POST/PUT/DELETE |
| Nessun MFA | Medio | Opzionale per admin |

### 3.2 Database

| Lacuna | Dettaglio |
|--------|-----------|
| `schema_production.sql` obsoleto | ~~Manca fase 8–9~~ **Aggiornato** — usare per fresh install |
| Nessun migration runner | SQL eseguiti manualmente; nessuna tabella `schema_migrations` |
| Nessun pooling | OK per piccolo traffico; valutare per scale |

**Ordine migrazioni su DB esistente:**
```
000_helpers.sql          ← prima (procedure idempotenti)
phase3_property_media.sql
phase4_documents.sql
phase5_communications.sql
phase6_reminder_notifications.sql
phase7_social.sql
phase8_production.sql
phase9_features.sql
```

Vedi `database/migrations/README.md`. Le migrazioni sono **idempotenti** (re-run sicuro).

### 3.3 Integrazioni

| Servizio | Stato senza config | Cosa serve |
|----------|-------------------|------------|
| Email | Modalità simulata | SMTP (Gmail app password, SendGrid, Aruba, ecc.) |
| WhatsApp | Modalità simulata | Account Twilio + numero WhatsApp Business |
| Facebook/Instagram | Modalità simulata | App Meta Developers + OAuth o token manuale |
| Backup cloud | Solo locale | Bucket S3/B2 + credenziali in Impostazioni |

### 3.4 Portale inquilino

| Esiste | Manca |
|--------|-------|
| Login/logout separato | Reset password self-service |
| Vista immobile e contratto | Download documenti per inquilino |
| Password impostata da admin | Email di benvenuto automatica |
| — | ~~**Bug login:** path bootstrap errato~~ **Risolto** |

### 3.5 Operazioni & monitoring

- Nessun endpoint health check
- Nessun log applicativo centralizzato (solo `error_log` PHP)
- Nessun alert se cron o backup falliscono
- Nessuna procedura documentata di restore
- Filesystem hosting **effimero** su piattaforme cloud (Render, ecc.) — upload e backup locali si perdono al restart; usare DB gestito + object storage

---

## 4. Deploy passo-passo

### 4.1 Hosting consigliato

Per questo stack (PHP + MySQL), le opzioni più semplici:

1. **Hosting condiviso italiano** (Aruba, SiteGround, ecc.) — PHP + MySQL inclusi
2. **VPS** (Hetzner, DigitalOcean) — Apache/Nginx + MySQL, controllo totale
3. **MAMP locale** — solo sviluppo, non produzione

> **Nota Render:** possibile come Web Service PHP, ma serve Postgres esterno o MySQL esterno; il filesystem è effimero → obbligatorio storage esterno per upload e backup.

### 4.2 Procedura deploy

1. **Caricare i file** sul server (FTP/SFTP/Git), **escludere** `.env`, `backups/`, contenuto `uploads/` se non necessario
2. **Creare `.env`** sul server da `.env.example` con valori produzione
3. **Creare database** MySQL e utente con permessi minimi
4. **Importare schema** — migrazioni o `schema_production.sql` aggiornato
5. **Permessi cartelle** scrivibili dal web server:
   - `uploads/` (e sottocartelle)
   - `backups/`
6. **Eseguire setup** una volta: `https://tuodominio.it/gestionale/setup.php`
7. **Disabilitare setup:** `SETUP_ENABLED=false` nel `.env`
8. **Configurare cron** sul pannello hosting o crontab VPS
9. **Configurare integrazioni** da Impostazioni (email, Meta, WhatsApp, backup)
10. **Test smoke** (vedi §5)

### 4.3 Requisiti server PHP

Estensioni necessarie:
- `pdo_mysql`
- `curl` (Meta API, Twilio, backup cloud)
- `fileinfo` (upload MIME)
- `json`, `mbstring`, `openssl`
- CLI + `mysqldump` in PATH per backup cron

Versione consigliata: **PHP 8.1+**

### 4.4 Apache

Il progetto include `.htaccess`. Su Apache serve `AllowOverride All` sulla directory dell'app.  
Se usi **Nginx**, devi riscrivere manualmente le regole di blocco (`config/`, `database/`, ecc.).

---

## 5. Test post-deploy (smoke test)

Eseguire dopo ogni deploy:

| # | Test | Risultato atteso |
|---|------|------------------|
| 1 | Aprire `/login.php` senza sessione | Form login |
| 2 | Login admin errato | Errore, nessun accesso |
| 3 | Login admin corretto | Redirect a dashboard |
| 4 | `/api/get_dashboard_stats.php` senza cookie | HTTP 401 |
| 5 | `/views/dashboard.html` diretto | HTTP 403 |
| 6 | `/config/db.php` diretto | HTTP 403 |
| 7 | Creare proprietario + immobile | Salvataggio OK |
| 8 | Upload documento | File in `uploads/documents/` |
| 9 | Email di test da Impostazioni | Ricevuta in inbox |
| 10 | Cron promemoria (CLI o HTTP+secret) | JSON `success` |
| 11 | Backup cron | File in `backups/` (+ cloud se abilitato) |
| 12 | Portale inquilino login | Dashboard inquilino |
| 13 | `SETUP_ENABLED=false` → `/setup.php` | HTTP 403 |
| 14 | Da smartphone | Menu ☰, tabelle a card, modali full-width |

---

## 6. Configurazione `.env` produzione (esempio)

```env
APP_ENV=production
APP_DEBUG=false
APP_URL=https://www.tuaagenzia.it/gestionale
FORCE_HTTPS=true
SETUP_ENABLED=false

APP_SECRET=<stringa-casuale-64-caratteri>
CRON_SECRET=<altro-secret-casuale>

DB_HOST=localhost
DB_NAME=gestione_prod
DB_USER=gestionale_app
DB_PASS=<password-forte>
DB_CHARSET=utf8mb4

MAIL_ENABLED=true
AGENCY_NAME=La Tua Agenzia
AGENCY_EMAIL=info@tuaagenzia.it
SMTP_HOST=smtp.tuoprovider.it
SMTP_PORT=587
SMTP_USER=info@tuaagenzia.it
SMTP_PASS=<password-smtp>
SMTP_SECURE=tls

META_PUBLIC_BASE_URL=https://www.tuaagenzia.it/gestionale

BACKUP_CLOUD_ENABLED=true
BACKUP_S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com
BACKUP_S3_BUCKET=mio-bucket-backup
BACKUP_S3_REGION=eu-central-1
BACKUP_S3_KEY=<access-key>
BACKUP_S3_SECRET=<secret-key>
```

**Non committare mai `.env` nel repository.**

---

## 7. GDPR e aspetti legali (Italia)

Prima di usare l'app con dati reali di clienti e inquilini:

- [ ] **Informativa privacy** (sito + portale inquilino)
- [ ] **Base giuridica** per trattamento dati proprietari/inquilini
- [ ] **Registro trattamenti** (se applicabile)
- [ ] **DPAs** con fornitori: hosting, email, Twilio, Meta
- [ ] **Retention policy** — quanto tempo tenere comunicazioni, documenti, backup
- [ ] **Diritti interessati** — procedura per accesso/cancellazione dati
- [ ] **Cookie banner** — se aggiungi analytics o cookie non tecnici
- [ ] **Consenso marketing** — per email/WhatsApp promozionali (distinto da comunicazioni di servizio)

L'app **non include** pagine legali né gestione consensi: vanno aggiunte o linkate esternamente.

---

## 8. Roadmap suggerita

### Fase A — Go-live minimo (1–2 giorni)
1. ~~Fix `tenant/login.php`~~ ✅
2. Config `.env` produzione
3. DB migrato + setup admin
4. HTTPS + cron backup/reminders
5. SMTP funzionante
6. Smoke test completi

### Fase B — Hardening (1 settimana)
1. ~~`requireWriteAccess()` su tutte le API~~ ✅
2. Validazione webhook Twilio
3. Security headers
4. Logging errori
5. ~~Aggiornare `schema_production.sql`~~ ✅

### Fase C — Operazioni mature (ongoing)
1. Test automatici + CI
2. Monitoring uptime
3. Reset password
4. Backup file `uploads/`
5. Documentazione GDPR
6. Health check endpoint

---

## 9. File di riferimento nel progetto

| File | Scopo |
|------|--------|
| `.env.example` | Template variabili ambiente |
| `database/schema_production.sql` | Schema DB senza seed (da aggiornare) |
| `database/migrations/phase*.sql` | Migrazioni incrementali |
| `config/auth.php` | Autenticazione sessione |
| `config/roles.php` | Permessi per ruolo |
| `config/settings.php` | Impostazioni DB + branding |
| `cron/backup_database.php` | Backup automatico |
| `.htaccess` | Regole sicurezza Apache |
| `PRODUCTION_READINESS.md` | Questo documento |

---

## 10. Contatti operativi (da compilare)

| Ruolo | Nome | Contatto |
|-------|------|----------|
| Responsabile agenzia | | |
| Amministratore tecnico | | |
| Hosting provider | | |
| Dominio / DNS | | |
| Email SMTP provider | | |
| Account Twilio | | |
| App Meta Developers | | |

---

*Questo documento descrive lo stato del progetto al momento della stesura. Aggiornarlo dopo ogni modifica significativa a sicurezza, deploy o integrazioni.*
