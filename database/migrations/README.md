# Database migrations

Migrations are applied by the **migration runner**, which tracks applied versions
in a `schema_migrations` table and is safe to run repeatedly.

```bash
php database/migrate.php            # apply all pending migrations
php database/migrate.php --status   # show applied / pending, change nothing
```

## Fresh install

1. Load the baseline schema (contains everything through **phase28**):
   ```bash
   mysql -u USER -p DB_NAME < database/schema_production.sql
   ```
2. Run the migration runner to apply phase29+ and record state:
   ```bash
   php database/migrate.php
   ```

The runner is **baseline-aware**: on a database that already has the core tables
but an empty `schema_migrations`, it records `000_helpers` + `phase3..phase28` as
"already applied" (they are baked into `schema_production.sql`) instead of
re-running the older, partly non-idempotent files — then applies phase29+.

In Docker, the entrypoint runs `php database/migrate.php` automatically after the
database is reachable, so a fresh container converges on its own.

## Writing new migrations

- Name them `phaseNN_description.sql` (NN strictly increasing).
- Make them **idempotent**. Use the helpers from `000_helpers.sql`:
  - `CALL migration_add_column('table', 'col', 'DEFINITION');`
  - `CALL migration_add_index('table', 'idx_name', 'col_a, col_b');`
  - `CALL migration_add_fk('table','fk_name','col','ref_table','ref_col','RESTRICT');` (defined in phase31)
- For anything else, guard with an `information_schema` check + dynamic SQL
  (`SET @sql := IF(<exists?>, 'SELECT 1', '<DDL>'); PREPARE ... EXECUTE ...`).
- `DELIMITER` blocks (stored procedures) are supported by the runner.

## Migration inventory

| Range | Content |
|-------|---------|
| `000_helpers` | Idempotent DDL helper procedures. |
| `phase3`–`phase28` | Baseline feature build (media, documents, communications, social, tenants, payments, contracts, leads, invoices, integrity fixes, Immobiliare fields, contract auto-status). All baked into `schema_production.sql`. |
| `phase29` | Unique `invoices.invoice_number`. |
| `phase30` | `property_insurance.property_id` FK (+ orphan cleanup). |
| `phase31` | Multi-agency scaffold: `agencies` table + `agency_id` on aggregate roots. |
| `phase32` | GDPR schema: consent, data-access log, export/erasure requests, retention config. |
| `phase33` | Performance composite indexes. |
| `phase34` | `api_rate_limits` formalised in schema. |

> The historical per-file `mysql < ...` list has been replaced by the runner. Do
> not hand-apply individual files on a database the runner manages.
