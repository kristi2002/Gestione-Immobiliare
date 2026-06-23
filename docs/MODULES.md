# Gestione Immobiliare — Module Guide

A plain-language reference for every sidebar item: what it is, what you can do in it, and how it connects to everything else.

---

## Key Concepts First

Before the module list, three terms that can be confusing:

| Term | Italian label | Who they are |
|---|---|---|
| **Client** | Proprietario | The property **owner** — the person who hires the agency to manage or sell their property. |
| **Lead** | Lead | A **potential buyer or tenant** — someone who expressed interest but hasn't signed anything yet. |
| **Tenant** | Inquilino | A person who is **actively renting** one of the managed properties. Has a lease and pays rent. |

A person typically moves through the system like this:
```
Lead → (viewing → interest → negotiation) → converted to Client
                                              Client → (if renting) → Tenant created manually
```
Clients own properties. Leads want to rent or buy them. Tenants already live in them.

> **Note on conversion:** The system's "Convert to Client" button creates a new **Client (proprietario)** record from the lead's data. It does not create a Tenant automatically. If the converted person ends up renting rather than buying, a Tenant record must be created separately and linked to the property.

---

## The 33 Modules

### Dashboard

The home screen. Shows key numbers at a glance: how many properties are rented vs. available, upcoming reminders for the next 7 days, monthly revenue collected vs. expected. You can customise up to 9 quick-access shortcuts to the sections you use most.

**Connects to:** everything (read-only aggregation).

---

## Group: Persone

### Proprietari (Clients)

The owners of the properties the agency manages. Each client has a name, tax ID, phone, email, and status (active / archived). You can upload their ID card photos and generate a monthly owner report (PDF) showing their properties, collected rent, and expenses.

**Connects to:** Properties (a client owns them), Contracts (as the landlord), Communications, Invoices, Documents, Reminders, Expenses, Automations.

---

### Leads

People who have shown interest in renting or buying a property but haven't committed yet. A lead has a budget range, preferred property type, city, and minimum size. The system automatically finds matching properties from the portfolio.

Leads move through a funnel: `new → contacted → interested → negotiating → converted → lost`.

The "Convert" button always creates a **Client (proprietario)** record — regardless of whether the lead wants to rent or buy. It copies the lead's name, tax ID, phone, and email into a new client row and marks the lead as `converted`.

> **Platform gap:** A lead interested in renting (`interest_type = affitto`) logically should become a **Tenant**, not a property owner. The platform has no "Convert to Tenant" button. In practice, after converting a renting lead to a client you would need to manually create a separate Tenant record for them. This is a known missing flow.

> **Note on agents:** "Agent" in this system means an admin user with the `agent` role — there is no separate agents table. Leads, appointments, and commissions all reference the `admin_users` table.

**Connects to:** Agents/admin users (assigned to one), Appointments (viewings), Properties (interest matching), Invoices (optional, pre-contract billing), Property Applications (source of enquiry).

---

### Inquilini (Tenants)

People currently renting a property. Each tenant is linked to exactly one property with a lease start/end date and monthly rent amount. Tenants have access to a separate portal where they can submit maintenance requests and fill in satisfaction surveys.

**Connects to:** Properties (the one they rent), Contracts (their lease), Payments (monthly rent records), Maintenance Workflow (they submit problems), Surveys (they receive feedback requests), WhatsApp (credentials sent via WhatsApp).

---

### Portafoglio Agenti (Agents)

A performance dashboard for the agents who work in the agency. Shows each agent's assigned leads, scheduled viewings, held keys, conversion rate, and pending commissions. Agents are created and managed in **Settings → Users**.

> **Important:** There is no separate agents table in the database. An "agent" is simply an admin user with the `agent` role. All module links (leads.assigned_to, appointments.agent_id, agent_commissions.admin_user_id) point to the `admin_users` table.

**Connects to:** Leads (assigned to), Appointments (assigned to), Keys (who holds them), Commissions (earnings).

---

## Group: Immobili

### Immobili (Properties)

The core of the system. Every property has an owner (client), address, type (apartment, villa, office, shop, garage, land), size, number of rooms, and status (available / rented / sold / archived). You can upload an unlimited photo/video/floor-plan gallery, track the price history, and record professional appraisals. The system can geocode addresses automatically to show them on the map. A shareable link and QR code can be generated for each property.

