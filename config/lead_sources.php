<?php
/**
 * Vocabolario delle fonti di un lead.
 *
 * Perché un file suo: la lista viveva come `LEAD_SOURCES` dentro api/leads.php,
 * cioè accanto alla validazione e lontano da chiunque altro ne avesse bisogno.
 * Le automazioni a evento ora devono poter dire «solo per i lead arrivati dal
 * sito o dai portali», e una seconda copia della lista sarebbe divergiuta dalla
 * prima al primo portale aggiunto — con il form che offre una fonte che l'API
 * rifiuta, o un filtro che non scatta mai perché confronta una chiave morta.
 *
 * Le chiavi DEVONO restare allineate all'enum `leads.source` (phase68/phase52):
 * una chiave qui e non nell'enum viene rifiutata dal database, una nell'enum e
 * non qui viene rifiutata dall'API.
 */

/** chiave enum => etichetta mostrata all'utente. */
const LEAD_SOURCE_LABELS = [
    'telefono'    => 'Telefono',
    'email'       => 'Email',
    'web'         => 'Sito web',
    'passaparola' => 'Passaparola',
    'social'      => 'Social',
    'immobiliare' => 'Immobiliare.it',
    'idealista'   => 'Idealista',
    'casa'        => 'Casa.it',
    'subito'      => 'Subito.it',
    'whatsapp'    => 'WhatsApp',
    'altro'       => 'Altro',
];

/**
 * Fonti "in entrata": il contatto ha scritto lui, si aspetta una risposta e un
 * riscontro automatico gli suona sensato.
 *
 * Fuori restano di proposito:
 *   telefono    — ha chiamato: un «grazie per averci scritto» subito dopo la
 *                 telefonata e' goffo, e il lead lo digita l'agente.
 *   passaparola — segnalazione di terzi: la scheda nasce senza che l'interessato
 *                 abbia contattato l'agenzia.
 *   social      — copre sia il messaggio diretto sia l'annotazione dell'agente:
 *                 troppo ambiguo per accenderlo di default (resta selezionabile).
 *   altro       — per definizione ignoto.
 *
 * E' la preselezione del form, non un vincolo: la regola salva la lista scelta.
 */
const LEAD_SOURCES_INBOUND = ['web', 'immobiliare', 'idealista', 'casa', 'subito', 'whatsapp', 'email'];

/** Chiavi valide per `leads.source`. */
function leadSourceKeys(): array
{
    return array_keys(LEAD_SOURCE_LABELS);
}

function leadSourceIsValid(string $source): bool
{
    return array_key_exists($source, LEAD_SOURCE_LABELS);
}
