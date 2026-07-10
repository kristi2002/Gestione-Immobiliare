-- phase34_api_rate_limits.sql
-- Formalise the api_rate_limits table in the schema. It was previously created
-- lazily at runtime by config/rate_limit.php (which still works as a fallback);
-- having it in the migration set makes it a first-class, documented table.
--
-- Idempotent.

USE gestione_immobiliare;

CREATE TABLE IF NOT EXISTS api_rate_limits (
    id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    endpoint     VARCHAR(100)    NOT NULL,
    ip_address   VARCHAR(45)     NOT NULL,
    user_id      INT UNSIGNED        NULL,
    requested_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rl_lookup (endpoint, ip_address, user_id, requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
