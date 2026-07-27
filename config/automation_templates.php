<?php
/**
 * Token dinamici per le automazioni.
 *
 * Prima di questo file il corpo dell'email veniva spedito alla lettera, e il
 * form lo diceva onestamente: «puoi usare il nome del proprietario inserendolo
 * manualmente nel testo». Il che rendeva ogni automazione monouso — un modello
 * mensile con "Gentile Roberto" dentro vale per Roberto e basta.
 *
 * I dati costano zero: processDueReminders() fa già JOIN su clients, leads,
 * tenants, properties e admin_users per decidere il destinatario. Qui quei
 * campi diventano segnaposto sostituiti al momento dell'INVIO, non al
 * salvataggio — così un'occorrenza materializzata mesi prima riporta comunque
 * i dati aggiornati (indirizzo corretto, prezzo attuale).
 *
 * Il corpo viaggia come testo semplice e viene passato per htmlspecialchars()
 * da wrapHtmlEmail(): i valori sostituiti non possono iniettare HTML.
 */

require_once __DIR__ . '/settings.php';

/**
 * Catalogo dei token. Sorgente unica: la UI lo legge via
 * `api/reminders.php?action=tokens` invece di mantenere una lista parallela
 * che si disallineerebbe alla prima aggiunta.
 */
const AUTOMATION_TOKEN_GROUPS = [
    'Contatto' => [
        'contatto.nome'         => 'Nome del destinatario',
        'contatto.cognome'      => 'Cognome del destinatario',
        'contatto.nome_completo'=> 'Nome e cognome',
        'contatto.email'        => 'Email del destinatario',
    ],
    'Immobile' => [
        'immobile.indirizzo'    => 'Indirizzo dell\'immobile',
        'immobile.citta'        => 'Città dell\'immobile',
        'immobile.riferimento'  => 'Codice di riferimento',
        'immobile.prezzo'       => 'Prezzo formattato (es. € 250.000)',
    ],
    'Agenzia' => [
        'agenzia.nome'          => 'Nome dell\'agenzia',
        'agenzia.email'         => 'Email dell\'agenzia',
        'agenzia.telefono'      => 'Telefono dell\'agenzia',
        'agente.nome'           => 'Agente assegnato',
    ],
    'Data' => [
        'data.oggi'             => 'Data di invio (gg/mm/aaaa)',
        'data.mese'             => 'Mese di invio (es. luglio 2026)',
        'data.anno'             => 'Anno di invio',
    ],
    'Evento' => [
        'evento.prezzo_precedente' => 'Prezzo prima del ribasso',
        'evento.prezzo_attuale'    => 'Prezzo dopo il ribasso',
        'evento.data'              => 'Data dell\'evento',
    ],
];

/** I token d'evento non esistono in un'automazione a calendario. */
const AUTOMATION_EVENT_TOKEN_GROUP = 'Evento';

const AUTOMATION_MONTHS_IT = [
    1 => 'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
    'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
];

/** Elenco piatto dei token conosciuti. */
function automationKnownTokens(): array
{
    $out = [];
    foreach (AUTOMATION_TOKEN_GROUPS as $tokens) {
        foreach ($tokens as $token => $_) {
            $out[] = $token;
        }
    }
    return $out;
}

/**
 * Costruisce i valori dei token dalla riga promemoria già arricchita dai JOIN
 * di processDueReminders() (o da getReminder()).
 *
 * @param array $r    riga reminders + colonne client_/lead_/tenant_/property_
 * @param array $extra valori aggiuntivi (token evento), già formattati
 */
function buildAutomationContext(array $r, array $extra = []): array
{
    // Stesso ordine di precedenza di reminderRecipient(): il destinatario e il
    // nome nel testo devono essere la stessa persona, sempre.
    [$nome, $cognome, $email] = automationContactParts($r);

    $agencyName  = getSetting('agency_name', 'Gestionale Immobiliare') ?: 'Gestionale Immobiliare';
    $now         = new DateTime();
    $price       = $r['property_price'] ?? null;

    $ctx = [
        'contatto.nome'          => $nome !== '' ? $nome : 'Cliente',
        'contatto.cognome'       => $cognome,
        'contatto.nome_completo' => trim($nome . ' ' . $cognome) ?: 'Cliente',
        'contatto.email'         => $email,

        'immobile.indirizzo'     => (string) ($r['property_address'] ?? ''),
        'immobile.citta'         => (string) ($r['property_city'] ?? ''),
        'immobile.riferimento'   => (string) ($r['property_reference'] ?? ''),
        'immobile.prezzo'        => automationFormatPrice($price),

        'agenzia.nome'           => $agencyName,
        'agenzia.email'          => (string) (getSetting('agency_email', '') ?? ''),
        'agenzia.telefono'       => (string) (getSetting('agency_phone', '') ?? ''),
        'agente.nome'            => (string) ($r['agent_username'] ?? ''),

        'data.oggi'              => $now->format('d/m/Y'),
        'data.mese'              => AUTOMATION_MONTHS_IT[(int) $now->format('n')] . ' ' . $now->format('Y'),
        'data.anno'              => $now->format('Y'),
    ];

    return array_merge($ctx, $extra);
}

/**
 * Nome / cognome / email del destinatario, con la stessa precedenza
 * client → lead → tenant usata da reminderRecipient().
 *
 * @return array{0:string,1:string,2:string}
 */
function automationContactParts(array $r): array
{
    $candidates = [
        [$r['client_email'] ?? '', $r['client_name'] ?? '', $r['client_surname'] ?? ''],
        [$r['lead_email'] ?? '',   $r['lead_name'] ?? '',   $r['lead_surname'] ?? ''],
        // processDueReminders() chiama il nome dell'inquilino tenant_first_name
        // per non collidere con reminders.tenant_name (testo libero).
        [$r['tenant_email'] ?? '', $r['tenant_first_name'] ?? ($r['tenant_contact_name'] ?? ''), $r['tenant_surname'] ?? ($r['tenant_contact_surname'] ?? '')],
    ];

    foreach ($candidates as [$email, $name, $surname]) {
        if (!empty($email) || !empty($name) || !empty($surname)) {
            return [trim((string) $name), trim((string) $surname), trim((string) $email)];
        }
    }

    return ['', '', ''];
}

function automationFormatPrice($price): string
{
    if ($price === null || $price === '') {
        return '';
    }
    return '€ ' . number_format((float) $price, 0, ',', '.');
}

/**
 * Sostituisce i token in un modello.
 *
 * @param bool $partial true = lascia intatti i token sconosciuti. Serve alla
 *        materializzazione da evento, che risolve subito i soli
 *        `{{evento.*}}` (il prezzo di ieri non è recuperabile domani) e lascia
 *        `{{contatto.*}}` da risolvere all'invio.
 *        false = un token sconosciuto diventa stringa vuota: meglio una frase
 *        monca che spedire `{{contatto.nome}}` a un cliente vero.
 */
function renderAutomationTemplate(?string $template, array $ctx, bool $partial = false): string
{
    if ($template === null || $template === '') {
        return '';
    }

    return preg_replace_callback(
        '/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/i',
        function (array $m) use ($ctx, $partial) {
            $key = strtolower($m[1]);
            if (array_key_exists($key, $ctx)) {
                return (string) $ctx[$key];
            }
            return $partial ? $m[0] : '';
        },
        $template
    ) ?? $template;
}

/** Il modello contiene almeno un token? (usato per non loggare rumore) */
function automationTemplateHasTokens(?string $template): bool
{
    return $template !== null && (bool) preg_match('/\{\{\s*[a-z_]+\.[a-z_]+\s*\}\}/i', $template);
}
