# 03 — Features & Modules

> Consolidated from docs/MODULES.md and README feature list. A plain-language reference for
> every sidebar item: what it is, what you can do, and how it connects to everything else.

---

## Key concepts first

| Term | Italian label | Who they are |
|---|---|---|
| **Client** | Proprietario | The property **owner** who hires the agency to manage or sell property. |
| **Lead** | Lead | A **potential buyer or tenant** who expressed interest but hasn't signed anything. |
| **Tenant** | Inquilino | A person **actively renting** a managed property. Has a lease and pays rent. |

Typical lifecycle:
```
Lead → (viewing → interest → negotiation) → converted to Client
                                            Client → (if renting) → Tenant created manually
```
Clients own properties. Leads want to rent/buy them. Tenants already live in them.

> **Agents** are not a separate table. An "agent" is an `admin_users` row with the `agent`
> role. All links (`leads.assigned_to`, `appointments.agent_id`,
> `agent_commissions.admin_user_id`) point to `admin_users`.

---

## The 33 modules, by sidebar group

### Dashboard
Home screen with key numbers: rented vs available properties, upcoming reminders (next 7
days), monthly revenue collected vs expected. Up to 9 customisable quick-access shortcuts.
**Connects to:** everything (read-only aggregation).

---

### Group: Persone

**Proprietari (Clients).** Property owners — name, tax ID (codice fiscale), phone, email,
status (active/archived). Upload ID card photos; generate a monthly owner report (PDF) with
properties, collected rent, and expenses.
*Connects to:* Properties, Contracts (landlord), Communications, Invoices, Documents, Reminders, Expenses, Automations.

**Leads.** People interested in renting/buying. Budget range, preferred type/city, minimum
size; the system auto-matches properties. Funnel: `new → contacted → interested →
negotiating → converted → lost`. "Convert" creates a **Client**; a separate "Converti in
Inquilino" flow creates a **Tenant + contract** (`api/leads.php?action=convert_tenant`).
*Connects to:* Agents, Appointments, Properties, Invoices, Property Applications.

**Inquilini (Tenants).** People currently renting; linked to exactly one property with lease
start/end and monthly rent. Have a separate portal for maintenance requests and surveys.
*Connects to:* Properties, Contracts, Payments, Maintenance, Surveys, WhatsApp.

**Portafoglio Agenti (Agents).** Performance dashboard per agent: assigned leads, viewings,
held keys, conversion rate, pending commissions. Agents managed in Settings → Users.
*Connects to:* Leads, Appointments, Keys, Commissions.

---

### Group: Immobili

**Immobili (Properties).** Core entity. Owner (client), address, type (apartment/villa/
office/shop/garage/land), size, rooms, status (available/rented/sold/archived). Unlimited
photo/video/floor-plan gallery, price history, professional appraisals, address geocoding,
shareable link + QR code.
*Connects to:* Clients, Tenants, Contracts, Payments, Expenses, Documents, Reminders, Inventory, Insurance, Meters, Keys, Social Posts, Appointments, Maintenance, Buildings.

**Edifici (Buildings).** Groups multiple properties in one physical building/complex; tracks
occupied vs vacant units. *Connects to:* Properties.

**Mappa (Map).** All properties as colour-coded pins (green=available, blue=rented,
grey=sold). Bulk-geocode missing coordinates. *Connects to:* Properties (lat/lng).

**Chiavi (Keys).** Physical key tracking: holder (agent or custom name), storage location,
taken-out/returned dates, lost flag. *Connects to:* Properties, Agents.

**Contatori (Meters).** Utility meter readings (gas/electricity/water/heating) with estimated
consumption between readings. *Connects to:* Properties.

**Inventario (Inventory).** Per-property furniture/fittings checklist: item, category,
quantity, condition (1–5 stars). Printable check-in report. *Connects to:* Properties.

---

### Group: Documenti

**Contratti (Contracts).** Agency agreements: lease (locazione), sale (compravendita),
preliminary, mandate, other. Links property to tenant and/or owner; start/end dates; status
draft → sent → signed → expired. Supports e-signature (token link). The **"Genera
scadenzario"** button (on `locazione` contracts with tenant + rent + dates) calls
`api/contracts.php?action=generate_payments` to insert one payment row per month, linked via
`contract_id`. *Connects to:* Properties, Tenants, Clients, Documents, Commissions, Reminders.

