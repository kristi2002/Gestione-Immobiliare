# 05 — Database Indexing Strategy

> Consolidated from docs/INDEXING.md. MySQL 8 / InnoDB. FKs enforced at engine level
> (`ON DELETE SET NULL` or `CASCADE`). All PKs are `INT UNSIGNED AUTO_INCREMENT` unless noted.

---

## Principles

1. **Every FK column gets an index.** InnoDB does not auto-index the referencing side of a FK. Without it, a parent `DELETE` full-scans the child to check referential integrity.
2. **Every `WHERE`-filter / `ORDER BY` column gets an index** — unless the table is small (<~1000 rows, rarely queried) or the column is very low-cardinality and never used alone.
3. **Composite indexes are ordered by selectivity** (most selective first), except range conditions which go last (MySQL left-prefix rule).
4. **Token / lookup columns always get an index** regardless of cardinality — queried by equality (`WHERE token=?`), so uniqueness gives a single-row lookup.
5. **`created_at` / date columns are indexed on high-volume tables** (`activity_log`, `communications`, `whatsapp_messages`) for filtering and `ORDER BY … DESC LIMIT N` pagination.

---

## Index inventory by table

### Core identity & auth
**`admin_users`** — PK `id`; `uk_admin_username` UNIQUE(`username`) login lookup; `idx_admin_role`(`role`) role checks + agent dropdowns.
**`settings`** — PK `setting_key` (VARCHAR) direct key-value lookup, no numeric PK.

### People
**`clients`** — PK `id` only. Status/name searches full-scan at current scale. *Add `idx_clients_status(status)` beyond ~10k rows.*
**`tenants`** — PK `id`; `uk_tenant_email` UNIQUE(`email`) dedup on conversion; `idx_tenants_property`(`property_id`) FK; `idx_tenants_status`(`status`).
**`tenant_users`** — PK `id`; `uk_tenant_users_tenant` UNIQUE(`tenant_id`).
**`leads`** — PK `id`; `idx_leads_status`(`status`) default filter drops converted/lost; `idx_leads_interest`(`interest_type`).
**`lead_property_matches`** — Composite PK `(lead_id, property_id)` covers uniqueness + both FK directions; no extra indexes.

### Properties
**`properties`** — PK `id`; `idx_properties_building`(`building_id`) FK; `idx_properties_cover_media`(`cover_media_id`) FK resolves cover image without scanning media. *Add `idx_properties_status_city(status, city)` at tens of thousands.*
**`property_media`** — PK `id`; `idx_media_property`(`property_id`) FK gallery + picker (`ORDER BY sort_order`); `idx_media_type`(`media_type`).
**`buildings` / `building_properties`** — PK `id`; pivot composite PK `(building_id, property_id)`.

### Contracts & payments
**`contracts`** — PK `id`; `idx_contracts_status`(`status`); `idx_contracts_dates`(`end_date`) expiry-cron range; `idx_ct_created_by`(`created_by`) FK.
**`payments`** — PK `id`; `idx_payments_due`(`due_date`) calendar + overdue; `idx_payments_status`(`status`) reminder cron; `idx_payments_contract`(`contract_id`) FK + generate_payments dedup. *`tenant_id`/`property_id` not yet indexed — add if `WHERE tenant_id=?` becomes slow.*
**`stripe_payments`** — PK `id`; `idx_sp_payment`(`payment_id`) FK; `idx_sp_session`(`stripe_session_id`) webhook lookup; `idx_sp_tenant`(`tenant_id`) FK.
**`payment_reminder_log`** — PK `id`; `idx_prl_payment`(`payment_id`); `idx_prl_sent`(`sent_at`); `idx_prl_tenant`(`tenant_id`); `idx_prl_client`(`client_id`).

### Documents & signing
**`documents`** — PK `id`; `idx_documents_client`(`client_id`); `idx_documents_property`(`property_id`); `idx_documents_type`(`doc_type`); `idx_documents_contract`(`contract_id`) (phase22).
**`esign_requests`** — PK `id`; `idx_esign_token`(`token`) public signer lookup; `idx_esign_status`(`status`); `idx_er_document`(`document_id`); `idx_er_contract`(`contract_id`) (phase22).

### Communications
**`communications`** — PK `id`; `idx_communications_client`(`client_id`); `idx_communications_created`(`created_at`) pagination; `idx_communications_channel`(`channel`).
**`whatsapp_messages`** — PK `id`; `idx_wm_from`(`from_number`) thread grouping; `idx_wm_direction`(`direction`); `idx_wm_read`(`is_read`) unread badge; `idx_wm_client`(`client_id`); `idx_wm_tenant`(`tenant_id`).

### Reminders & maintenance
**`reminders`** — PK `id`; `idx_rem_supplier`(`supplier_id`) FK; `idx_rem_tenant`(`tenant_id`) FK (phase24); `idx_notify_client`(`notify_client, status`) composite for the send cron. *Consider `idx_rem_type_date(type, reminder_date)` if the kanban grows.*

