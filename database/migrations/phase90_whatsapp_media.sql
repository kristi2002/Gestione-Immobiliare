-- phase90 — allegati WhatsApp in entrata
--
-- media_url esisteva gia' ma non veniva mai valorizzata: il webhook leggeva una
-- chiave che parseTwilioWebhook non ha mai restituito, quindi ogni foto o
-- documento inviato dai clienti spariva. Ora il file viene scaricato da Twilio e
-- salvato nell'albero protetto uploads/documents/whatsapp/, e media_url contiene
-- il percorso relativo. Servono il tipo e il nome originale per poterlo
-- rimandare al browser con l'intestazione giusta.

CALL migration_add_column('whatsapp_messages', 'media_mime', 'VARCHAR(120) NULL AFTER media_url');
CALL migration_add_column('whatsapp_messages', 'media_name', 'VARCHAR(255) NULL AFTER media_mime');
