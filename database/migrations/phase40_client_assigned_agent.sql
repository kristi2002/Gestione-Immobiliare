-- phase40_client_assigned_agent.sql
-- Adds a "reference agent" (Agente Ref.) to each proprietario (owner).
-- Nullable FK clients.assigned_agent_id -> admin_users.id with ON DELETE SET NULL
-- so removing an admin/agent never cascades into deleting owners — the owner
-- simply becomes "Non assegnato". Idempotent (safe to re-run).

USE gestione_immobiliare;

-- 1) Column
SET @has_col := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'clients'
      AND column_name = 'assigned_agent_id'
);
SET @sql := IF(@has_col = 0,
    'ALTER TABLE clients ADD COLUMN assigned_agent_id INT UNSIGNED NULL DEFAULT NULL AFTER status',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2) Index
SET @has_idx := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'clients'
      AND index_name = 'idx_clients_assigned_agent'
);
SET @sql := IF(@has_idx = 0,
    'ALTER TABLE clients ADD INDEX idx_clients_assigned_agent (assigned_agent_id)',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3) Foreign key
SET @has_fk := (
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'clients'
      AND constraint_name = 'fk_clients_assigned_agent' AND constraint_type = 'FOREIGN KEY'
);
SET @sql := IF(@has_fk = 0,
    'ALTER TABLE clients
        ADD CONSTRAINT fk_clients_assigned_agent FOREIGN KEY (assigned_agent_id)
        REFERENCES admin_users(id) ON DELETE SET NULL ON UPDATE CASCADE',
    'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
