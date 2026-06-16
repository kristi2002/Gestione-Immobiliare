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
```

**Fresh production database:** use `database/schema_production.sql` instead (no migrations needed).

**Notes:**
- `000_helpers.sql` creates stored procedures — safe to re-run.
- Migrations from phase 6 onward are **idempotent** (no duplicate-column errors on re-run).
- Phase 5/7 seed inserts run only when related clients/properties exist.