**Documenti (Documents).** General file store (PDF, images, Word) up to 25 MB, associated
with a client and/or property. IDs, bills, inspection reports, permits.
*Connects to:* Clients, Properties (at least one required).

**Fatture (Invoices).** Agency-issued invoices to a client or lead: amount, VAT rate, due
date, status (draft/sent/paid/cancelled). PDF generate + email. *Connects to:* Clients/Leads.

---

### Group: Finanze

**Pagamenti (Payments).** Rent schedule — one record per month per tenant/property: amount,
due date, status (pending/paid/late). Monthly calendar view. *Connects to:* Tenants,
Properties, Contracts (`contract_id` FK), Forecast, Reports.

**Spese (Expenses).** Property/client costs: maintenance, utilities, taxes, insurance, fees.
Category, amount, date, optional receipt. *Connects to:* Properties, Clients, Reports.

**Provvigioni (Commissions).** Agent commission records; optionally linked to contract,
property, client. Type (vendita/locazione/gestione/altro), amount, percentage, due date,
status. *Connects to:* Agent (required), Contracts, Properties, Clients.

**Previsioni (Forecast).** Forward revenue dashboard (6/12/24 months): expected income,
occupancy rate, top earners, overdue ("insoluti"). *Connects to:* Contracts, Tenants, Payments.

**Report.** Yearly financial summary: expected vs collected revenue, expenses by category,
portfolio breakdown. CSV export. *Connects to:* Properties, Payments, Expenses.

---

### Group: Gestione

**Manutenzione (Maintenance Workflow).** Kanban/table for repair tickets, created by staff or
by tenants via the tenant portal. **No separate table** — tickets are `reminders` rows with
`type = 'maintenance'`. Kanban columns map to `maintenance_status`: aperta → in_lavorazione →
completata → chiusa. Dedicated columns: `maintenance_status`, `supplier_id`, `supplier_name`,
`priority`, `request_type`, `tenant_name`, and `tenant_id` FK (added phase24).
*Connects to:* Properties, Clients (via property), Tenants (`tenant_id`), Suppliers.

**Assicurazioni (Insurance).** Policies per property: insurer, policy number, type, annual
premium, expiry. Warning flag for policies expiring within 30 days. *Connects to:* Properties, Clients.

**Fornitori (Suppliers).** Directory of contractors (plumbers, electricians, masons, cleaners,
…): contact, category, star rating. *Connects to:* Maintenance Workflow.

**Richieste (Property Applications).** Online enquiries from a public per-property application
form: name, contact, type (rent/purchase), message, status (new/contacted/approved/rejected).
Convertible to Leads. *Connects to:* Properties → Leads.

---

### Group: Comunicazioni

**Comunicazioni (Communications).** Chat-style inbox grouped by client; all email + WhatsApp
history. Compose email (SMTP) or WhatsApp (Twilio), manually log inbound.
*Connects to:* Clients, WhatsApp templates, Email templates.

**WhatsApp Inbox.** Dedicated WhatsApp thread view for any phone number (not just registered
clients). Full history with timestamps + delivery status. Powered by Twilio.
*Connects to:* Clients/Tenants (by phone), Twilio.

**Social Media.** Facebook/Instagram posts for listings. Connect the agency Meta account,
create a post (caption + gallery image), pick platform + schedule; publish via Graph API.
*Connects to:* Properties, Meta/Facebook/Instagram.

**Sondaggi (Surveys).** Tenant satisfaction feedback via one-time survey links (overall,
maintenance, communication ratings). Results shown as averages. *Connects to:* Tenants, Properties.

---

### Group: Agenda

**Visite (Appointments).** Property viewings for leads/clients; optionally assigned to an
agent; status completed/cancelled/no-show. *Connects to:* Properties, Leads, Clients, Agents.

**Calendario (Calendar).** Read-only monthly overlay of all reminders on their due dates.
*Connects to:* Reminders.

