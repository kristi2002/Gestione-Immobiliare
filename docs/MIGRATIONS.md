# Database migrations

Run in order on an **existing** database (after `schema.sql` or an older snapshot).

```bash
mysql -u USER -p < database/migrations/000_helpers.sql
mysql -u USER -p < database/migrations/phase3_property_media.sql
mysql -u USER -p < database/migrations/phase4_documents.sql
mysql -u USER -p < database/migrations/phase5_communications.sql
mysql -u USER -p < database/migrations/phase6_reminder_notifications.sql
mysql -u USER -p < database/migrations/phase7_social.sql
mysql -u USER -p < database/migrations/phase8_production.sql
mysql -u USER -p < database/migrations/phase9_features.sql
mysql -u USER -p < database/migrations/phase11_features.sql
mysql -u USER -p < database/migrations/phase12_features.sql
mysql -u USER -p < database/migrations/phase15_new_features.sql
```

**Fresh production database:** use `database/schema_production.sql` instead (no migrations needed).

**Notes:**
- `000_helpers.sql` creates stored procedures — safe to re-run.
- Migrations from phase 6 onward are **idempotent** (no duplicate-column errors on re-run).
- Phase 5/7 seed inserts run only when related clients/properties exist.

## Fiscal & compliance layer (phase 35–37, July 2026)

Applied by `php database/migrate.php` (on top of the phase-28 baseline in `schema_production.sql`):

| File | Adds |
|---|---|
| `phase35_fiscal_property.sql` | `properties`: dati catastali (`cadastral_*`) + APE (`ape_number`, `ape_issue_date`, `ape_expiry_date`, `ipe_value`); `tenants`: SEPA (`iban`, `sdd_mandate_ref`, `sdd_mandate_date`); `payments`: `method`; new table **`portal_listings`**. |
| `phase36_contract_registration.sql` | `contracts`: `contract_subtype`, RLI registration fields, `cedolare_secca`, `registration_tax_annual`, `stamp_duty`, `imposta_registro_due_date`, ISTAT baseline fields. |
| `phase37_antiriciclaggio.sql` | new table **`aml_records`** (adeguata verifica D.lgs 231/2007). |
| `phase38_valuation.sql` | new table **`omi_quotazioni`** (per-zone €/m² market values for the valuation engine). |
| `phase39_fattura_transmissions.sql` | new table **`fattura_transmissions`** (FatturaPA/SdI lifecycle: status, persisted XML, receipts). |

The `ADD COLUMN` statements are **run-once** (MySQL 8 has no `ADD COLUMN IF NOT EXISTS`); the runner
records each applied version in `schema_migrations` so they are never re-executed. The `CREATE TABLE`
statements use `IF NOT EXISTS` and are idempotent.