**Connects to:** Clients (owner), Tenants, Contracts, Payments, Expenses, Documents, Reminders, Inventory, Insurance, Meters, Keys, Social Posts, Appointments, Maintenance Requests, Buildings.

---

### Edifici (Buildings)

Groups multiple properties that belong to the same physical building or complex (e.g. an apartment block with 12 units). Tracks how many units are occupied vs. vacant.

**Connects to:** Properties (a building contains many).

---

### Mappa (Map)

Displays all properties as pins on an interactive map. Pins are colour-coded by status (green = available, blue = rented, grey = sold). Click a pin to see the property's owner and status. Missing coordinates can be geocoded in bulk.

**Connects to:** Properties (reads their latitude/longitude).

---

### Chiavi (Keys)

Tracks physical keys for each property: who holds them (an agent or a custom name), where they are stored, and when they were taken out or returned. Keys can be marked as lost.

**Connects to:** Properties, Agents.

---

### Contatori (Meters)

Records utility meter readings (gas, electricity, water, heating) for each property. The system calculates estimated consumption between readings.

**Connects to:** Properties.

---

### Inventario (Inventory)

A per-property checklist of furniture and fittings: item name, category (furniture / appliance / fixture / system), quantity, and condition (1–5 stars). Used to document the state of a property at check-in. A printable check-in report can be generated.

**Connects to:** Properties.

---

## Group: Documenti

### Contratti (Contracts)

Formal agreements between the agency and its clients or tenants. Types include lease, sale, preliminary, mandate, and other. Each contract links a property to a tenant and/or owner, has start/end dates, and tracks its status (draft → sent → signed → expired). Supports e-signature: generate a link, send it to the signer, and the system records when they sign. A contract can also reference a stored PDF from Documents.

> **Note:** Contracts can auto-generate the full payment schedule via the **"Genera scadenzario"** button (visible on `locazione` contracts that have a tenant, monthly rent, and start/end dates set). This calls `api/contracts.php?action=generate_payments` which inserts one payment row per month, each linked back to the contract via `contract_id`.

**Connects to:** Properties (required), Tenants (optional), Clients (as landlord, optional), Documents (optional — the signed PDF), Commissions (agency fee for the deal), Reminders (manually created expiry alerts).

---

### Documenti (Documents)

A general-purpose file store for PDFs, images, and Word documents up to 25 MB. Each file is associated with a client and/or a property. Examples: ID scans, utility bills, inspection reports, planning permissions.

**Connects to:** Clients (optional), Properties (optional). Must be linked to at least one.

---

### Fatture (Invoices)

Invoices issued by the agency, addressed to a client or a lead. Includes amount, VAT rate, due date, and status (draft / sent / paid / cancelled). PDFs can be generated and emailed directly.

**Connects to:** Clients or Leads (recipient).

---

## Group: Finanze

### Pagamenti (Payments)

The rent payment schedule. Each record represents one month's rent for a tenant at a property: amount due, due date, and whether it has been paid, is pending, or is late. The view includes a monthly calendar to spot overdue payments at a glance.

**Connects to:** Tenants (required), Properties (required), Contracts (via `contract_id` FK — links each payment to its lease period), Forecast (feeds revenue projections), Reports (collected revenue totals).

---

### Spese (Expenses)

Costs associated with properties or clients: maintenance, utilities, taxes, insurance premiums, agency fees. Each expense has a category, amount, date, and optional receipt link.

**Connects to:** Properties (optional), Clients (optional), Reports (aggregated).

---

### Provvigioni (Commissions)

Commission records for agents, linked optionally to a contract, a property, and/or a client. Each commission has a type (vendita / locazione / gestione / altro), an amount and percentage, a due date, and a status (pending / paid).

**Connects to:** Agent / admin user (required), Contracts (optional), Properties (optional), Clients (optional).

---

### Previsioni (Forecast)

A forward-looking revenue dashboard for the next 6, 12, or 24 months. Shows expected income, occupancy rate, top-earning properties, and overdue ("insoluti") payments. Useful for financial planning.

**Connects to:** Contracts (expected rent), Tenants (occupancy), Payments (collected amounts).

---

### Report

