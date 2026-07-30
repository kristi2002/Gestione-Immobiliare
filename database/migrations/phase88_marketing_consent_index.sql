-- phase88_marketing_consent_index.sql
--
-- Indice per la domanda "questa persona ha dato il consenso, adesso?"
--
-- consent_records esisteva dal phase32 con due indici SEPARATI, uno su
-- (subject_type, subject_id) e uno su (purpose). La lettura del consenso filtra
-- su tutti e tre insieme e ordina per data, quindi MySQL puo' usarne uno solo e
-- deve poi scorrere e riordinare le righe rimaste. Finche' il registro era
-- scritto e mai letto non se ne accorgeva nessuno. Da ora e' la query che gira
-- prima di OGNI invio commerciale, una volta per destinatario.
--
-- Le colonne dell'ORDER BY (created_at, id) stanno in coda all'indice cosi' la
-- riga piu' recente si trova senza ordinare niente.
--
-- Nessun USE: il database di produzione non si chiama gestione_immobiliare ma
-- default, e un USE fisso faceva fallire la migrazione la' dove conta.
-- Idempotente tramite migration_add_index (000_helpers).

CALL migration_add_index(
    'consent_records',
    'idx_consent_lookup',
    'subject_type, subject_id, purpose, created_at, id'
);
