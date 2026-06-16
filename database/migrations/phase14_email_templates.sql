-- Phase 14: Email templates
-- Idempotent — safe to re-run.

USE gestione_immobiliare;

CREATE TABLE IF NOT EXISTS email_templates (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    category    ENUM('benvenuto','scadenza_contratto','scadenza_affitto','promemoria','richiesta_documento','generico')
                NOT NULL DEFAULT 'generico',
    subject     VARCHAR(255) NOT NULL,
    body        TEXT NOT NULL,
    variables   VARCHAR(500) DEFAULT NULL COMMENT 'Comma-separated hints, e.g. {{nome}},{{indirizzo}}',
    is_active   TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_et_category (category),
    INDEX idx_et_active   (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default templates (skip if already present)
INSERT IGNORE INTO email_templates (id, name, category, subject, body, variables) VALUES
(1, 'Benvenuto inquilino', 'benvenuto',
 'Benvenuto in {{indirizzo}}',
 'Gentile {{nome}},\n\nSiamo lieti di darle il benvenuto come inquilino dell\'immobile sito in {{indirizzo}}.\n\nIl canone mensile concordato è di € {{canone}}.\nIl contratto decorre dal {{data_inizio}} al {{data_fine}}.\n\nPer qualsiasi necessità non esiti a contattarci.\n\nCordiali saluti,\n{{agenzia}}',
 '{{nome}},{{indirizzo}},{{canone}},{{data_inizio}},{{data_fine}},{{agenzia}}'),

(2, 'Scadenza affitto', 'scadenza_affitto',
 'Promemoria pagamento affitto — {{mese}}',
 'Gentile {{nome}},\n\nLe ricordiamo che il canone di locazione per il mese di {{mese}} pari a € {{importo}} è in scadenza il {{data_scadenza}}.\n\nLa preghiamo di provvedere al pagamento entro la data indicata.\n\nCordiali saluti,\n{{agenzia}}',
 '{{nome}},{{mese}},{{importo}},{{data_scadenza}},{{agenzia}}'),

(3, 'Scadenza contratto', 'scadenza_contratto',
 'Avviso scadenza contratto — {{indirizzo}}',
 'Gentile {{nome}},\n\nLe comunichiamo che il contratto di locazione relativo all\'immobile in {{indirizzo}} è in scadenza il {{data_fine}}.\n\nPer discutere il rinnovo o le modalità di rilascio, la invitiamo a contattarci entro il {{data_contatto}}.\n\nCordiali saluti,\n{{agenzia}}',
 '{{nome}},{{indirizzo}},{{data_fine}},{{data_contatto}},{{agenzia}}'),

(4, 'Promemoria generico', 'promemoria',
 '{{oggetto}}',
 'Gentile {{nome}},\n\n{{messaggio}}\n\nCordiali saluti,\n{{agenzia}}',
 '{{nome}},{{oggetto}},{{messaggio}},{{agenzia}}'),

(5, 'Richiesta documento', 'richiesta_documento',
 'Richiesta documento — {{tipo_documento}}',
 'Gentile {{nome}},\n\nLe chiediamo cortesemente di fornire il seguente documento: {{tipo_documento}}.\n\nEntro il: {{data_scadenza}}\n\nPer qualsiasi informazione non esiti a contattarci.\n\nCordiali saluti,\n{{agenzia}}',
 '{{nome}},{{tipo_documento}},{{data_scadenza}},{{agenzia}}');