A yearly financial summary: total expected vs. collected revenue, total expenses by category, and a property portfolio breakdown. Can be exported to CSV.

**Connects to:** Properties, Payments, Expenses.

---

## Group: Gestione

### Manutenzione (Maintenance Workflow)

A kanban/table view for tracking repair and maintenance requests. Tickets can be created by the agency manually, or by tenants through the tenant portal.

**Architectural note:** There is no separate maintenance table. Maintenance tickets are stored as rows in the **Reminders** table filtered by `type = 'maintenance'`. The reminders table has dedicated columns for this: `maintenance_status`, `supplier_id`, `supplier_name`, `priority`, `request_type`, `tenant_name`, and a `tenant_id` FK (added in phase24) that links the ticket to the specific tenant who submitted it.

The kanban board columns map to `maintenance_status` values: aperta → in_lavorazione → completata → chiusa.

**Connects to:** Properties (required), Clients/owners (via property), Tenants (via `tenant_id` FK), Suppliers (assigned via `supplier_id`).

---

### Assicurazioni (Insurance)

Tracks insurance policies for each property: insurer name, policy number, type (fire, theft, liability, multi-risk, life), annual premium, and expiry date. A warning flag appears for policies expiring within 30 days.

**Connects to:** Properties, Clients (via property ownership).

---

### Fornitori (Suppliers)

A directory of contractors and service providers used by the agency: plumbers, electricians, masons, cleaners, etc. Each supplier has contact details, a category, and a star rating.

**Connects to:** Maintenance Workflow (assigned to tickets).

---

### Richieste (Property Applications)

Online enquiries from prospective tenants or buyers who filled in an application form for a specific property (via a public application link). Each application shows the applicant's name, contact, type (rent / purchase), message, and status (new / contacted / approved / rejected). Applications can be converted into Leads.

**Connects to:** Properties, can convert to → Leads.

---

## Group: Comunicazioni

### Comunicazioni (Communications)

A chat-style inbox grouped by client. Tracks all email and WhatsApp messages sent to or received from each client. You can compose emails (via SMTP) or WhatsApp messages (via Twilio) directly, and manually log inbound messages.

**Connects to:** Clients (conversation partner), WhatsApp templates, Email templates.

---

### WhatsApp Inbox

A dedicated view for WhatsApp conversation threads — similar to Communications but focused on incoming messages from any phone number, not just registered clients. Shows full message history with timestamps and delivery status. Powered by Twilio.

**Connects to:** Clients / Tenants (by phone number, optional), Twilio (integration).

---

### Social Media

Manages Facebook and Instagram posts for property listings. You connect the agency's Meta account, create a post (caption + image from the property gallery), choose the platform and scheduled date, and the system publishes it automatically via the Meta Graph API.

**Connects to:** Properties (optional, to pull photos), Meta / Facebook / Instagram (integration).

---

### Sondaggi (Surveys)

Collects satisfaction feedback from tenants. Generate a one-time survey link for a specific tenant and send it to them. The survey asks about overall experience, maintenance quality, and communication. Results are shown with averages.

**Connects to:** Tenants, Properties.

---

## Group: Agenda

### Visite (Appointments)

Property viewings scheduled for leads or clients. Each appointment links a property to a visitor (lead or client) and optionally assigns an agent. Tracks whether the visit was completed, cancelled, or a no-show.

**Connects to:** Properties, Leads (visitor), Clients (visitor), Agents (assigned).

---

### Calendario (Calendar)

A monthly calendar that overlays all reminders on their due dates. Click a day to see what is due. Navigating the calendar does not affect data — it is a read-only view of Reminders.

**Connects to:** Reminders.

---

### Promemoria (Reminders)

Manual or recurring alerts. Can be linked to a client or property and can trigger automatic emails to the admin and/or the client. Frequencies: once, weekly, bi-weekly, monthly, quarterly, yearly. Typical uses: contract renewal, insurance expiry, property inspection.

**Shares backend with Maintenance Workflow:** The Reminders table also stores maintenance tickets. When viewing Reminders you see the general alerts; when viewing Manutenzione you see the same table filtered to `type = 'maintenance'`. The extra columns (`maintenance_status`, `supplier_id`, `priority`, etc.) are only used for that filtered subset.

**Connects to:** Clients (optional), Properties (optional), Suppliers (optional, when used as a maintenance ticket), Calendar, Dashboard (upcoming widget).

