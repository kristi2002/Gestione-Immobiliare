-- phase63_key_details.sql
-- Gestione chiavi: il form catturava solo detentore/stato/ubicazione, ma un
-- immobile ha più chiavi distinte (portone, appartamento, cantina, box, cancello)
-- e senza un campo che le distingua non è possibile registrarle come righe
-- separate in modo leggibile (property_keys non ha vincolo UNIQUE su
-- property_id, quindi più righe per immobile erano già possibili — mancava
-- solo il modo di etichettarle).
--
-- Aggiunge: tipo chiave, quantità copie, codice fisico del portachiavi.
-- Tutte le colonne sono NULLABLE/con default, quindi retro-compatibili con le
-- righe esistenti (che restano valide senza etichetta = "chiave generica").
--
-- Idempotente: usa migration_add_column (000_helpers.sql).

USE gestione_immobiliare;

CALL migration_add_column('property_keys', 'key_type', "VARCHAR(50) NOT NULL DEFAULT 'altro' AFTER property_id");
CALL migration_add_column('property_keys', 'quantity', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER key_type');
CALL migration_add_column('property_keys', 'key_code', 'VARCHAR(50) NULL AFTER quantity');
