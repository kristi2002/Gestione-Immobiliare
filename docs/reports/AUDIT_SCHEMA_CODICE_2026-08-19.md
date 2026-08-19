# Audit deriva schema ↔ codice — 19 agosto 2026

Ricerca sistematica di lacune, disallineamenti e problemi di collegamento fra
tabelle. Ogni riga qui sotto e' stata **eseguita**, non dedotta: dove c'e' un
numero, quel numero viene da un comando che ha girato.

Ambiente: DB locale `gestione_immobiliare` (67 tabelle, 99 migrazioni applicate,
0 in sospeso), server `php -S 127.0.0.1:8099`, PHP 8.5.7.

---

## 1. Cio' che risulta SANO (verificato, non supposto)

| Verifica | Metodo | Esito |
|---|---|---|
| Riferimenti a tabella/colonna nell'SQL | 1087 blocchi SQL estratti col tokenizer PHP (niente commenti) | **0 tabelle fantasma, 0 colonne inesistenti** |
| Liste colonne in `INSERT`/`UPDATE` | 295 liste validate contro lo schema vivo | **0 disallineamenti** |
| Ricostruzione da zero | DB nuovo = `schema_production.sql` + 72 migrazioni | **72/72 ok** |
| Deriva DB vissuto vs ricostruito | confronto colonne+tipi+default+FK+indici | **0 differenze** (67 tabelle, 144 FK, 326 indici) |
| Righe orfane | LEFT JOIN contro il padre su tutte le 144 FK | **0 orfani** |
| Indici sulle FK | ogni colonna FK | **tutte indicizzate** |
| Isolamento fra portali | `scripts/verify_portal_isolation.php` via HTTP | **48/48 PASS** |
| Confini di ruolo + CSRF | 27 prove HTTP con utenti temporanei | **27/27 PASS** |
| Scadenzario (soldi) | generato DUE volte via HTTP sul contratto #1 | **37 rate, 2a esecuzione +0**, importi e ancoraggio corretti |
| Firma webhook | ramo produzione provato direttamente | **fail-closed** (`unconfigured` → 503) |
| Suite di test | `vendor/bin/phpunit` | **241 test, 1645 asserzioni, ok** |
| Sintassi | `php -l` su tutto l'albero applicativo | **0 errori** |
| Lavoro incompiuto dichiarato | ricerca TODO/FIXME/HACK | **nessun marcatore** |

Nota positiva collaterale: `config/db.php` ora **rifiuta di connettersi in
produzione con `DB_USER=root`**. La responsabilita' n.2 di CLAUDE.md §9 e' chiusa
nel codice.

---

## 2. Segnalazioni

### 2.1 — `check_enum_drift.php` da' un verde falso · MEDIA

Un controllo **saltato** non incrementa `$issues`: lo script stampa
`OK — nessuna divergenza` ed esce 0 anche quando non ha verificato niente.

Oggi accade davvero su `payments.method`: lo script cerca una costante
`PAYMENT_METHODS` in `api/payments.php`, che **non esiste** — la validazione e'
un array in linea dentro una funzione (`api/payments.php:280`). Output reale:

```
payments.method vs PAYMENT_METHODS    (costante PAYMENT_METHODS non trovata in api/payments.php — salto)
...
OK — nessuna divergenza.
```

I valori per ora coincidono (li ho confrontati a mano: `bonifico, sdd, mav,
contanti, assegno, pos, stripe, altro` da entrambe le parti), quindi **non c'e'
danno adesso**. Il problema e' che la guardia non sta guardando: alla prossima
migrazione che allarga l'enum, lo script continuera' a dire OK.

Inoltre la copertura e' **10 colonne su 89 ENUM**. Restano fuori
`properties.status`, `contracts.status`, `payments.status`, `leads.status`,
`reminders.status`, `admin_users.role` — e ~45 enum hanno la whitelist duplicata
sia in PHP sia in JS, quindi la deriva puo' nascere in tre posti.

**Da fare:** far contare i salti come divergenza (exit 1), e trasformare l'array
in linea in una costante `PAYMENT_METHODS`.

