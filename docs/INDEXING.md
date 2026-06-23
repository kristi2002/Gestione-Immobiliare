# Database Indexing Strategy — Gestione Immobiliare

> MySQL 8 on InnoDB. All tables use `INT UNSIGNED AUTO_INCREMENT` surrogate primary keys
> unless noted. Foreign keys are enforced at the engine level (`FOREIGN KEY … ON DELETE SET NULL`
> or `CASCADE` depending on the relationship).

---

## Principles

1. **Every FK column gets an index.** InnoDB does not auto-index foreign key columns on the
   referencing side. Without an index, a `DELETE` on the parent table causes a full-table scan
   of the child to check referential integrity.

2. **Every column used in a `WHERE` filter or `ORDER BY` gets an index** — unless the table is
   small (< ~1 000 rows and rarely queried) or the column has very low cardinality and is never
   used alone (e.g. a boolean flag on a tiny lookup table).

3. **Composite indexes are ordered by selectivity** (most selective column first), except for
   range conditions which must go last. This matches the MySQL left-prefix rule.

4. **Token / lookup columns get their own index** regardless of cardinality because they are
   always queried with equality (`WHERE token = ?`), making selectivity irrelevant — uniqueness
   guarantees a single-row lookup.

5. **`created_at` and date columns are indexed on high-volume tables** (`activity_log`,
   `communications`, `whatsapp_messages`) because they are used both for filtering and for
   `ORDER BY … DESC LIMIT N` pagination.

---

## Index Inventory by Table

### Core Identity & Auth

#### `admin_users`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `uk_admin_username` | `username` | UNIQUE | Login lookup — enforces uniqueness, enables `WHERE username = ?` without scan |
| `idx_admin_role` | `role` | Index | Filter by role in role-check queries (`requireRole()`), agent dropdown lists |

#### `settings`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `setting_key` | PK (VARCHAR) | Direct key-value lookup — no numeric PK needed, the key itself is the identifier |

---

### People

#### `clients`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |

> Status and name searches use full-table scans at this scale (clients table is small). If the
> client list grows beyond ~10 000 rows, add `INDEX idx_clients_status (status)`.

#### `tenants`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `uk_tenant_email` | `email` | UNIQUE | Dedup check on conversion (`WHERE email = ? AND status != 'archived'`), enforces one account per address |
| `idx_tenants_property` | `property_id` | Index | FK index — join from property to its current tenant; also used for `WHERE property_id = ?` lookups |
| `idx_tenants_status` | `status` | Index | Filter active/archived tenants in list views |

#### `tenant_users` (portal auth)
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `uk_tenant_users_tenant` | `tenant_id` | UNIQUE | One portal account per tenant; FK index |

#### `leads`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_leads_status` | `status` | Index | Default view filters out `converted` / `lost` — this index drives that filter |
| `idx_leads_interest` | `interest_type` | Index | Filter by `affitto` / `acquisto` / `entrambi`; also controls which conversion button is shown |

#### `lead_property_matches`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `(lead_id, property_id)` | Composite PK | Pivot table — composite PK covers both the uniqueness constraint and the FK lookup from either side. No extra indexes needed. |

---

### Properties

#### `properties`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_properties_building` | `building_id` | Index | FK index — group properties by building |
| `idx_properties_cover_media` | `cover_media_id` | Index | FK index — resolves cover image in list queries without scanning `property_media` |

> `status` and `city` / `address` are sorted/filtered but on a small table — acceptable without
> an index at current scale. Add `INDEX idx_properties_status_city (status, city)` if listings
> grow to tens of thousands.

#### `property_media`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_media_property` | `property_id` | Index | FK index — fetch all photos for a property; used in gallery and social post picker (`ORDER BY sort_order`) |
| `idx_media_type` | `media_type` | Index | Filter by type (photo / document / floor_plan) |

