# Form standardization audit & plan — 2026-07-24

> **STATUS: ✅ EXECUTED 2026-07-25.** All batches shipped & live-verified (docker :8090).
> Migrations `phase60` (tenant anagrafica), `phase61` (leads CF), `phase62` (enum union).
> Commits: Batch A `feat(inquilini)`, Batch B `fix(data) enums`, Batch C `refactor(form)`,
> Batch D `style(form)`. Decisions taken: full scope A+B+C+P3; expand enums; tenant giuridica included.
> Micro-polish left as-is (documents/valuation/commissions — audits rated them acceptable flat).

**Goal:** bring every form in the app up to the standard set by the **immobili form**
(`views/property_edit.html`), which is the source of truth because it mirrors the
immobiliare.it insertion scheda. This audit compares all form-bearing views against
that standard and lists what to change, at what priority, and whether a DB migration
is required.

**Method:** 5 parallel audits over all `views/*.html` forms + their JS + backing
`api/*.php` + the real DB schema (base + migrations, cross-checked against the live
dev DB on docker `:8090`). P1 bugs were reproduced/verified directly (see Evidence).

---

## The reference standard (what "the immobili form" establishes)

1. **Layout** — form split into `<fieldset class="form-section"><legend>…</legend>`
   sections; grid rows `.form-row` / `.form-row--3` / `.form-row--4`; Sì/No tri-state
   toggles `.yn`/`.yn__btn`; numeric `.stepper`s; internal-only marker
   `<span class="section-flag">Non visibile…</span>`. All classes are **global**
   (`assets/css/style/02-properties-media.css`) — any form can adopt them with no CSS work.
2. **Anagrafica** (shipped for proprietari, migration `phase59`, commit `d9c976b`) — a
   person record carries: `person_type` (fisica/giuridica), `company_name`, `vat_number`,
   `codice_fiscale`, `birth_place`, `birth_date`, `email`, `pec_email`, `address`, `city`,
   `cap`, `province`, `phone`; with a fisica↔giuridica toggle. `client_edit.*` is the
   proven copy-paste template.

---

## Overall verdict

**Layout is mostly fine.** Most forms already use `fieldset/legend` (tenant_edit,
lead_edit, invoice_edit, appointment_edit, automations, reminders, and even the
`properties.html` appraisal modal). The real value is in **three P1 correctness items**
and **a few P2 data/consistency fixes** — not a mass cosmetic rewrite.

---

## P1 — correctness (bugs + legal). Do these first.

### 1. Tenant (conduttore) anagrafica for RLI registration — *migration + form + API*
- **Problem:** `tenants` holds only `name, surname, email, codice_fiscale, phone` (+ SEPA
  `iban/sdd_*`, consents). It has **no birth place/date and no residence** — which are
  **legally required to register a locazione via RLI** at the Agenzia delle Entrate.
  Persona giuridica fields are also absent (commercial leases).