**Promemoria (Reminders).** Manual or recurring alerts linked to a client/property; can
trigger auto-emails to admin and/or client. Frequencies: once, weekly, biweekly, monthly,
quarterly, yearly. **Shares its table with Maintenance** (see note above).
*Connects to:* Clients, Properties, Suppliers, Calendar, Dashboard.

**Automazioni (Automations).** Scheduled recurring email campaigns to specific clients.
Subject/body with `{{Nome}}`-style variables, frequency + date range, sent via cron.
*Connects to:* Clients, SMTP.

---

### Group: Sistema

**Log Attività (Activity Log).** Read-only audit trail of every create/update/delete: who,
when, IP, which record. Cannot be edited/deleted. *Connects to:* all modules.

**Impostazioni (Settings).** System configuration, tabbed:
- **Branding** — agency name, tagline, logo, primary colour.
- **Email (SMTP)** — outgoing mail credentials + test button.
- **WhatsApp** — Twilio credentials.
- **Backup** — S3-compatible cloud backup config.
- **Social / Meta** — Facebook/Instagram OAuth.
- **WhatsApp Templates** / **Email Templates** — reusable templates with `{{variables}}`.
- **Sicurezza (2FA)** — TOTP (Google Authenticator, Authy).
- **Utenti** *(super-admin only)* — manage admin accounts and roles.

---

## Entity relationship at a glance

```
Client ──owns──► Property ──rented to──► Tenant
                    │                       │
                    ├── Contracts            ├── Payments (rent)
                    ├── Documents            ├── Maintenance tickets
                    ├── Expenses             └── Surveys
                    ├── Insurance
                    ├── Meters
                    ├── Inventory
                    ├── Keys
                    └── Appointments ◄── Lead ──(converted)──► Client or Tenant

Agent ──assigned──► Leads / Appointments
      ──holds──►    Keys
      ──earns──►    Commissions ──linked to──► Contracts

Contract ──► Property + Tenant + Client
          └──► Payments (rent schedule)  └──► Commissions (agency fee)

Reminder ──► Client? + Property? ──► Email notification
Calendar ──reads──► Reminders
Communications ──► Client (email/WhatsApp)      WhatsApp Inbox ──► Any phone (Twilio)
Automations ──► Client (scheduled email)         Social Posts ──► Property ──► FB/IG
Reports / Forecast ──read──► Payments + Expenses + Contracts
Activity Log ──monitors──► All modules
```

---

## Financial data flow

```
Contract (stores monthly_rent + start/end dates)
    │  "Genera scadenzario" inserts monthly rows linked by contract_id
    ▼
Payment records (tenant_id + property_id + contract_id + amount + due_date)
    ├── status: pending / paid / late
    └──► Forecast (expected vs collected) ──► Reports (year-end)

Expenses (property and/or client) ──► Reports (cost by category) ──► Owner Report PDF
Commissions (agent + optional contract/property/client) ──► Agent portfolio summary
```

---

## Known platform gaps

These are places where real-world logic diverges from the implementation. Note that several
items the older MODULES.md listed as gaps were subsequently closed — cross-check with
[10-ROADMAP-GAPS-VERIFICATION.md](10-ROADMAP-GAPS-VERIFICATION.md).

| # | Area | Expectation | Reality |
|---|------|-------------|---------|
| 1 | Lead → Tenant conversion | A renting lead becomes a **Tenant** | Default "Convert" makes a **Client**; a separate "Converti in Inquilino" flow exists (`action=convert_tenant`) that creates tenant + contract. |
| 2 | Payment auto-generation | Signing a lease generates monthly payments | Requires clicking **"Genera scadenzario"**; payments carry a `contract_id` FK (phase-added). |
| 3 | Maintenance vs Reminders | Maintenance has its own table | Stored as `reminders` rows with `type=maintenance`; Manutenzione is a filtered view. |
| 4 | Tenant identity on tickets | Ticket FK-linked to the submitting tenant | **Discrepancy:** old MODULES.md said name is free-text only; DATABASE.md/INDEXING.md say a `tenant_id` FK was **added in phase24**. Trust the schema (FK exists); the free-text `tenant_name` is retained alongside. |

> The trailing "Known Platform Gaps" table in the original MODULES.md predates the phase24 FK
> addition — item #4 is stale. Verify against the live schema.
