-- phase95 — i template locali diventano template Meta
--
-- whatsapp_templates conteneva testo pronto per l'agente, con segnaposto
-- {{nome}} sostituiti da noi prima dell'invio: utile dentro la finestra di 24
-- ore, inutile fuori. Fuori dalla finestra la Cloud API accetta solo un template
-- gia' approvato, identificato dal nome registrato nel Business Manager e con
-- segnaposto posizionali {{1}}, {{2}}.
--
-- Queste tre colonne sono il ponte fra le due cose: la riga locale resta il
-- testo leggibile che finisce in archivio, e porta con se' il nome Meta da usare
-- come transporto. L'ordine dei parametri posizionali e' quello della colonna
-- `variables`, che l'API deriva dal corpo nell'ordine di prima comparsa.
--
-- meta_status non e' decorativo: un template non approvato viene rifiutato da
-- Meta al momento dell'invio, e senza questo campo l'agente lo scoprirebbe solo
-- da un errore in fondo ai log.

CALL migration_add_column('whatsapp_templates', 'meta_template_name', 'VARCHAR(200) NULL AFTER name');
CALL migration_add_column('whatsapp_templates', 'meta_language', "VARCHAR(10) NOT NULL DEFAULT 'it' AFTER meta_template_name");
CALL migration_add_column('whatsapp_templates', 'meta_status', "ENUM('bozza','in_revisione','approvato','rifiutato') NOT NULL DEFAULT 'bozza' AFTER meta_language");
CALL migration_add_index('whatsapp_templates', 'idx_wa_tpl_meta_name', '`meta_template_name`');
