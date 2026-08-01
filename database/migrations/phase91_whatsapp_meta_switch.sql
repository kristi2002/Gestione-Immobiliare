-- phase91 — da Twilio a Meta Cloud API
--
-- La colonna teneva il SID di Twilio e ora tiene il wamid di Meta: lasciarle il
-- vecchio nome significava che fra sei mesi qualcuno l'avrebbe letta come un
-- residuo Twilio da ripulire. Stesso dato, nome onesto.

ALTER TABLE whatsapp_messages CHANGE COLUMN twilio_sid external_id VARCHAR(64) NULL;

-- Le credenziali Twilio non servono piu' a nessuno. Restassero in tabella,
-- comparirebbero nei backup e nelle esportazioni come segreti ancora validi.
DELETE FROM app_settings WHERE setting_key IN ('twilio_account_sid', 'twilio_auth_token', 'twilio_whatsapp_from');