#### `buildings` / `building_properties`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY (buildings) | `id` | PK | Row identity |
| PRIMARY (building_properties) | `(building_id, property_id)` | Composite PK | Pivot — covers uniqueness and both FK directions |

---

### Contracts & Payments

#### `contracts`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_contracts_status` | `status` | Index | Filter active / expired contracts in list views and expiry cron |
| `idx_contracts_dates` | `(end_date)` | Index | Range queries in the expiry cron (`WHERE end_date BETWEEN … AND …`). Single-column on `end_date` only — the cron never filters by `start_date`, so a composite `(start_date, end_date)` would violate the left-prefix rule and be skipped entirely by the query planner |
| `idx_ct_created_by` | `created_by` | Index | FK index — audit trail, filter by creating agent |

#### `payments`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_payments_due` | `due_date` | Index | Calendar view (`WHERE YEAR(due_date) = ? AND MONTH(due_date) = ?`), overdue detection |
| `idx_payments_status` | `status` | Index | Filter pending / late / paid; used by payment reminder cron |
| `idx_payments_contract` | `contract_id` | Index | FK index — fetch all payments for a contract (generate_payments dedup check) |

> `tenant_id` and `property_id` are also FK columns on payments but queries typically filter by
> `contract_id` or `status + due_date` rather than by tenant/property directly. Add indexes if
> `WHERE tenant_id = ?` queries become slow.

#### `stripe_payments`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_sp_payment` | `payment_id` | Index | FK index — look up Stripe record from internal payment ID |
| `idx_sp_session` | `stripe_session_id` | Index | Webhook handler looks up by Stripe session ID (`WHERE stripe_session_id = ?`) — must be fast |
| `idx_sp_tenant` | `tenant_id` | Index | FK index |

#### `payment_reminder_log`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_prl_payment` | `payment_id` | Index | FK index — check if reminder was already sent for a payment |
| `idx_prl_sent` | `sent_at` | Index | Prune old log entries by date |
| `idx_prl_tenant` | `tenant_id` | Index | FK index |
| `idx_prl_client` | `client_id` | Index | FK index |

---

### Documents & Signing

#### `documents`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_documents_client` | `client_id` | Index | FK index — list all documents for a client |
| `idx_documents_property` | `property_id` | Index | FK index — list all documents for a property |
| `idx_documents_type` | `doc_type` | Index | Filter by document category |
| `idx_documents_contract` | `contract_id` | Index | FK index (added phase22) |

#### `esign_requests`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_esign_token` | `token` | Index | Public signing endpoint lookups (`WHERE token = ?`) — the only query path for unauthenticated signers |
| `idx_esign_status` | `status` | Index | Filter pending / signed / expired in admin list |
| `idx_er_document` | `document_id` | Index | FK index |
| `idx_er_contract` | `contract_id` | Index | FK index (added phase22) |

---

### Communications

#### `communications`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_communications_client` | `client_id` | Index | FK index — load all comms for a client |
| `idx_communications_created` | `created_at` | Index | `ORDER BY created_at DESC` pagination |
| `idx_communications_channel` | `channel` | Index | Filter by whatsapp / email / sms |

#### `whatsapp_messages`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_wm_from` | `from_number` | Index | Thread view groups by `from_number` — most-used filter |
| `idx_wm_direction` | `direction` | Index | Filter inbound / outbound |
| `idx_wm_read` | `is_read` | Index | Unread badge count (`WHERE is_read = 0`) |
| `idx_wm_client` | `client_id` | Index | FK index |
| `idx_wm_tenant` | `tenant_id` | Index | FK index |

---

### Reminders & Maintenance

#### `reminders`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_rem_supplier` | `supplier_id` | Index | FK index — maintenance tickets assigned to a supplier |
| `idx_rem_tenant` | `tenant_id` | Index | FK index (added phase24) — links maintenance ticket to submitting tenant |
| `idx_notify_client` | `(notify_client, status)` | Composite | Reminder-send cron filters `WHERE notify_client = 1 AND status = 'pending'` — composite covers both predicates in one scan |

