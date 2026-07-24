-- phase60_tenant_anagrafica.sql
-- Anagrafica completa del conduttore (inquilino), speculare a phase59 (proprietari).
--
-- Per la registrazione telematica del contratto di locazione (RLI) il conduttore
-- ha bisogno degli stessi dati del locatore: luogo/data di nascita e residenza per
-- la persona fisica; ragione sociale + partita IVA per la persona giuridica
-- (locazioni commerciali). Finora `tenants` aveva solo nome/cognome/CF/email/telefono
-- (+ SEPA), quindi il conduttore non era registrabile senza reinserire i dati a mano.
--
-- Tutte le colonne sono NULLABLE tranne person_type (NOT NULL DEFAULT 'fisica':
-- gli inquilini esistenti sono persone fisiche). L'obbligatorietà condizionale
-- (ragione sociale per le giuridiche) è applicata a livello applicativo
-- (api/tenants.php + form). CF esiste già (phase55) — non si tocca.
--
-- Idempotente: usa migration_add_column (000_helpers.sql).

USE gestione_immobiliare;

-- ── Natura del soggetto ──────────────────────────────────────────────────────
CALL migration_add_column('tenants', 'person_type',  "VARCHAR(20) NOT NULL DEFAULT 'fisica' AFTER surname");
CALL migration_add_column('tenants', 'company_name', 'VARCHAR(200) NULL AFTER person_type');
CALL migration_add_column('tenants', 'vat_number',   'VARCHAR(20) NULL AFTER company_name');

-- ── Dati anagrafici (persona fisica) ─────────────────────────────────────────
CALL migration_add_column('tenants', 'birth_place',  'VARCHAR(120) NULL AFTER codice_fiscale');
CALL migration_add_column('tenants', 'birth_date',   'DATE NULL AFTER birth_place');

-- ── Recapiti / Residenza (sede legale per le giuridiche) ─────────────────────
CALL migration_add_column('tenants', 'pec_email',    'VARCHAR(255) NULL AFTER email');
CALL migration_add_column('tenants', 'address',      'VARCHAR(255) NULL AFTER pec_email');
CALL migration_add_column('tenants', 'city',         'VARCHAR(100) NULL AFTER address');
CALL migration_add_column('tenants', 'cap',          'VARCHAR(10) NULL AFTER city');
CALL migration_add_column('tenants', 'province',     'VARCHAR(10) NULL AFTER cap');