### Sales & leasing pipeline
**`appointments`** — PK `id`; `idx_appt_date`(`appointment_date`); `idx_appt_status`(`status`).
**`agent_commissions`** — PK `id`; `idx_ac_agent`(`admin_user_id`); `idx_ac_status`(`status`); `idx_ac_contract`(`contract_id`) (phase22); `idx_ac_property`(`property_id`); `idx_ac_client`(`client_id`).
**`property_applications`** — PK `id`; `idx_pa_property`(`property_id`); `idx_pa_status`(`status`); `idx_pa_lead`(`converted_to_lead_id`).

### Property details
**`property_insurance`** — PK `id`; `idx_pi_property`(`property_id`); `idx_pi_end_date`(`end_date`) expiry; `idx_pi_client`(`client_id`) (phase22).
**`meter_readings`** — PK `id`; `idx_mr_property`(`property_id`); `idx_mr_date`(`reading_date`).
**`property_appraisals`** — PK `id`; `idx_appraisal_property`(`property_id`).
**`price_history`** — PK `id`; `idx_price_hist_property`(`property_id`).
**`property_keys`** — PK `id`; `idx_keys_property`(`property_id`); `idx_keys_holder`(`holder_id`); `idx_keys_status`(`status`).

### Social & marketing
**`social_posts`** — PK `id`; `idx_social_posts_status`(`status`) cron filter; `idx_social_posts_scheduled`(`scheduled_at`) range.

### Finance & reporting
**`invoices`** — PK `id`; `idx_invoices_status`(`status`); `idx_invoices_number`(`invoice_number`); `idx_invoices_issue_date`(`issue_date`); `idx_invoices_due_date`(`due_date`); `idx_inv_created_by`(`created_by`); `idx_inv_property`(`property_id`).
**`expenses`** — PK `id`; `idx_expenses_date`(`expense_date`); `idx_expenses_supplier`(`supplier_id`); `idx_exp_created_by`(`created_by`).

### System & security
**`activity_log`** — PK `id`; `idx_activity_created`(`created_at`) audit feed sort.
**`login_attempts`** — PK `id`; `idx_login_ip_time`(`ip_address, attempted_at`) brute-force check.
**`api_rate_limits`** — PK `id`; `idx_rl_lookup`(`endpoint, ip_address, user_id, requested_at`) rate-limit check + prune.
**`pdf_documents`** — PK `id`; `idx_pdf_type`(`doc_type`); `idx_pdf_created_by`(`created_by`).
**`tenant_surveys`** — PK `id`; `idx_ts_tenant`(`tenant_id`); `idx_ts_token`(`token`) public form; `idx_ts_property`(`property_id`).
**`suppliers`** — PK `id`; `idx_sup_category`(`category`); `idx_sup_active`(`is_active`).
**`email_templates`** — PK `id`; `idx_et_category`(`category`); `idx_et_active`(`is_active`).

---

## Composite index rationale

- **`idx_contracts_dates (end_date)`** — the expiry cron queries `WHERE end_date BETWEEN … AND …` and never filters `start_date`. A composite `(start_date, end_date)` would be ignored (left-prefix rule), so a single-column index on `end_date` is correct.
- **`idx_notify_client (notify_client, status)`** — reminder cron always applies both `WHERE notify_client=1 AND status='pending'`. The combination is highly selective even though each column alone is low-cardinality.
- **`idx_login_ip_time (ip_address, attempted_at)`** and **`idx_rl_lookup (endpoint, ip_address, user_id, requested_at)`** — equality predicates first, range predicate last. The engine jumps to the right bucket, then scans only the narrow time window.

---

## Gaps & recommendations (pre-emptive)

| Table | Missing index | Reason to add |
|---|---|---|
| `clients` | `idx_clients_status(status)` | `WHERE status != 'archived'` scan beyond ~10k rows |
| `properties` | `idx_properties_status_city(status, city)` | Filter by status + sort by city — covering composite kills the filesort |
| `reminders` | `idx_rem_type_date(type, reminder_date)` | Maintenance kanban filters `type`; reminder cron filters `reminder_date` |
| `payments` | `idx_payments_tenant_due(tenant_id, due_date)` | Tenant history filters `tenant_id`, sorts `due_date DESC` |
| `whatsapp_messages` | `idx_wm_from_received(from_number, received_at)` | Inbox thread paginates by `from_number` ordered by `received_at DESC` |

None are causing problems at expected volume (single-agency, thousands of rows). They are
pre-emptive additions for months of production use.

---

## How to apply a missing index

Migrations use the idempotent `migration_add_index` helper from `000_helpers.sql`:

```sql
CALL migration_add_index(
    'payments',
    'idx_payments_tenant_due',
    '`tenant_id`, `due_date`'
);
```

For a new migration, copy the pattern from any `phaseN_*.sql` and save as
`database/migrations/phaseN_indexing.sql`. See
[09-DEPLOYMENT-OPERATIONS.md](09-DEPLOYMENT-OPERATIONS.md) for the full migration order.