> Ho cercato deriva reale su tutti gli 89 enum: le segnalazioni emerse sono
> tutte falsi positivi verificati a mano. In particolare `communications.channel`
> (il DB ha `portale`, `COMM_CHANNELS` no) e' **voluto** e c'e' gia' un commento
> di 12 righe in `api/communications.php:30-43` che spiega perche' aggiungerlo
> sarebbe un difetto nuovo. Lasciare com'e'.

### 2.2 — `contracts.client_id` si stacca in silenzio · MEDIA

Le regole `ON DELETE` verso `clients` non sono coerenti:

| Regola | Tabelle |
|---|---|
| RESTRICT | `properties` |
| CASCADE | `communications`, `password_resets` |
| **SET NULL** | `contracts`, `invoices`, `documents`, `expenses`, `payment_reminder_log`, `aml_records`, `agent_commissions`, `property_insurance`, `pdf_documents`, `reminders`, `appointments`, `whatsapp_messages` |

Quindi un proprietario **senza immobili** ma **con contratti** si puo'
cancellare: la cancellazione non viene bloccata e `contracts.client_id` diventa
NULL. Un contratto — documento legale e fiscale — resta in tabella senza piu'
il suo locatore, e nessuno se ne accorge.

Il confronto interno lo conferma come svista: `tenant_id → tenants` e' RESTRICT
da `payments`, `sdd_collections`, `stripe_payments`, e `property_id → properties`
e' RESTRICT da `contracts`, `payments`, `property_insurance`. La stessa
protezione manca sul lato proprietario.

Stato attuale: **0 contratti con `client_id` NULL**, quindi nessun danno gia'
avvenuto.

**Da fare:** portare a RESTRICT almeno `contracts.client_id` e
`invoices.client_id`.

### 2.3 — I dati dimostrativi rompono il percorso di demo · MEDIA

CLAUDE.md §5.2 chiede che la demo sia impeccabile. Sul DB attuale non lo e':

