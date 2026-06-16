-- Phase 16: Fix corrupted UTF-8 in seeded message templates (Windows migration piping).
-- Idempotent — safe to re-run.

USE gestione_immobiliare;

UPDATE whatsapp_templates SET
    body = 'Gentile {{nome}}, le diamo il benvenuto nell''immobile in {{indirizzo}}. Per qualsiasi necessità siamo a disposizione. Cordiali saluti, {{agenzia}}',
    variables = '["nome","indirizzo","agenzia"]'
WHERE name = 'Benvenuto inquilino';

UPDATE whatsapp_templates SET
    body = 'Gentile {{nome}}, le informiamo che il contratto dell''immobile in {{indirizzo}} scadrà il {{data_scadenza}}. La contatteremo per valutare il rinnovo. Cordiali saluti, {{agenzia}}',
    variables = '["nome","indirizzo","data_scadenza","agenzia"]'
WHERE name = 'Scadenza contratto';

UPDATE whatsapp_templates SET
    body = 'Gentile {{nome}}, le segnaliamo che il canone di € {{importo}} relativo a {{mese}} non risulta ancora pervenuto. La preghiamo di provvedere al più presto. Cordiali saluti, {{agenzia}}',
    variables = '["nome","importo","mese","agenzia"]'
WHERE name = 'Sollecito pagamento';

UPDATE whatsapp_templates SET
    body = 'Gentile {{nome}}, confermiamo la visita all''immobile in {{indirizzo}} il {{data}} alle ore {{ora}}. Cordiali saluti, {{agenzia}}',
    variables = '["nome","indirizzo","data","ora","agenzia"]'
WHERE name = 'Conferma visita';

UPDATE email_templates SET
    subject = 'Benvenuto in {{indirizzo}}',
    body = 'Gentile {{nome}},

Siamo lieti di darle il benvenuto come inquilina/o dell''immobile sito in {{indirizzo}}.

Il canone mensile concordato è di € {{canone}}.
Il contratto decorre dal {{data_inizio}} al {{data_fine}}.

Per qualsiasi necessità non esiti a contattarci.

Cordiali saluti,
{{agenzia}}'
WHERE name = 'Benvenuto inquilino';

UPDATE email_templates SET
    subject = 'Promemoria pagamento affitto — {{mese}}',
    body = 'Gentile {{nome}},

Le ricordiamo che il canone di locazione per il mese di {{mese}}, pari a € {{importo}}, è in scadenza il {{data_scadenza}}.

La preghiamo di provvedere al pagamento entro la data indicata.

Cordiali saluti,
{{agenzia}}'
WHERE name = 'Scadenza affitto';

UPDATE email_templates SET
    subject = 'Avviso scadenza contratto — {{indirizzo}}',
    body = 'Gentile {{nome}},

Le comunichiamo che il contratto di locazione relativo all''immobile in {{indirizzo}} è in scadenza il {{data_fine}}.

Per discutere il rinnovo o le modalità di rilascio, la invitiamo a contattarci entro il {{data_contatto}}.

Cordiali saluti,
{{agenzia}}'
WHERE name = 'Scadenza contratto';

UPDATE email_templates SET
    body = 'Gentile {{nome}},

{{messaggio}}

Cordiali saluti,
{{agenzia}}'
WHERE name = 'Promemoria generico';

UPDATE email_templates SET
    body = 'Gentile {{nome}},

Le chiediamo cortesemente di fornire il seguente documento: {{tipo_documento}}.

Entro il: {{data_scadenza}}

Per qualsiasi informazione non esiti a contattarci.

Cordiali saluti,
{{agenzia}}'
WHERE name = 'Richiesta documento';
