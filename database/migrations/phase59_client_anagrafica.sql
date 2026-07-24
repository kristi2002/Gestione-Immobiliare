-- phase59_client_anagrafica.sql
-- Anagrafica proprietario completa per mandati e contratti.
--
-- Finora `clients` conteneva solo nome/cognome/CF/telefono/email: sufficiente per
-- un contatto, ma NON per un mandato di agenzia o un preliminare, che richiedono
-- luogo/data di nascita, residenza e — per le persone giuridiche — ragione sociale
-- e partita IVA. Il generatore PDF (config/pdf.php) fino ad ora "tappava" il blocco
-- Mandante con il solo Nominativo. Qui aggiungiamo i campi mancanti così che la
-- scheda proprietario stia allo stesso standard della scheda immobile (phase58).
--
-- Tutte le colonne sono NULLABLE (tranne person_type, NOT NULL DEFAULT 'fisica':
-- gli owner esistenti sono persone fisiche): i record esistenti restano validi e
-- l'obbligatorietà condizionale (ragione sociale per le giuridiche) è applicata a
-- livello applicativo (api/clients.php + form).
--
-- Idempotente: usa migration_add_column (000_helpers.sql).

USE gestione_immobiliare;

-- ── Natura del soggetto ──────────────────────────────────────────────────────
CALL migration_add_column('clients', 'person_type',   "VARCHAR(20) NOT NULL DEFAULT 'fisica' AFTER surname");
CALL migration_add_column('clients', 'company_name',  'VARCHAR(200) NULL AFTER person_type');
CALL migration_add_column('clients', 'vat_number',    'VARCHAR(20) NULL AFTER company_name');

-- ── Dati anagrafici (persona fisica) ─────────────────────────────────────────
CALL migration_add_column('clients', 'birth_place',   'VARCHAR(120) NULL AFTER codice_fiscale');
CALL migration_add_column('clients', 'birth_date',    'DATE NULL AFTER birth_place');

-- ── Recapiti / Residenza (sede legale per le giuridiche) ─────────────────────
CALL migration_add_column('clients', 'pec_email',     'VARCHAR(255) NULL AFTER email');
CALL migration_add_column('clients', 'address',       'VARCHAR(255) NULL AFTER pec_email');
CALL migration_add_column('clients', 'city',          'VARCHAR(100) NULL AFTER address');
CALL migration_add_column('clients', 'cap',           'VARCHAR(10) NULL AFTER city');
CALL migration_add_column('clients', 'province',      'VARCHAR(10) NULL AFTER cap');
