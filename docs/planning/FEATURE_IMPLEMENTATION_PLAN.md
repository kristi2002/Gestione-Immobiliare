# Feature Implementation Plan — Standing Out in the Italian Gestionale Market

> Project: **Gestionale Immobiliare** (Orlandi Immobiliare, Civitanova Marche)
> Stack: PHP 8.3 + MySQL 8 + Apache, vanilla-JS SPA.
> Purpose: sequence and implement the fiscal/legal compliance layer + differentiators that
> separate this platform from mid-market Italian gestionali (Domus.Net, Kleos, Gextra, 24Immobili).
> Status source: static code inspection (July 2026). Not runtime-verified — see CLAUDE.md §0.

---

## Why these features

The platform already ships 33 CRUD/ops modules — more complete than most competitors on the
"manage the portfolio" axis. The gap that actually loses deals in Italy is the **fiscal/legal
compliance layer** (e-invoicing, lease registration, antiriciclaggio, catasto/APE) plus a few
**intelligence differentiators** (reverse matching, AI copy, unified deadlines). This plan builds
those.

Legend: **[SHIPPED]** implemented in this pass · **[DATA]** schema + API only · **[PLANNED]** speced, not built ·
🔑 needs external credentials to become client-usable.

---

## Tier 1 — Italian fiscal & legal compliance (the real moat)

### 1. Fatturazione Elettronica (FatturaPA / SdI)  **[SHIPPED]** 🔑
- **Built:** `lib/FatturaPA.php` generates a valid **FatturaPA 1.2.2** XML from an invoice
  (`<FatturaElettronica>` — `DatiTrasmissione`, `CedentePrestatore` from agency settings,
  `CessionarioCommittente` from the client/lead, `DatiGeneraliDocumento`, `DatiBeniServizi`,
  `DatiRiepilogo`). Agency fiscal identity (P.IVA, CF, regime fiscale, REA, PEC) is captured in
  Settings → Fatturazione and stored in `app_settings`. Download via
  `api/generate_fattura_xml.php?id={invoice_id}`; button on the invoices list.
- **Layer 3 — transmission lifecycle SHIPPED:** `phase39` adds `fattura_transmissions`;
  `api/fattura_sdi.php` drives **generato → trasmesso → consegnato/messa a disposizione/scartato/
  accettato/rifiutato**, persists the XML in the protected `uploads/documents/fatture/` tree, and
  records SdI receipts (RC/MC/NS/NE/DT/AT). `lib/sdi_sender.php` is a **pluggable intermediary**
  (env `SDI_PROVIDER`: manual\|aruba\|fatturaincloud\|custom). Invoice card → "Fattura elettronica"
  modal (Genera / Trasmetti / Scarica / Registra ricevuta).
- **Still needs (🔑):** with `SDI_PROVIDER=manual` (default) the XML is generated + tracked but the
  actual send is manual (download → upload to your accredited channel). Set a provider + `SDI_API_KEY`
  for automatic transmission; the intermediary's exact endpoint path must be confirmed against its docs.
  A real inbound receipt webhook (auto-advancing state) is not wired — receipts are recorded manually.
- **Why it matters:** e-invoicing is mandatory in Italy. A gestionale that only prints a PDF is
  not "a norma." This is the single biggest credibility gap closed.

### 2. Registrazione contratti di locazione (RLI + cedolare secca + F24)  **[SHIPPED]**
- **Built:** contracts gain `contract_subtype` (4+4, 3+2, transitorio, comodato, studenti…),
  `registration_number`, `registration_date`, `registration_office`, `cedolare_secca`,
  `registration_tax_annual`, `stamp_duty`, `imposta_registro_due_date`, plus ISTAT baseline fields.
  Surfaced in the contract editor and fed into the unified deadline dashboard.
- **Still needs (🔑):** telematic RLI submission to Agenzia delle Entrate requires Entratel/Fisconline
  credentials — out of scope for the app; the app pre-fills and tracks the obligation + deadlines.

### 3. Antiriciclaggio / Adeguata Verifica (D.lgs 231/2007)  **[SHIPPED]**
- **Built:** new **Antiriciclaggio** module (`aml_records` table, `api/aml.php`, `views/aml.html`,
  `assets/js/aml.js`). Per-subject fascicolo: type of verification (ordinaria/rafforzata/semplificata),
  risk level, ID document data, titolare effettivo, PEP flag, purpose of the transaction, verification
  date and **10-year retention deadline**, linked to a client/lead/property. Expiring/incomplete
  records surface as KPIs and in the fiscal deadline dashboard.
- **Why it matters:** real-estate mediators are *soggetti obbligati*. Missing this is an inspection
  liability for the agency (and by extension the vendor).

### 4. Dati catastali strutturati  **[SHIPPED]**
- **Built:** properties gain `cadastral_foglio`, `cadastral_particella`, `cadastral_subalterno`,
  `cadastral_category` (A/1…), `cadastral_rendita`, `cadastral_zone` (OMI), `cadastral_comune`.
  Editable on the property form; used by contracts/RLI and valuation.

### 5. APE as a tracked document (not just a letter)  **[SHIPPED]**
- **Built:** properties gain `ape_number`, `ape_issue_date`, `ape_expiry_date`, `ipe_value` (kWh/m²·a).
  10-year expiry flows into the unified deadline dashboard with a warning window.