- **Fix:** new migration `phase60_tenant_anagrafica.sql` **mirroring phase59** adding
  `person_type, company_name, vat_number, birth_place, birth_date, pec_email, address,
  city, cap, province` (CF already exists). Then add "Dati anagrafici / Residenza"
  sections + fisica/giuridica toggle to `tenant_edit.html`/`.js`, and field handling in
  `api/tenants.php` `createTenant`/`updateTenant`. Also enrich the contract/RLI PDF
  tenant block (same pattern as the mandate's `mandantePairs`).
- **Effort:** **M** (proven copy of the proprietari change). **Migration:** yes.

### 2. `convertLeadToTenant` writes columns that no longer exist → 500 (**verified**)
- **Problem:** `api/leads.php:376` `INSERT INTO tenants (property_id, …, lease_start,
  lease_end, monthly_rent, …)` — all four were **dropped from `tenants` in `phase26`**
  (moved to `contracts`). Confirmed absent in the live DB, so this endpoint 500s.
- **Fix:** rewrite the conversion to insert only real tenant columns (name, surname,
  email, phone, CF, notes, status) and create the lease as a **contracts** row (as the
  normal create path does). Add the new anagrafica fields from item 1 while here.
- **Effort:** **S–M**. **Migration:** no (depends on item 1 for extra fields).

### 3. `leads.codice_fiscale` created by no migration — cold-start drift (**verified**)
- **Problem:** `api/leads.php` reads/writes/searches `codice_fiscale`, and the prod dump
  has it, but **no file in `database/migrations/` creates it**. A DB built purely from
  migrations lacks the column → `createLead`/`updateLead`/`listLeads` 500. Implicates
  CLAUDE.md §5.1 cold-start.
- **Fix:** one-line idempotent migration `ALTER TABLE leads ADD COLUMN codice_fiscale
  VARCHAR(16) NULL AFTER surname` (+ index), via the `migration_add_column` helper.
- **Effort:** **S**. **Migration:** yes (trivial). No form/API change.

---

## P2 — data integrity + high-value consistency

### 4. `suppliers.category` form options ≠ DB enum → failed/blank writes (**verified**)
- DB enum: `idraulico, elettricista, muratore, falegname, imbianchino, giardiniere,
  pulizie, altro`. Form offers `giardinaggio, ascensore, serrature` (not in enum) and
  omits `imbianchino, giardiniere`. Selecting the non-enum options fails under MySQL
  strict mode.
- **Fix (decision needed):** either **expand the enum** (add `ascensore, serrature`,
  reconcile `giardinaggio`↔`giardiniere`) — recommended, keeps the categories the UI
  wants — or align the form to the existing enum. **Effort S.** Migration only if expanding.

### 5. `property_insurance.policy_type` form options ≠ DB enum → failed writes (**verified**)
- DB enum: `incendio, responsabilita, globale_fabbricato, altro`. Modal form
  (`insurance.html:100`) offers `furto, responsabilita_civile, multirischio, vita` — none
  match except `incendio`. `api/insurance.php` passes the value straight through.
- **Fix (decision needed):** expand the enum to cover the real policy types
  (`furto, responsabilita_civile, multirischio, vita`) — recommended — or remap the form.
  **Effort S.** Migration if expanding.

### 6. `buildings.html` modal — ad-hoc `<h4>` + border divider → proper fieldsets
- The one clear layout deviation in the modal set: replace the hand-rolled subheading
  with two `<fieldset class="form-section"><legend>` blocks ("Dati edificio" /
  "Amministratore di condominio"). **Effort S.** No migration.

### 7. `invoice_edit.html` — expose `property_id` (exists, not saved)
- `invoices.property_id` exists (phase21) and the list endpoint filters on it, but the
  form doesn't show it and the INSERT/UPDATE don't persist it. Add an "Immobile" select +
  2 SQL lines in `api/invoices.php`. **Effort S.** No migration.

### 8. `contract_edit.html` — finish the sectioning
- Half-sectioned: only the fiscal block is a fieldset; the top block (type/parties/
  dates/rent) is flat. Wrap into "Dati contratto", "Parti", "Durata e canone", "Note".
  Fiscally **complete** already (cedolare, RLI, imposta/bollo, ISTAT all wired).
  **Effort M.** No migration.

### 9. `aml.html` — section the ~20-field flat modal
- Longest, legally-sensitive form (adeguata verifica, D.lgs 231/2007), currently flat.
  Group into "Soggetto", "Verifica e rischio", "Documento d'identità", "Date e
  conservazione". Big readability win. **Effort M.** No migration.

---

## P3 — cosmetic / optional polish (do in a batch, or skip)

- `settings.html` — convert `<h3>/<hr>` dividers to `fieldset/legend` (M; static HTML only).
- `expense_edit.html`, `payment_edit.html` — wrap flat rows in fieldsets (S each).
- `documents.html`, `portal_sync.html`, `commissions.html`, `social.html`,
  `valuation.html`, `property_applications.html`, `surveys.html` — short enough that flat
  is acceptable; sectioning optional. `commissions` free-text "ID Contratto" could become
  a select (minor UX).
- **Deferred (need new migrations, out of current scope):** invoice e-invoice/SdI fields
  (codice destinatario, split payment, ritenuta, bollo, natura IVA) — the dedicated
  `fattura_transmissions` layer is their intended home; expense VAT breakdown + paid-status.

---

## Already conform — no work

`automations.html` (reference-grade), `reminders.html`, `appointment_edit.html`,
`invoice_edit.html` (layout), `tenant_edit.html`/`lead_edit.html` (**layout** — their gap
is data, see P1), `meters.html`, `keys.html`, `inventory.html`, `properties.html`
appraisal modal. `agents.html` has no form. `communications.html` is a chat composer —
must **not** be sectioned.

---

## Recommended execution order

1. **Batch A (P1 correctness):** items 3 (leads CF migration) → 2 (fix convert bug) →
   1 (tenant anagrafica: `phase60` + form + API + contract PDF). Verify each live.
2. **Batch B (P2 data bugs):** items 4 & 5 (enum reconciliations) — quick, high-safety.
3. **Batch C (P2 layout):** items 6, 7, 8, 9.
4. **Batch D (P3):** optional consistency sweep, only if you want it.

Each batch is independently shippable and independently verifiable (HTTP round-trip +
DB check + browser screenshot), same protocol as the proprietari change.

---

## Decisions needed before acting

- **D1 — enum fixes (items 4, 5):** expand the DB enums (recommended) or trim the form
  options? Expanding preserves the categories the UI already offers.
- **D2 — tenant giuridica (item 1):** include persona giuridica fields now (commercial
  leases) or ship persona-fisica anagrafica only? Recommend including — it's a free copy
  of phase59.
- **D3 — scope:** do Batches A+B+C, or A+B only, and defer all P3?

---

## Evidence (P1/P2 claims verified directly)

- `tenants` live columns: `id, name, surname, email, codice_fiscale, phone, notes, status,
  created_at, updated_at, agency_id, privacy/marketing/anonymized, iban, sdd_mandate_ref,
  sdd_mandate_date` — **no birth/residence/person_type**. `property_id/lease_*/monthly_rent`
  absent (dropped `phase26:191`).
- `api/leads.php:376` inserts those dropped columns into `tenants` → guaranteed 500.
- No migration matches `ALTER TABLE leads … codice_fiscale` (grep of `database/migrations/`).
- `suppliers.category` enum vs form options — mismatch on `giardinaggio/ascensore/serrature`.
- `property_insurance.policy_type` enum `(incendio,responsabilita,globale_fabbricato,altro)`
  vs form `furto/responsabilita_civile/multirischio/vita`.
