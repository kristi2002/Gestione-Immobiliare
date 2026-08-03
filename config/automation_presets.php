<?php
/**
 * Modelli di partenza per le automazioni.
 *
 * Il modulo "Nuova automazione" chiedeva quindici campi a chi non aveva ancora
 * deciso nulla, e per primo il testo dell'email: la parte che costa più tempo e
 * su cui si sbaglia di più (un token scritto a mano finisce letterale nella
 * posta del cliente). Qui stanno le cinque automazioni che un'agenzia crea
 * davvero, già scritte e già configurate: l'agente ne sceglie una, cambia le
 * frasi che vuole cambiare, salva.
 *
 * Sono VALORI INIZIALI, non un'entità: applicato il modello, l'automazione è
 * una riga `reminders` come tutte le altre e nessuno ricorda più da dove è
 * nata. Perciò il catalogo non ha id in DB e può essere riscritto senza
 * migrazioni né effetti su ciò che è già stato salvato.
 *
 * `is_marketing` è la scelta delicata e va fatta qui, non lasciata all'agente:
 * `service` salta il registro consensi, quindi lo portano solo i modelli che
 * rispondono a un rapporto già in essere o a una richiesta fatta dalla persona
 * stessa. Quelli che propongono un immobile a qualcuno che non l'ha chiesto
 * nascono `marketing` e restano soggetti al consenso.
 */

/**
 * `values` = precompilazione del modulo, chiavi identiche a quelle del form.
 * `needs`  = ciò che il modello non può sapere e l'agente deve ancora scegliere
 *            (mostrato come riga "Manca solo…" invece di lasciarlo scoprire al
 *            primo tentativo di salvataggio).
 */
