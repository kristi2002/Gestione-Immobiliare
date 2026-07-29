-- phase82_media_thumbnails.sql
-- Una miniatura per ogni immagine della galleria.
--
-- Fino a qui `property_media` conosceva un solo percorso, `file_path`, e ogni
-- superficie che mostra un'anteprima serviva quel file: la griglia immobili, i
-- popup della mappa, i riquadri nella scheda proprietario, gli immobili recenti
-- in dashboard, il sito pubblico. Sono tutti riquadri da 300-400px che
-- scaricavano l'originale da 4000px e diversi MB — la pagina elenco con 24 card
-- valeva da sola oltre 100 MB di traffico, su una connessione di agenzia.
--
-- `thumb_path` NON e' una denormalizzazione di `file_path`: e' un secondo file,
-- generato al momento dell'upload da lib/image_processing.php, che puo'
-- legittimamente non esistere. Resta NULL per:
--   - i video e i PDF (non hanno un fotogramma da ritagliare qui);
--   - le GIF, escluse apposta dal ricampionamento (GD ne salverebbe solo il
--     primo fotogramma);
--   - gli allegati riservati, che vivono nell'albero protetto e passano da
--     api/media.php, non da un URL pubblico;
--   - tutte le righe caricate prima di questa migrazione;
--   - qualunque immagine su cui GD non sia riuscita a lavorare.
--
-- Per questo ogni lettura la usa come COALESCE(thumb_path, file_path) e mai da
-- sola: l'assenza di miniatura deve degradare all'originale, non a un'immagine
-- rotta. Il backfill delle righe esistenti e' volontario e sta in
-- scripts/backfill_media_thumbnails.php, non qui: rigenerare le miniature di
-- un intero archivio e' lavoro da CLI con output, non da deploy silenzioso che
-- puo' andare in timeout mentre il container si avvia.

CALL migration_add_column(
    'property_media',
    'thumb_path',
    'VARCHAR(255) NULL COMMENT ''Miniatura generata (lato lungo 640px); NULL = usare file_path'' AFTER `file_path`'
);