| Cosa | Numero | Effetto visibile |
|---|---|---|
| Pagamenti senza `contract_id` | **270 su 270** | la scheda Contratto → Scadenzario e' VUOTA, mentre l'elenco Pagamenti ne mostra 270 |
| Documenti che puntano a un file assente | **20 su 20** | ogni "Scarica" da' 404: `uploads/demo/placeholder.pdf` non esiste |
| Immobili `rented` senza contratto che li sostenga | **16** | stato incoerente in vetrina |
| Inquilini con contratto firmato ma senza accesso al portale | **3** (`tenant_users` e' vuota) | il portale inquilino non e' mostrabile |
| Pagamenti `pending` con scadenza passata | 59 | nessuno risulta "in ritardo" |

Origine (non e' un bug del prodotto, e' il seme):
- `scripts/seed_demo.php:418` — l'INSERT dei pagamenti **non include `contract_id`**.
- `scripts/seed_demo.php:514` — tutti i documenti puntano a `uploads/demo/placeholder.pdf`, file mai creato.

Il codice vero e' corretto: `insertPaymentSchedule()` in
`lib/contract_lifecycle.php:584` valorizza `contract_id`, e la prova di §4.4 e'
passata.

**Da fare prima della demo:** collegare i pagamenti al contratto nel seme, creare
il PDF segnaposto (o togliere le righe documento), e seminare almeno un
`tenant_users`.

### 2.4 — Righe morte nei permessi e una tabella morta · BASSA

- **`automations`** — tabella presente, **0 righe, zero riferimenti SQL in tutto
  il codice**. Le automazioni sono righe di `reminders` (phase66); la tabella e'
  un residuo del disegno abbandonato.
- **`VIEW_MIN_ROLE['users']`** (`config/roles.php:61`) — non esiste una vista
  `users`: la gestione utenti e' una scheda dentro `settings.html`. La riga non
  protegge niente.
- **`'pdf'`** in `ROLE_PERMISSIONS` per `admin` e `agent` — nessuna vista `pdf`.

Il file stesso mette in guardia da questo: *"Elencare una vista qui e anche la'
crea una riga morta che racconta un permesso che non esiste"*.

Verificato invece **allineato**: `ENTITY_FORM_VIEWS` (PHP), `REGISTRY`
(`assets/js/entity_edit/schemas/index.js`) e `App.entityFormTitles`
(`assets/js/app.js`) — 11 entita' su tutte e tre le liste, la sincronia che il
codice chiede a se stesso e' rispettata.

### 2.5 — Un job cron scrive un battito che nessuno guarda · BASSA

Tutti e 7 gli script in `cron/` chiamano `cronHeartbeat()`. Ma la lista
`$cronJobs` in `api/readiness.php:247` ne elenca **6**: manca `social_posts`.
Quel job puo' fermarsi per mesi senza che la pagina Stato sistema lo dica —
esattamente la modalita' di guasto che il battito era stato introdotto per
impedire.

### 2.6 — Le tabelle GDPR non hanno la FK verso `agencies` · BASSA

`consent_records`, `data_export_requests`, `data_processing_log`,
`erasure_requests` hanno `agency_id INT UNSIGNED NOT NULL DEFAULT 1` **senza
vincolo**, mentre le 9 tabelle radice (clients, properties, tenants,
admin_users, leads, contracts, invoices, buildings, suppliers) hanno la FK
RESTRICT messa da phase31. Incoerenza di impianto, senza effetto pratico finche'
l'agenzia resta una sola.

### 2.7 — Worktree abbandonato dentro il repo · PULIZIA

`.claude/worktrees/priceless-moore-848dad` — 8,4 MB, HEAD staccato su `01707ee`,
fermo dal 24 luglio. E' una copia dell'applicazione vecchia di un mese che
inquina ogni `grep` e ogni scansione (la mia prima passata l'ha raccolta).

```bash
git worktree remove .claude/worktrees/priceless-moore-848dad --force
```

### 2.8 — CLAUDE.md §1 descrive un problema gia' risolto · DOCUMENTAZIONE

CLAUDE.md chiede di risolvere la discordanza sul nome del cookie
(`gestionale_session` vs `gi_session`). **E' gia' risolta.** Login vero:

```
Set-Cookie: gestionale_session=2643...; path=/; HttpOnly; SameSite=Lax
```

`docs/deployment/DEPLOY.md:56` dice ora `SESSION_NAME=gestionale_session`,
`.env` idem, `ARCHITECTURE.md` e `CODEMAP.md` concordano. Restano da aggiornare
CLAUDE.md §1 e `docs/deployment/DEPLOYMENT_PLAN.md:33`, che elencano ancora
l'azione come da fare.

---

## 3. Non verificato

- **Produzione.** Tutto e' stato provato in locale. Le regole `.htaccess`
  (accesso diretto a `uploads/`, `views/`, `config/`) **non sono coperte**: il
  server interno di PHP non le legge. Vanno provate sull'host vero.
- **Esecuzione reale del cron in produzione.** In locale esiste solo
  `cron_last_reminders` (10/08); gli altri non hanno mai girato su questo DB.
- **Integrazioni.** `app_settings` non contiene alcun segreto
  (`meta_wa_app_secret`, `stripe_webhook_secret` assenti), quindi WhatsApp,
  Meta e Stripe restano non provabili da qui — coerente con lo stato
  "in attivazione".
- **Scrittura per i ruoli `agent`/`admin`.** Le prove negative sono tutte
  passate, ma il controllo positivo ("agent riesce a scrivere") non e' stato
  stabilito: il token CSRF si prende da `index.php`, e nel primo giro di prove
  non era stato recuperato, quindi quei POST sono stati respinti dal CSRF e non
  dal ruolo.

---

## 4. Residui

Nessuno. Utenti `probe_*` rimossi, fornitori di prova rimossi, riga WhatsApp
forgiata rimossa (`whatsapp_messages` torna a 30), 37 rate di prova rimosse
(`payments` torna a 270), database `gi_coldstart` eliminato, albero di lavoro
git pulito.