---

### Automazioni (Automations)

Scheduled email campaigns sent to specific clients on a recurring schedule. You write the subject and body (with variables like `{{Nome}}`), set a frequency (monthly, quarterly, etc.) and date range, and the system sends automatically via cron. Used for periodic updates, market reports, or greeting emails.

**Connects to:** Clients (recipient), SMTP (delivery).

---

## Group: Sistema

### Log Attività (Activity Log)

A read-only audit trail of every create, update, and delete action in the system. Records who did it, when, from which IP, and on which record. Cannot be edited or deleted.

**Connects to:** All modules (monitors them all).

---

### Impostazioni (Settings)

System-wide configuration. Organised into tabs:

- **Branding** — agency name, tagline, logo, primary colour.
- **Email (SMTP)** — outgoing mail server credentials, test button.
- **WhatsApp** — Twilio credentials for WhatsApp messaging.
- **Backup** — S3-compatible cloud backup configuration.
- **Social / Meta** — Facebook / Instagram OAuth connection.
- **WhatsApp Templates** — reusable message templates with `{{variables}}`.
- **Email Templates** — reusable email templates with `{{variables}}`.
- **Sicurezza (2FA)** — enable two-factor authentication via TOTP (Google Authenticator, Authy).
- **Utenti** *(super-admin only)* — create and manage admin accounts with roles: `super_admin`, `admin`, `agent`, `readonly`.

**Connects to:** All modules (global configuration source).

---

## Entity Relationship at a Glance

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
                    └── Appointments ◄── Lead ──(converted to)──► Client or Tenant

Agent ──assigned──► Leads
      ──assigned──► Appointments
      ──holds──►    Keys
      ──earns──►    Commissions ──linked to──► Contracts

Contract ──► Property + Tenant + Client
          └──► Payments (the rent schedule)
          └──► Commissions (agency fee)

Reminder ──► Client (optional) + Property (optional) ──► Email notification
Calendar ──reads──► Reminders

Communications ──► Client (email / WhatsApp thread)
WhatsApp Inbox ──► Any phone number (Twilio inbound)
Automations    ──► Client (scheduled email)

Social Posts ──► Property (photos) ──► Facebook / Instagram

Reports / Forecast ──read──► Payments + Expenses + Contracts
Activity Log ──monitors──► All modules
```

---

## Financial Data Flow

```
Contract (stores monthly_rent + start/end dates — reference only)
    │
    │  ← NO automatic link. Payment records created manually.
    ▼
Tenant (also stores monthly_rent independently)
    │
    │  ← Admin creates payment records manually, one per month
    ▼
Payment records (tenant_id + property_id + amount + due_date)
    ├── status: pending / paid / late
    └──► Forecast (reads payments for expected vs. collected revenue)
              └──► Reports (year-end summary)

Expenses (linked to property and/or client)
    └──► Reports (cost breakdown by category)
         └──► Owner Report PDF (per client, per month)

Commissions (linked to agent + optionally: contract, property, client)
    └──► Agent portfolio summary (Portafoglio Agenti view)
```

> **Key limitation:** Because payments have no contract FK, you cannot automatically tell which payments belong to which lease period. If a tenant rents twice (same property, two different contracts), all their payment records are indistinguishable by contract in the database.

---

---

## Known Platform Gaps

These are places where the real-world logic says one thing and the current implementation does something different or simpler.

| # | Area | What you'd expect | What actually happens |
|---|---|---|---|
| 1 | Lead → Tenant conversion | A lead who wants to rent converts to a **Tenant** | Conversion always creates a **Client (proprietario)**. A Tenant must be created separately by hand. |
| 2 | Payments auto-generation | Signing a lease contract generates monthly payment records | Payment records are created **manually**, one at a time. No link between a payment and its contract. |
| 3 | Maintenance vs Reminders | Maintenance tickets live in their own table | They are stored as **Reminder rows** with `type=maintenance`. The Manutenzione view is just a filtered view of Reminders. |
| 4 | Tenant identity on maintenance tickets | A ticket is FK-linked to the tenant who submitted it | The tenant's name is stored as **free text** in the description. No `tenant_id` FK on the reminder/ticket row. |

---

*Last updated: June 2026*