> `type` (`maintenance` vs generic reminder) and `reminder_date` are also frequently filtered.
> Consider adding `INDEX idx_rem_type_date (type, reminder_date)` if the reminders table grows
> large and the maintenance kanban becomes slow.

---

### Sales & Leasing Pipeline

#### `appointments`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_appt_date` | `appointment_date` | Index | Calendar view, upcoming appointments list |
| `idx_appt_status` | `status` | Index | Filter confirmed / cancelled / completed |

#### `agent_commissions`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_ac_agent` | `admin_user_id` | Index | FK index — agent portfolio view |
| `idx_ac_status` | `status` | Index | Filter pending / paid commissions |
| `idx_ac_contract` | `contract_id` | Index | FK index (added phase22) |
| `idx_ac_property` | `property_id` | Index | FK index |
| `idx_ac_client` | `client_id` | Index | FK index |

#### `property_applications`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_pa_property` | `property_id` | Index | FK index — applications per property |
| `idx_pa_status` | `status` | Index | Filter new / contacted / approved |
| `idx_pa_lead` | `converted_to_lead_id` | Index | FK index — trace back from lead to originating application |

---

### Property Details

#### `property_insurance`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_pi_property` | `property_id` | Index | FK index |
| `idx_pi_end_date` | `end_date` | Index | Expiry warning queries (`WHERE end_date < DATE_ADD(NOW(), INTERVAL 30 DAY)`) |
| `idx_pi_client` | `client_id` | Index | FK index (added phase22) |

#### `meter_readings`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_mr_property` | `property_id` | Index | FK index — load readings for a property |
| `idx_mr_date` | `reading_date` | Index | Sort / range by date |

#### `property_appraisals`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_appraisal_property` | `property_id` | Index | FK index |

#### `price_history`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_price_hist_property` | `property_id` | Index | FK index — chart price over time for a property |

#### `property_keys`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_keys_property` | `property_id` | Index | FK index |
| `idx_keys_holder` | `holder_id` | Index | Find all keys held by an agent (`WHERE holder_id = ? AND status = 'out'`) |
| `idx_keys_status` | `status` | Index | Filter out / in / lost |

---

### Social & Marketing

#### `social_posts`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_social_posts_status` | `status` | Index | Cron filter `WHERE status = 'scheduled'` |
| `idx_social_posts_scheduled` | `scheduled_at` | Index | `WHERE scheduled_at <= NOW()` in the publish cron — range condition benefits from index |

---

### Finance & Reporting

#### `invoices`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_invoices_status` | `status` | Index | Filter draft / sent / paid |
| `idx_invoices_number` | `invoice_number` | Index | Lookup by number (human-readable reference) |
| `idx_invoices_issue_date` | `issue_date` | Index | Date range filters in reports |
| `idx_invoices_due_date` | `due_date` | Index | Overdue detection |
| `idx_inv_created_by` | `created_by` | Index | FK index — filter by agent |
| `idx_inv_property` | `property_id` | Index | FK index |

#### `expenses`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_expenses_date` | `expense_date` | Index | Date range filters in reports |
| `idx_expenses_supplier` | `supplier_id` | Index | FK index — expenses per supplier |
| `idx_exp_created_by` | `created_by` | Index | FK index |

---

### System & Security

#### `activity_log`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_activity_created` | `created_at` | Index | `ORDER BY created_at DESC LIMIT N` for the audit feed — without this the sort scans the entire (high-volume) table |

#### `login_attempts`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_login_ip_time` | `(ip_address, attempted_at)` | Composite | Brute-force check: `WHERE ip_address = ? AND attempted_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`. Composite covers both predicates — IP equality first (high selectivity), then time range |

