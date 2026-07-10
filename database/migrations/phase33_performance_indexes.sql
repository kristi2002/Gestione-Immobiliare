-- phase33_performance_indexes.sql
-- Composite/secondary indexes for the app's common filter+sort patterns.
-- Idempotent (migration_add_index only adds when absent).

USE gestione_immobiliare;

-- Rent schedule lookups per tenant, ordered by due date.
CALL migration_add_index('payments', 'idx_payments_tenant_due', 'tenant_id, due_date');

-- WhatsApp thread reads by counterpart number, newest first.
CALL migration_add_index('whatsapp_messages', 'idx_wa_from_received', 'from_number, received_at');

-- Property listing filters (status + city are the two most common facets).
CALL migration_add_index('properties', 'idx_properties_status_city', 'status, city');

-- Contract filtering by type (locazione / compravendita / ...).
CALL migration_add_index('contracts', 'idx_contracts_type', 'contract_type');

-- Expense reporting by category.
CALL migration_add_index('expenses', 'idx_expenses_category', 'category');
