# Capability map + connection audit — 2026-08-02

**Question this answers:** for every page in the gestionale, what can an Orlandi agent
actually *do*, does the wiring behind that action actually work, and where does the app
fall short of how an Italian estate agency really operates?

**How it was verified.** A live PHP server (`php -S 127.0.0.1:8099`) against the local
`gestione_immobiliare` database (30 proprietari / 60 immobili / 15 contratti / 270
pagamenti of demo data), with a real logged-in session cookie. Temporary
`super_admin` / `agent` / `readonly` accounts were created for role testing and all
test rows were deleted afterwards (verified: row counts back to their starting values,
0 residual `ZZ*` records). Claims below are backed by a pasted request/response or a
`file:line` citation. Anything not executed is labelled **NOT VERIFIED**.

Known limits of this run: the built-in PHP server does not read `.htaccess`, so Apache
boundary rules could not be exercised here; email/WhatsApp/Meta/cron are unconfigured
locally, so their *dispatch* is only assessed by code path, not by a delivered message.

---

## 1. Executive summary

| Area | Verdict |
|---|---|
| Core CRUD + relations (persone, immobili, contratti, documenti, finanze) | **Works.** 89 API endpoints swept while authenticated — zero 500s, every one answered coherently. |
| Money (scadenzario, provvigioni, fatture, SDD) | **Works.** Schedule generation produced exactly 48 monthly rows for a 48-month lease and refused to duplicate on re-run. |
| Auth / roles / boundaries | **Holds.** readonly writes → 403, agent → 403 on settings/social/activity_log/admin_users, no cookie → 401. |
| Immobile scheda vs immobiliare.it | **Structurally there.** ~100 columns + weighted surfaces + multilingual descriptions. The *portal feed* is not. |
| Integrations (email, WhatsApp, Meta, Stripe, cron) | **Not client-usable yet** — unconfigured locally, and the readiness probe says so honestly. |
| Portals (inquilino / proprietario) | **Built but unprovisioned** — 0 tenant users, 0 owners with a portal password. |
| Sales negotiation (proposta d'acquisto → compromesso → rogito) | **Missing.** The single biggest domain gap. |

---

## 2. What an agent can do, page by page

Legend: **✅ verified live** · **▶ present in code, not executed this run** · **⚠ works but with a caveat** · **❌ absent**

### 2.1 Persone

| Page | What the agent can do |
|---|---|
| **Proprietari** (`clients`) | ✅ list/filter/paginate, ✅ stats strip, ✅ create with full anagrafica (persona fisica *o* giuridica: CF, P.IVA, PEC, nascita, residenza), ✅ edit, ✅ archive + bulk archive, ▶ CSV import, ▶ merge duplicates, ▶ upload/delete carta d'identità (fronte/retro), ▶ quick side-rail (ultimi documenti + immobili), ✅ send message (email / WhatsApp / nota interna) with email templates and attachments picked from the document library, ▶ generate rendiconto proprietario PDF |
| **Scheda proprietario** (`client_profile`) | ▶ tabs: immobili, contratti, fatture, documenti, comunicazioni, promemoria · ▶ genera fattura PDF, ▶ prospetto fiscale, ▶ rendiconto · ▶ GDPR: export dati, registro consensi, log trattamento, cancellazione · ▶ invia link password portale proprietario · ▶ nuovo promemoria / contratto / fattura / immobile |
| **Leads** (`leads`) | ✅ create, ✅ set status, ✅ **match immobili** (returned property 62 for a matching budget/city lead), ▶ assign/riassegna agente, ▶ bulk, ▶ archivia, ✅ convert → inquilino (validated: refuses without lease start date), ▶ convert → proprietario, ▶ import lead da email |
| **Inquilini** (`tenants`) | ✅ create — ⚠ *requires* a `property_id` and auto-creates the locazione contract (`api/tenants.php:151`), ▶ edit, ▶ delete, ▶ invia WhatsApp, ▶ scheda with contratti/pagamenti/documenti/promemoria |
| **Portafoglio agenti** (`agents`, `agent_profile`) | ▶ per-agent view of clients, leads, appuntamenti, provvigioni |

### 2.2 Immobili

| Page | What the agent can do |
|---|---|
| **Immobili** (`properties`) | ✅ create/edit against the full scheda, ✅ list + 2/3/4-column grid, ▶ filtri salvati, ▶ archivia, ▶ bulk, ▶ export CSV/XML/JSON, ▶ import, ▶ duplica, ▶ riassegna agente, ✅ **matching leads** (scored, with reasons: "Gruppo, Budget, Camere"), ▶ confronto multi-immobile, ✅ stima OMI, ▶ salva valutazione, ✅ genera PDF (scheda / mandato), ▶ pubblica su social, ▶ storico prezzi |
| **Scheda immobile** (`property_profile`) | ▶ media (foto, video, planimetria, mappa, allegati) + copertina, ▶ contratti, fatture, documenti, promemoria, inquilini, ▶ archivia/elimina |
| **Edifici** (`buildings`) | ▶ condominio: genera unità, collega/scollega immobili, tabelle millesimali, **ripartisci spesa** sulle unità, documenti condominiali ereditati, amministratore da fornitori |
| **Mappa** (`map`) | ▶ marker cluster su `?view=map`, filtro per stato, pianificatore itinerario, modifica inline |
| **Chiavi** (`keys`) | ▶ registra mazzi, detentore tipizzato, consegna/riconsegna, storico, sollecito riconsegna |
| **Contatori** (`meters`) | ▶ registro contatori per immobile, letture con foto, elimina |
| **Inventario** (`inventory`) | ▶ registro beni, categorie, **verbali** di consegna/riconsegna per contratto, congela verbale, confronto ingresso/uscita |
| **Pubblicazioni portali** (`portal_sync`) | ▶ tracker manuale dello stato pubblicazione, pre-flight, import feedback — ⚠ **nessun feed reale** (§5) |
| **Valutazioni OMI** (`valuation`) | ▶ import CSV OMI ufficiale, ✅ stima per immobile, ▶ salva perizia, ▶ elimina |

### 2.3 Documenti

| Page | What the agent can do |
|---|---|
| **Contratti** (`contracts`) | ▶ create/edit locazione · compravendita · preliminare · mandato, ▶ set status (draft/sent/signed/expired/cancelled), ✅ **genera scadenzario**, ▶ adeguamento ISTAT, ✅ genera PDF contratto, ▶ link firma digitale, ▶ dati registrazione (RLI, cedolare secca, imposte) |
| **Documenti** (`documents`) | ▶ upload per proprietario/immobile/contratto, ✅ download **auth-gated** (`api/download_pdf.php` senza cookie → 401), ▶ elimina |
| **Fatture** (`invoices`) | ▶ create/edit/delete, ▶ genera PDF, ▶ genera XML FatturaPA, ▶ trasmetti a SdI + registra ricevuta |
| **Firme digitali** (`esign`) | ▶ elenco richieste, ▶ genera/copia link firma, ▶ reinvia, ▶ revoca |

### 2.4 Finanze

| Page | What the agent can do |
|---|---|
| **Pagamenti** (`payments`) | ▶ registra/modifica/elimina, ▶ genera file SEPA SDD — ⚠ blocked until the agency IBAN is set (`"Configurazione incompleta: IBAN agenzia"`) |
| **Spese** (`expenses`) | ▶ create/edit/delete, collegabili a immobile / proprietario / fornitore |
| **Provvigioni** (`commissions`) | ▶ create/edit, segna pagata, filtri (tutte / in sospeso / pagate) |
| **Previsioni** (`forecast`) | ✅ proiezione cassa a 6 / 12 / 24 mesi |
| **Report** (`reports`) | ▶ per tipo + anno |
| **Scadenzario fiscale** (`scadenzario`) | ✅ scadenze fiscali |
| **Solleciti pagamenti** (`payment_reminders`) | ✅ prospetto scaduti, ▶ invio solleciti in blocco |

### 2.5 Gestione

| Page | What the agent can do |
|---|---|
| **Manutenzione** (`maintenance_workflow`) | ▶ kanban da fare / in corso / fatto, ▶ nuovo intervento, ▶ assegna fornitore, ▶ collega bene d'inventario |
| **Assicurazioni** (`insurance`) | ▶ polizze per immobile, create/edit/delete |
| **Fornitori** (`suppliers`) | ▶ anagrafica fornitori |
| **Richieste** (`property_applications`) | ✅ richieste dal sito (affitto/acquisto), ▶ stato, ▶ converti in lead |
| **Antiriciclaggio** (`aml`) | ▶ pratiche AML per cliente |

### 2.6 Comunicazioni

| Page | What the agent can do |
|---|---|
| **Comunicazioni** (`communications`) | ✅ thread per proprietario, ✅ canali **email / WhatsApp / nota** con semantiche distinte, ▶ template, ▶ allegati ri-validati lato server per ownership, ▶ stati di consegna |
| **WhatsApp Inbox** (`whatsapp_inbox`) | ▶ thread per numero, non lette, ▶ associa a contatto, ▶ crea lead, ▶ invia, ▶ media in arrivo |
| **Social** (`social`) | ▶ post, connessione account, pubblica su Meta |
| **Sondaggi** (`surveys`) | ▶ genera link sondaggio post-visita (token) — `tenant/survey.php` risponde 200 |

### 2.7 Agenda

| Page | What the agent can do |
|---|---|
| **Appuntamenti** (`appointments`) | ▶ create/edit con tipo, luogo, promemoria; collegabile a lead / proprietario / inquilino / immobile; scheda dedicata |
| **Calendario** (`calendar`) | ▶ vista mensile che unisce appuntamenti **e** promemoria, ▶ completa promemoria, ▶ sposta appuntamento |
| **Promemoria** (`reminders`) | ✅ create, ✅ **completa**, ▶ ricorrenze come righe reali, ▶ assegna ad agente, ▶ annulla, ▶ modelli rapidi (richiamare lead, sollecito pagamento, verifica mutuo…) |
| **Automazioni** (`automations`) | ▶ regole a eventi sulla tabella reminders, token dinamici, registro invii |

### 2.8 Sistema

| Page | What the agent can do |
|---|---|
| **Log attività** | ✅ registro azioni |
| **Il mio account** | ▶ 2FA attiva/disattiva, cambio password |
| **Impostazioni** | ✅ **Stato sistema** (readiness probe, onesto — §5), ▶ branding + logo, email, WhatsApp, Meta, fatturazione, indici ISTAT, backup, utenti, template email/WhatsApp |

---

## 3. Connection audit — what was actually executed

### 3.1 Full endpoint sweep (authenticated)

All 89 files in `api/` called with a live `gestionale_session` cookie.
**Zero 500s.** Everything returned either `200 + success:true`, or a precise
`400`/`405` naming the missing parameter. Representative slice:

```
clients.php            200 "success":true
properties.php         200 "success":true
contracts.php          200 "success":true
payments.php           200 "success":true
get_dashboard_stats.php 200 {"total_clients":30,"total_properties":60,...}
generate_sdd.php       400 "Configurazione incompleta: IBAN agenzia (Impostazioni → Fatturazione)"
whatsapp_webhook.php   403   ← fail-closed without a signature
```

### 3.2 End-to-end agent workflow (the real test)

Created, then deleted, a complete chain: proprietario → immobile → inquilino →
contratto → scadenzario → promemoria → PDF → comunicazioni → lead → matching.

| Step | Result |
|---|---|
| Crea proprietario | `{"success":true,"data":{"id":31,...}}` |
| Crea immobile collegato | `{"success":true,"data":{"id":62,"client_id":31,...}}` |
| Crea inquilino + locazione | tenant id 20, **contract id 21 auto-created** — `"Locazione Via Verifica 1"` |
| **Genera scadenzario** | `{"payments_created":48,"message":"48 pagamenti creati."}` — exactly right for 2026-09-01 → 2030-08-31 |
| **Genera scadenzario, 2ª volta** | `{"success":false,"error":"Esiste già uno scadenzario per questo contratto…"}` — **no duplicates**, row count unchanged at 318 |
| Crea promemoria + completa | both `success:true` |
| Genera PDF mandato | `mandato_20260802_191418_*.pdf` |
| Genera PDF contratto | `contract_…pdf`, download → `HTTP 200 application/pdf 4854 bytes`, header `%PDF-1.4` |
| Crea lead → match immobili | `{"lead_id":29,"property_ids":[62]}` |
| Matching inverso su immobile | scored leads with reasons `["Gruppo","Budget","Camere"]` |
| Converti lead → inquilino | correctly refused: `"La data di inizio locazione è obbligatoria."` |

**The core loop an Orlandi agent lives in works end to end.**

### 3.3 Roles and boundaries

```
readonly  POST clients/properties/contracts/reminders/documents → 403 (all)
readonly  DELETE clients?id=31                                  → 403
readonly  GET  clients                                          → 200
agent     view.php?name=settings | social | activity_log        → 403 (all)
agent     GET api/admin_users.php                               → 403
agent     GET api/settings.php                                  → 403
no cookie GET clients | properties | dashboard_stats | documents → 401 (all)
no cookie GET api/download_pdf.php?id=2                          → 401
```

Note the readonly block is enforced **at the HTTP-method level** in both the
frontend fetch wrapper (`assets/js/app.js:71`) and the API — not by hiding buttons.
That is the right layer.

### 3.4 Structural checks

- **Migrations:** 90 applied, **0 pending**. (This supersedes the older note that
  phase79/80 had never run — they have, locally.)
- **Orphan endpoints:** `api/me.php`, `api/dashboard_prefs.php`, `api/media.php` are
  referenced by no frontend file and no other PHP — dead code (documented in
  `docs/api/API.md`, which is now wrong about them).
- **Frontend↔API parameter check:** every query parameter the frontend sends was
  checked against its endpoint. One real mismatch found (§4.2).
- **Public link targets:** `apply.php`, `sign.php`, `unsubscribe.php`,
  `tenant/survey.php` all exist and respond.

---

## 4. Findings worth fixing

### 4.1 A failed email silently destroys the agent's message — *fix this one*

`api/communications.php` sends first and stores second. If the mailer fails, the row
is never inserted and the text the agent typed is gone.

```
POST communications {"channel":"email",...} → {"success":false,"error":"Invio email fallito."}
GET  communications?client_id=31            → messages: []      ← nothing kept
POST communications {"channel":"whatsapp"}  → success, status:"simulated"   ← kept
```

Two channels on the same screen behave differently: WhatsApp degrades to `simulated`
and is preserved; email fails hard and loses the content. An agent who writes a long
message to a proprietario during an SMTP hiccup retypes it from scratch.
**Suggested fix:** insert the row first with `status='failed'`, then attempt delivery
and update — so the message is always recoverable and re-sendable.

### 4.2 `payments.php?contract_id=` is silently ignored

```
GET payments.php?limit=1               → "total":318
GET payments.php?contract_id=21&limit=1 → "total":318   ← filter no-op, returns everything
GET payments.php?tenant_id=20&limit=1   → "total":48    ← works
GET payments.php?property_id=62&limit=1 → "total":48    ← works
```

No current screen passes `contract_id`, so nothing is visibly broken today — but the
next screen that does will show every payment in the database and look correct.
Either implement the filter or reject unknown filter params.

### 4.3 Form field names diverge from what the API expects

Three separate APIs take a different key than the obvious one, which cost real time
even with the schema in front of me:

- `communications.php` wants **`body`**, not `message`
- `reminders.php` accepts only `request_type='maintenance'` — any other value is
  rejected outright (`REMINDER_REQUEST_TYPES` at `api/reminders.php:28`), yet the
  column is a free varchar
- `tenants.php` **requires `property_id`** to create a tenant at all, because it
  auto-creates the contract

These are internally consistent, just undocumented. Worth a line in the API docs
before another developer (or agent) touches them.

### 4.4 Dead code

`api/me.php`, `api/dashboard_prefs.php`, `api/media.php` — unreferenced, but still
listed as live endpoints in `docs/api/API.md` and `docs/guides/06-API-REFERENCE.md`.

---

## 5. Integrations — reality, not badges

The `readiness.php` probe reports these honestly (no false greens):

| Integration | Status | Reality |
|---|---|---|
| Email | `warn` | *"Email non configurata: notifiche/promemoria via email non partiranno."* Locally unconfigured; production uses Gmail SMTP. |
| WhatsApp | `warn` | *"WhatsApp disattivato: i messaggi vengono registrati come 'simulati'."* Now on Meta Cloud API; outside the 24h window it needs approved templates. |
| Webhook secrets | `warn` | Missing for WhatsApp (Meta) and Stripe. `whatsapp_webhook.php` correctly returns **403** unsigned — fail-closed. |
| Cron | `warn` | *"mai eseguiti: reminders, payment_reminders, contract_expirations…"* 7 job scripts exist in `cron/`; **script existence ≠ scheduled execution.** |
| Backup | `warn` | No local backup found. |
| Stripe | — | `stripe_checkout.php` → 405 on GET; no keys configured. Decide in or out before the demo. |
| `DB_USER=root` | `warn` | The probe flags it itself. |

**Portals.** `tenant/login.php` and `owner/login.php` both serve (200), but the
database has **0 `tenant_users`** and **0 owners with a portal password**. The
provisioning path exists (owner scheda → invia link password). They are built, not
switched on — which matches how you described them.

**Portal syndication.** `portal_field_map` holds 18 rows for immobiliare/idealista,
every one annotated *"Da riconciliare con il tracciato contrattuale"*. So the
taxonomy is a placeholder, not the real immobiliare.it tracciato. `portal_sync` is a
**manual publication-state tracker** — an agent still uploads to immobiliare.it by
hand. Present it that way.

---

## 6. Immobile structure vs immobiliare.it

**Verdict: the data model is there.** `properties` carries ~100 columns and the scheda
form (`views/property_edit.html`, 72 controls across 6 fieldsets: *Proprietario e
ubicazione · Tipologia · Contratto, prezzo e costi di gestione · Superficie ·
Composizione · Caratteristiche*) exposes them.

Covered, matching the portal's annuncio fields:

- **Prezzo/contratto:** prezzo, tipo (vendita/affitto), prezzo su richiesta, spese
  condominiali, spese riscaldamento, riscatto, immobile da reddito
- **Superficie:** dedicated `property_surfaces` table with `surface_type`,
  `floor_label`, `sqm`, **`weight_percent`**, `commercial_sqm`, `is_accessory` — this
  is the *superficie commerciale ponderata* model the portal uses, not a single number
- **Composizione:** locali, camere, bagni, altri vani, cucina, piano, piani totali,
  ascensore, arredato, box/posti auto, giardino, balconi, terrazzi, cantina,
  mansarda, taverna
- **Efficienza:** classe energetica (+ esente / in attesa), IPE, APE numero, emissione,
  scadenza
- **Caratteristiche:** porta blindata, allarme, cancello elettrico, videocitofono,
  fibra ottica, camino, idromassaggio, piscina, campo da tennis, infissi, impianto TV,
  portineria, multilivello, accesso disabili, lati liberi, esposizione, affaccio,
  riscaldamento (impianto + combustibile), climatizzazione (+ tipo)
- **Catasto:** sezione, foglio, particella, subalterno, categoria, classe, rendita,
  zona, comune
- **Media:** `property_media.media_type` = `photo · video · floor_plan · house_map ·
  attachment` — planimetria and video are first-class
- **Multilingua:** `property_descriptions` keyed by `lang` (IT master + translations)
- **Mandato:** `mandate_type`, `collaboration`, `agent_id`

What is **not** there:

1. **The feed itself.** Structure ≠ syndication. There is no immobiliare.it tracciato
   export. `property_export.php` produces generic CSV/JSON/XML. immobiliare.it is a
   paid, feed-based integration — this is a commercial decision, not a coding one.
2. **`property_type` is a 7-value enum** (`appartamento, villa, ufficio, negozio, box,
   terreno, altro`) where immobiliare.it has a far deeper taxonomy (attico, loft,
   rustico, palazzo, capannone, magazzino…). `typology` is a free varchar that softens
   this, but the enum will need widening for a real feed. **NOT VERIFIED** against the
   current official tracciato.
3. **Disponibilità** (libero dal / occupato fino a) — `is_vacant` is a boolean, there
   is no date.

---

## 7. Does it match how an Orlandi agent actually works?

| Agency workflow | Covered? |
|---|---|
| **Acquisizione** — valutazione → mandato → scheda + foto → pubblicazione | ✅ valutazione OMI, ✅ mandato PDF, ✅ scheda completa, ✅ media · ⚠ pubblicazione manuale |
| **Domanda** — lead in ingresso → qualifica → matching → visita → feedback | ✅ leads (11 fonti incl. immobiliare/idealista/casa/subito), ✅ matching a punteggio, ✅ appuntamenti, ✅ sondaggi post-visita · ⚠ i lead dai portali entrano **via email**, non via API |
| **Trattativa** — proposta d'acquisto → controproposta → accettazione → compromesso → rogito | ❌ **assente** (§7.1) |
| **Contrattualistica** — contratto → registrazione RLI → cedolare → scadenzario | ✅ completo |
| **Gestione locazione** — incassi, solleciti, spese, ripartizioni, manutenzione, contatori, chiavi, inventario | ✅ completo, e più profondo della media dei gestionali |
| **Rendicontazione proprietario** | ✅ rendiconto + prospetto fiscale |
| **Provvigioni / fatturazione / SdI** | ✅ completo |
| **Antiriciclaggio** | ✅ presente |
| **GDPR** | ✅ export, consensi, log, cancellazione |
| **Affitti brevi / stagionali** | ❌ nessun calendario disponibilità, nessuna tabella prenotazioni |

### 7.1 The gap that matters: proposta d'acquisto

I checked for any table matching `%offer%`, `%propost%`, `%prelimin%`, `%compromess%`,
`%rogit%` — **none exist.**

What exists instead:
- `property_applications` — an inbound *web enquiry* (nome, email, telefono, messaggio,
  `application_type` affitto/acquisto, status new/contacted/approved/rejected). This is
  a contact form, not an offer.
- `contracts.contract_type` includes `preliminare` and `compravendita` — so the
  *outcome* can be recorded, but not the negotiation that produces it.

For a sales mandate an agent needs: importo offerto, caparra confirmatoria, validità
dell'offerta, accettata/rifiutata/controproposta, data compromesso, data rogito,
notaio. Today that whole phase lives outside the gestionale. **If Orlandi sells as well
as rents, this is the first thing to build after the demo.**

### 7.2 Second gap: affitti brevi / stagionali

Civitanova Marche is a coastal town. No availability calendar, no booking entity, no
per-night pricing. If seasonal lets are part of the business, the app cannot express
them at all today. Worth asking Orlandi directly — it is a large build, and it may
simply be out of scope.

---

## 8. Could NOT verify

- **Apache boundary rules** (`views/*.html` direct, `config/db.php`, `uploads/documents/`
  from an anonymous session). The built-in PHP server ignores `.htaccess`, so a raw
  `uploads/documents/…` path returned 200 **here** — this is a limitation of the test
  server, not evidence of a hole. The deny-all `.htaccess` is present and correct at
  `uploads/documents/.htaccess`, and the auth-checked streamer refuses without a cookie
  (401, verified). Re-run this against the live Apache before the demo.
- **Actual email/WhatsApp/social delivery** — unconfigured locally.
- **Cron execution on the server** — needs `cron_last_*` on the production database.
- **Cross-portal IDOR** (tenant A reading tenant B) — there are 0 provisioned portal
  users to test with. Must be re-run once portals are switched on.
- **The current immobiliare.it tracciato** — no access to the spec.

---

## 9. Suggested order of work before delivery

1. Fix §4.1 — a lost message is the one bug an agent will hit on day one and lose trust over.
2. Decide Stripe in/out; if out, confirm no dead payment UI shows in the demo.
3. Provision one tenant and one owner portal account, then re-run the isolation tests.
4. Re-run the Apache boundary checks on the live host (§8).
5. Confirm cron is actually scheduled in production (`cron_last_*`, not the crontab file).
6. Ask Orlandi the two scope questions: **proposta d'acquisto** (§7.1) and **affitti
   stagionali** (§7.2). Both are yes/no answers that change the roadmap significantly.
7. Present WhatsApp / social / portali as *"in attivazione"*. Core CRUD, documenti,
   contratti, scadenzario, PDF and promemoria are genuinely the working product — and
   they are strong.
