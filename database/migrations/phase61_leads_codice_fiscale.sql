-- phase61_leads_codice_fiscale.sql
-- Colma una lacuna di migrazione: `api/leads.php` legge/scrive/cerca
-- `leads.codice_fiscale` (serve per convertire un lead in proprietario/inquilino),
-- e il dump di produzione ha la colonna, MA nessuna migrazione in database/migrations/
-- la crea. Un DB ricostruito dalle sole migrazioni (cold-start, CLAUDE.md §5.1) non
-- avrebbe la colonna e createLead/updateLead/listLeads andrebbero in errore 500.
--
-- Qui la aggiungiamo in modo idempotente (no-op dove esiste già, es. in produzione).

USE gestione_immobiliare;

CALL migration_add_column('leads', 'codice_fiscale', 'VARCHAR(16) NULL AFTER surname');
CALL migration_add_index('leads', 'idx_leads_cf', 'codice_fiscale');