### 6. CU / owner fiscal year statement  **[SHIPPED — layer 2]**
- **Built:** `api/owner_fiscal_statement.php` — a fiscal-year PDF of **rent received** per property
  (paid payments in the year), with the tax regime (cedolare secca vs ordinario, from the property's
  latest lease) and cadastral identifiers. Triggered by "Prospetto fiscale" in the owner profile
  (reuses the report modal's year). Support for the owner's 730/Redditi — not tax advice.

---

## Tier 2 — Distribution & market intelligence

### 7. Multi-portal publish + sync status  **[DATA]** 🔑
- **Built:** `portal_listings` table + `api/portal_sync.php` tracking, per property per portal
  (immobiliare.it, idealista, casa.it, subito, sito agenzia), a status (`draft/publishing/published/
  error/removed`), external id, last-sync timestamp, and error message. Existing
  `property_export.php` already produces the immobiliare.it-compatible feed.
- **Still needs (🔑):** each portal's real push API/feed credentials + terms; the transport is a stub.

### 8. Valutazione immobile / OMI + comparables  **[SHIPPED — layer 2]**
- **Built:** new **Valutazioni & Quotazioni OMI** module (`omi_quotazioni` table, `api/valuation.php`,
  `views/valuation.html`, `assets/js/valuation.js`). OMI quotazioni CRUD + an estimate that blends the
  OMI range (zone €/m² × m²) with comparables from the agency's own stock (same comune/tipologia).
  Also wired into the property appraisal modal ("Calcola stima OMI" prefills value/rent/comparabili).

### 9. Public vetrina + lead capture  **[PARTIAL — already present]**
- An `ecommerce/` demo site + `property_export.php` feed + `property_applications` intake already
  exist. Hardening (tracking pixel for lead scoring) remains per the killer-features roadmap.

### 10. Magic Match reverse (property → matching buyer leads)  **[SHIPPED]**
- **Built:** `api/properties.php?action=matching_leads&id={property_id}` scores active buyer/tenant
  leads against a listing (city, type, budget vs price, min rooms, min sqm) and returns the top
  matches with ready-made **WhatsApp** (`wa.me`) and **email** invite links. "Trova lead" button on
  the property list.

---

## Tier 3 — Modern SaaS layer

### 11. AI listing copywriter (property → Italian annuncio)  **[SHIPPED]** 🔑
- **Built:** `lib/ai.php` — a single pluggable provider layer (Anthropic Claude **or** any
  OpenAI-compatible endpoint, selected by env). `api/ai_describe.php?property_id={id}` drafts an
  Italian listing description + suggested title from the structured property fields. "Genera con AI"
  button in the property editor.
- **Still needs (🔑):** an API key in `.env` (`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`). Without a key
  the endpoint returns a clear "not configured" message — no dead UI.

### 12. Tenant/owner payments — SEPA/SDD mandates  **[DATA]** 🔑
- **Built:** tenants gain `iban`, `sdd_mandate_ref`, `sdd_mandate_date`; payments gain a `method`
  (`bonifico/sdd/mav/contanti/assegno/pos/stripe`). This models the Italian-normal **addebito
  diretto SEPA** instead of assuming cards.
- **Layer 2 update — SHIPPED:** `lib/sepa_sdd.php` now emits the **pain.008.001.02** file and
  `api/generate_sdd.php` collects the month's due SDD payments (Pagamenti → "Esporta SDD"). Creditor
  IBAN + SEPA Creditor Id live in Settings → Fatturazione. Stripe remains code-ready/unconfigured
  (CLAUDE.md §9.3); no dead "Pay now" button is added.

### 13. Scadenzario fiscale unico  **[SHIPPED]**
- **Built:** `api/scadenzario.php` unifies every deadline into one ranked list — contract expiry,
  imposta di registro / cedolare renewal, ISTAT adjustment eligibility, APE expiry, insurance expiry,
  antiriciclaggio retention, and open reminders — with an overdue/soon/upcoming classification.
  New **Scadenzario** view + nav entry.

### 14. Adeguamento ISTAT automatico  **[SHIPPED]**
- **Built:** `lib/istat.php` holds recent FOI (indice prezzi al consumo per famiglie di operai e
  impiegati) annual values and computes the annual canone adjustment (75% of the FOI variation, the
  standard lease clause) from a contract's `istat_baseline_index`.
  `api/contracts.php?action=istat_adjustment&id={id}` returns the proposed updated canone.

---

## Build order (this pass)

1. **Migrations** (`phase35`–`phase37`): property fiscal fields, contract registration, AML, portal, SEPA.
2. **Property fiscal data** (catasto + APE) into API + editor.
3. **Antiriciclaggio** module end-to-end.
4. **Contract registration + cedolare + ISTAT baseline** into API + editor.
5. **FatturaPA** lib + settings + endpoint + UI.
6. **ISTAT** lib + endpoint.
7. **Magic Match reverse** endpoint + UI.
8. **AI provider layer** + copywriter endpoint + UI.
9. **Scadenzario fiscale unico** aggregation + view.
10. **Portal sync + SEPA** data + API.
11. **Docs** update.

## Honesty carry-forward (into any client conversation)

- FatturaPA, RLI, portal push, SDD, and AI all have a **credential/intermediary boundary** (🔑). The
  app does the modelling, generation, and tracking; the last-mile transmission needs the agency's
  accredited channel or an API key. Present these as *"pronto, in attivazione."*
- None of this is legal/tax advice — the agency's commercialista/lawyer confirms fiscal scope.
- Runtime verification per CLAUDE.md §0 is still owed on a live DB before any of it is called "working."