const AUTOMATION_PRESETS = [
    'owner_monthly_report' => [
        'label'       => 'Report mensile al proprietario',
        'description' => 'Ogni mese, il primo del mese, un aggiornamento al proprietario di un immobile.',
        'icon'        => 'file-text',
        'needs'       => ['contact'],
        'values'      => [
            'trigger_type'  => 'scheduled',
            'title'         => 'Report mensile al proprietario',
            'frequency'     => 'monthly',
            'day_rule'      => 'dom:1',
            'schedule_time' => '09:00',
            'is_marketing'  => 0,
            'email_subject' => 'Aggiornamento di {{data.mese}} su {{immobile.indirizzo}}',
            'email_body'    => "Gentile {{contatto.nome_completo}},\n\n"
                             . "le inviamo il riepilogo di {{data.mese}} relativo all'immobile di {{immobile.indirizzo}}, {{immobile.citta}}.\n\n"
                             . "- Visite effettuate nel mese:\n"
                             . "- Richieste ricevute:\n"
                             . "- Prossimi passi:\n\n"
                             . "Restiamo a disposizione per qualsiasi chiarimento.\n\n"
                             . "Cordiali saluti,\n{{agenzia.nome}}\n{{agenzia.telefono}}",
        ],
    ],

    'lead_welcome' => [
        'label'       => 'Risposta a chi ci scrive',
        'description' => 'Appena un contatto arriva dal sito o da un portale, riceve conferma che la richiesta è stata presa in carico.',
        'icon'        => 'mail-check',
        'needs'       => [],
        'values'      => [
            'trigger_type'          => 'event',
            'trigger_event'         => 'lead.created',
            'recipient_rule'        => 'event_contact',
            'trigger_delay_minutes' => 0,
            'title'                 => 'Risposta a chi ci scrive',
            // Risponde a una richiesta fatta dalla persona stessa: non è una
            // proposta commerciale, e trattarla come tale la bloccherebbe
            // proprio verso chi ci ha appena scritto.
            'is_marketing'          => 0,
            'email_subject'         => 'Abbiamo ricevuto la sua richiesta',
            'email_body'            => "Gentile {{contatto.nome}},\n\n"
                                     . "grazie per averci contattato. Abbiamo ricevuto la sua richiesta e un nostro agente la richiamerà al più presto.\n\n"
                                     . "Per qualsiasi urgenza può scriverci a {{agenzia.email}} oppure chiamarci al {{agenzia.telefono}}.\n\n"
                                     . "Cordiali saluti,\n{{agenzia.nome}}",
        ],
    ],

    'viewing_feedback' => [
        'label'       => 'Riscontro dopo la visita',
        'description' => 'Due ore dopo un appuntamento concluso, si chiede al contatto che impressione ne ha avuto.',
        'icon'        => 'message-circle',
        'needs'       => [],
        'values'      => [
            'trigger_type'          => 'event',
            'trigger_event'         => 'appointment.completed',
            'recipient_rule'        => 'event_contact',
            'trigger_delay_minutes' => 120,
            'title'                 => 'Riscontro dopo la visita',
            // Riguarda un servizio già prestato a quella persona, su un
            // appuntamento che ha fissato lei.
            'is_marketing'          => 0,
            'email_subject'         => 'Com\'è andata la visita?',
            'email_body'            => "Gentile {{contatto.nome}},\n\n"
                                     . "grazie per aver visitato con noi l'immobile di {{immobile.indirizzo}}.\n\n"
                                     . "Ci farebbe piacere sapere che impressione ne ha avuto: le è sembrato in linea con quello che cerca? C'è qualcosa che vorrebbe rivedere o approfondire?\n\n"
                                     . "Le basta rispondere a questa email.\n\n"
                                     . "Cordiali saluti,\n{{agenzia.nome}}",
        ],
    ],

    'price_drop_alert' => [
        'label'       => 'Ribasso ai contatti interessati',
        'description' => 'Quando il prezzo di un immobile scende, lo si segnala ai lead la cui ricerca corrisponde (massimo 5).',
        'icon'        => 'trending-down',
        'needs'       => [],
        'values'      => [
            'trigger_type'          => 'event',
            'trigger_event'         => 'property.price_reduced',
            'recipient_rule'        => 'matching_leads',
            'trigger_delay_minutes' => 0,
            'title'                 => 'Ribasso ai contatti interessati',
            // Propone un immobile a chi non l'ha chiesto: consenso obbligatorio.
            'is_marketing'          => 1,
            'email_subject'         => 'Nuovo prezzo per {{immobile.indirizzo}}',
            'email_body'            => "Gentile {{contatto.nome}},\n\n"
                                     . "l'immobile di {{immobile.indirizzo}} a {{immobile.citta}}, che rientra nei criteri della sua ricerca, è passato da {{evento.prezzo_precedente}} a {{evento.prezzo_attuale}}.\n\n"
                                     . "Se desidera visitarlo ci contatti pure: organizziamo volentieri un appuntamento.\n\n"
                                     . "Cordiali saluti,\n{{agenzia.nome}}\n{{agenzia.telefono}}",
        ],
    ],

    'owner_status_change' => [
        'label'       => 'Avviso al proprietario sul cambio di stato',
        'description' => 'Quando un immobile passa a venduto, affittato o torna disponibile, il proprietario ne riceve conferma.',
        'icon'        => 'home',
        'needs'       => [],
        'values'      => [
            'trigger_type'          => 'event',
            'trigger_event'         => 'property.status_changed',
            'recipient_rule'        => 'property_owner',
            'trigger_delay_minutes' => 0,
            'title'                 => 'Avviso al proprietario sul cambio di stato',
            'is_marketing'          => 0,
            'email_subject'         => 'Aggiornamento su {{immobile.indirizzo}}',
            'email_body'            => "Gentile {{contatto.nome_completo}},\n\n"
                                     . "le confermiamo che in data {{evento.data}} abbiamo aggiornato la situazione dell'immobile di {{immobile.indirizzo}}, {{immobile.citta}}.\n\n"
                                     . "Le pubblicazioni attive sui portali vengono ritirate automaticamente quando l'immobile non è più disponibile.\n\n"
                                     . "Cordiali saluti,\n{{agenzia.nome}}",
        ],
    ],
];

/** Valori di esempio per l'invio di prova e per l'anteprima nel modulo. */
const AUTOMATION_SAMPLE_CONTEXT = [
    'contatto.nome'          => 'Mario',
    'contatto.cognome'       => 'Rossi',
    'contatto.nome_completo' => 'Mario Rossi',
    'contatto.email'         => 'mario.rossi@esempio.it',
    'immobile.indirizzo'     => 'Via Roma 1',
    'immobile.citta'         => 'Civitanova Marche',
    'immobile.riferimento'   => 'RIF-001',
    'immobile.prezzo'        => '€ 250.000',
    'evento.prezzo_precedente' => '€ 280.000',
    'evento.prezzo_attuale'    => '€ 250.000',
];
