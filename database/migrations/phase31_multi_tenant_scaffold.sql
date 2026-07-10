-- phase31_multi_tenant_scaffold.sql
-- Multi-agency scaffolding: the app stays single-agency in behaviour, but the
-- schema gains an `agencies` table and a nullable-safe `agency_id` on the main
-- aggregate-root tables (default 1 = the single active agency). Queries are NOT
-- rewritten yet — this makes a future multi-tenant rollout a much smaller lift.
-- See scopeToAgency() in config/agency.php.
--
-- Idempotent (guarded column/index/FK helpers).

USE gestione_immobiliare;

-- Reusable FK helper (add only if the constraint is absent).
DROP PROCEDURE IF EXISTS migration_add_fk;
DELIMITER //
CREATE PROCEDURE migration_add_fk(
    IN p_table VARCHAR(64),
    IN p_constraint VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_ref_table VARCHAR(64),
    IN p_ref_column VARCHAR(64),
    IN p_on_delete VARCHAR(20)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = DATABASE() AND table_name = p_table
          AND constraint_name = p_constraint AND constraint_type = 'FOREIGN KEY'
    ) THEN
        SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD CONSTRAINT `', p_constraint,
            '` FOREIGN KEY (`', p_column, '`) REFERENCES `', p_ref_table, '`(`', p_ref_column,
            '`) ON DELETE ', p_on_delete, ' ON UPDATE CASCADE');
        PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
    END IF;
END //
DELIMITER ;

-- The agencies table (tenant of the platform, in the SaaS sense).
CREATE TABLE IF NOT EXISTS agencies (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(150) NOT NULL,
    slug        VARCHAR(80)  NOT NULL,
    email       VARCHAR(255)     NULL,
    phone       VARCHAR(50)      NULL,
    address     VARCHAR(255)     NULL,
    city        VARCHAR(120)     NULL,
    vat_number  VARCHAR(32)      NULL,
    is_active   TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_agencies_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the single active agency (id = 1) from the configured agency name.
INSERT INTO agencies (id, name, slug, is_active)
SELECT 1,
       COALESCE((SELECT setting_value FROM app_settings WHERE setting_key = 'agency_name'), 'Agenzia'),
       'default',
       1
WHERE NOT EXISTS (SELECT 1 FROM agencies WHERE id = 1);

-- Add agency_id (NOT NULL DEFAULT 1) + index + FK to each aggregate-root table.
-- clients
CALL migration_add_column('clients', 'agency_id', 'INT UNSIGNED NOT NULL DEFAULT 1');
CALL migration_add_index('clients', 'idx_clients_agency', 'agency_id');
CALL migration_add_fk('clients', 'fk_clients_agency', 'agency_id', 'agencies', 'id', 'RESTRICT');
-- properties
CALL migration_add_column('properties', 'agency_id', 'INT UNSIGNED NOT NULL DEFAULT 1');
CALL migration_add_index('properties', 'idx_properties_agency', 'agency_id');
CALL migration_add_fk('properties', 'fk_properties_agency', 'agency_id', 'agencies', 'id', 'RESTRICT');
-- tenants
CALL migration_add_column('tenants', 'agency_id', 'INT UNSIGNED NOT NULL DEFAULT 1');
CALL migration_add_index('tenants', 'idx_tenants_agency', 'agency_id');
CALL migration_add_fk('tenants', 'fk_tenants_agency', 'agency_id', 'agencies', 'id', 'RESTRICT');
-- admin_users
CALL migration_add_column('admin_users', 'agency_id', 'INT UNSIGNED NOT NULL DEFAULT 1');
CALL migration_add_index('admin_users', 'idx_admin_users_agency', 'agency_id');
CALL migration_add_fk('admin_users', 'fk_admin_users_agency', 'agency_id', 'agencies', 'id', 'RESTRICT');
-- leads
CALL migration_add_column('leads', 'agency_id', 'INT UNSIGNED NOT NULL DEFAULT 1');
CALL migration_add_index('leads', 'idx_leads_agency', 'agency_id');
CALL migration_add_fk('leads', 'fk_leads_agency', 'agency_id', 'agencies', 'id', 'RESTRICT');
-- contracts
CALL migration_add_column('contracts', 'agency_id', 'INT UNSIGNED NOT NULL DEFAULT 1');
CALL migration_add_index('contracts', 'idx_contracts_agency', 'agency_id');
CALL migration_add_fk('contracts', 'fk_contracts_agency', 'agency_id', 'agencies', 'id', 'RESTRICT');
-- invoices
CALL migration_add_column('invoices', 'agency_id', 'INT UNSIGNED NOT NULL DEFAULT 1');
CALL migration_add_index('invoices', 'idx_invoices_agency', 'agency_id');
CALL migration_add_fk('invoices', 'fk_invoices_agency', 'agency_id', 'agencies', 'id', 'RESTRICT');
-- buildings
CALL migration_add_column('buildings', 'agency_id', 'INT UNSIGNED NOT NULL DEFAULT 1');
CALL migration_add_index('buildings', 'idx_buildings_agency', 'agency_id');
CALL migration_add_fk('buildings', 'fk_buildings_agency', 'agency_id', 'agencies', 'id', 'RESTRICT');
-- suppliers
CALL migration_add_column('suppliers', 'agency_id', 'INT UNSIGNED NOT NULL DEFAULT 1');
CALL migration_add_index('suppliers', 'idx_suppliers_agency', 'agency_id');
CALL migration_add_fk('suppliers', 'fk_suppliers_agency', 'agency_id', 'agencies', 'id', 'RESTRICT');