#### `api_rate_limits`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_rl_lookup` | `(endpoint, ip_address, user_id, requested_at)` | Composite | Rate-limit check: `WHERE endpoint = ? AND ip_address = ? AND user_id <=> ? AND requested_at >= ?`. All four columns in one index; the DELETE prune also uses this index |

#### `pdf_documents`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_pdf_type` | `doc_type` | Index | Filter by PDF category |
| `idx_pdf_created_by` | `created_by` | Index | FK index |

#### `tenant_surveys`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_ts_tenant` | `tenant_id` | Index | FK index |
| `idx_ts_token` | `token` | Index | Public survey form lookup (`WHERE token = ?`) |
| `idx_ts_property` | `property_id` | Index | FK index |

#### `suppliers`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_sup_category` | `category` | Index | Filter by trade (plumber, electrician, etc.) |
| `idx_sup_active` | `is_active` | Index | Active-only dropdown filter |

#### `email_templates`
| Index | Columns | Type | Purpose |
|---|---|---|---|
| PRIMARY | `id` | PK | Row identity |
| `idx_et_category` | `category` | Index | Group templates by category |
| `idx_et_active` | `is_active` | Index | Active-only filter |

---

## Composite Index Rationale

Three composite indexes deserve explicit explanation:

### `idx_contracts_dates (end_date)`
The contract expiry cron queries `WHERE end_date BETWEEN :start AND :end` — it never filters by
`start_date`. MySQL's left-prefix rule means a composite `(start_date, end_date)` would be
completely ignored for this query because the leading column (`start_date`) is absent from the
`WHERE` clause. The index is therefore a simple single-column index on `end_date`.

### `idx_notify_client (notify_client, status)`
The reminder cron always applies both predicates: `WHERE notify_client = 1 AND status = 'pending'`.
A composite covering both columns means the engine reads only the matching rows with zero
filtering waste. Selectivity is low on each column individually, but the combination is highly
selective (most reminders are either already sent or don't notify the client).

### `idx_login_ip_time (ip_address, attempted_at)` and `idx_rl_lookup (endpoint, ip_address, user_id, requested_at)`
Both follow the same pattern: equality predicates first, range predicate last. MySQL can use the
equality columns to jump directly to the right bucket, then scan only the narrow time window.
Putting the range column first would force a full range scan across all IPs/endpoints.

---

## Gaps & Recommendations

| Table | Missing Index | Reason to Add |
|---|---|---|
| `clients` | `idx_clients_status (status)` | If the client list grows beyond ~10 000 rows, `WHERE status != 'archived'` will become a noticeable scan |
| `properties` | `idx_properties_status_city (status, city)` | The property list always filters by status and sorts by city — a covering composite would eliminate the filesort |
| `reminders` | `idx_rem_type_date (type, reminder_date)` | Maintenance kanban filters by `type = 'maintenance'`; the generic reminder cron filters by `reminder_date` — one composite serves both |
| `payments` | `idx_payments_tenant_due (tenant_id, due_date)` | Tenant payment history queries filter by `tenant_id` and sort by `due_date DESC` — a composite avoids the sort step |
| `whatsapp_messages` | `idx_wm_from_received (from_number, received_at)` | The inbox thread view paginates by `from_number` ordered by `received_at DESC` — the current `idx_wm_from` covers the filter but not the sort |

None of these are currently causing problems at the expected data volume (single-agency use,
thousands of rows not millions). They are listed here as pre-emptive additions to apply if
query times become noticeable after months of production use.

---

## How to Apply a Missing Index

All migrations use the `migration_add_index` helper defined in `000_helpers.sql` which is
idempotent (skips if the index already exists):

```sql
-- Example: add the recommended payments composite index
CALL migration_add_index(
    'payments',
    'idx_payments_tenant_due',
    '`tenant_id`, `due_date`'
);
```

For a new migration file, copy the pattern from any `phaseN_*.sql` file and save it as
`database/migrations/phaseN_indexing.sql`.
