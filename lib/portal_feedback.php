<?php
/**
 * Feed di ritorno: cosa il portale ha accettato e cosa ha scartato.
 *
 * Chiude il giro aperto da lib/portal_feed.php. Il portale scarica il feed,
 * lo processa e mette a disposizione un file di esito riga per riga: annuncio
 * accettato (con l'ID e l'URL assegnati) oppure rifiutato (con il motivo,
 * tipo "Classe energetica mancante"). Senza questo passo il gestionale non
 * sa mai se quello che ha spedito e' davvero online.
 *
 * ⚠️ ONESTA' SUL FORMATO: ogni portale ha il suo tracciato di ritorno e quelli
 * veri arrivano col contratto. Qui il parsing e' deliberatamente DIFENSIVO —
 * stessa scelta di lib/portal_leads.php per le email dei portali, che per gli
 * stessi motivi cambiano forma senza preavviso:
 *
 *   - accetta XML o CSV, riconosciuti dal contenuto e non dall'estensione;
 *   - cerca i campi per ALIAS (reference/riferimento/ref/codice...), cosi' un
 *     tracciato leggermente diverso non fa fallire tutto;
 *   - FAIL-CLOSED sullo stato: se il token di esito non e' riconosciuto la
 *     riga diventa 'error' con il valore grezzo nel messaggio, MAI 'published'.
 *     Dichiarare online un annuncio che non lo e' e' il danno peggiore: si
 *     smette di guardarlo proprio mentre e' rotto.
 */

require_once __DIR__ . '/../config/portal_specs.php';
require_once __DIR__ . '/portal_feed.php';

/** Token di esito che valgono "accettato". Tutto il resto e' errore. */
const PORTAL_FEEDBACK_OK_TOKENS = [
    'ok', 'success', 'successo', 'published', 'pubblicato', 'accepted', 'accettato',
    'active', 'attivo', 'online', 'true', '1',
];

/** Alias di campo, in ordine di preferenza. */
const PORTAL_FEEDBACK_ALIASES = [
    'reference'    => ['reference', 'riferimento', 'ref', 'codice', 'codice_riferimento', 'externalreference', 'customerreference'],
    'status'       => ['status', 'stato', 'esito', 'result', 'risultato', 'outcome'],
    'external_id'  => ['adid', 'annuncioid', 'idannuncio', 'portalid', 'listingid', 'id_annuncio', 'id'],
    'external_url' => ['url', 'link', 'urlannuncio', 'permalink', 'weburl'],
    'message'      => ['message', 'messaggio', 'errore', 'error', 'errormessage', 'descrizione', 'description', 'note'],
];

function portalFeedbackNormaliseKey(string $k): string
{
    return strtolower(preg_replace('/[^a-z0-9]/i', '', $k) ?? '');
}

/** Primo alias presente in una mappa gia' normalizzata. */
function portalFeedbackPick(array $row, string $field): ?string
{
    foreach (PORTAL_FEEDBACK_ALIASES[$field] as $alias) {
        if (isset($row[$alias]) && trim((string) $row[$alias]) !== '') {
            return trim((string) $row[$alias]);
        }
    }
    return null;
}

/**
 * Esito -> booleano. Fail-closed: sconosciuto = NON pubblicato.
 * `null` (stato assente) e' anch'esso un fallimento: il portale non ha
 * confermato, quindi non confermiamo noi al posto suo.
 */
function portalFeedbackIsOk(?string $status): bool
{
    if ($status === null) {
        return false;
    }
    return in_array(strtolower(trim($status)), PORTAL_FEEDBACK_OK_TOKENS, true);
}

/**
 * Normalizza un record grezzo (chiavi gia' minuscole/senza separatori).
 * Ritorna null se non c'e' un riferimento: senza chiave di correlazione la
 * riga e' inutilizzabile, e va segnalata invece che applicata a caso.
 */
function portalFeedbackNormaliseRow(array $row): ?array
{
    $reference = portalFeedbackPick($row, 'reference');
    if ($reference === null) {
        return null;
    }

    $status = portalFeedbackPick($row, 'status');
    $ok     = portalFeedbackIsOk($status);
    $msg    = portalFeedbackPick($row, 'message');

    // Se lo stato non e' riconosciuto ma non c'e' un messaggio, il valore
    // grezzo E' l'informazione utile per capire il tracciato.
    if (!$ok && $msg === null && $status !== null) {
        $msg = 'Esito non riconosciuto dal parser: "' . $status . '"';
    }
    if (!$ok && $msg === null) {
        $msg = 'Il portale non ha confermato la pubblicazione (nessun esito nel feed di ritorno).';
    }

    return [
        'reference'    => $reference,
        'ok'           => $ok,
        'external_id'  => portalFeedbackPick($row, 'external_id'),
        'external_url' => portalFeedbackPick($row, 'external_url'),
        'message'      => $ok ? null : $msg,
        'raw_status'   => $status,
    ];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * XML: si cercano i nodi ripetuti che contengono un riferimento, senza
 * pretendere di sapere come si chiama l'elemento contenitore (Annuncio,
 * property, result, item... cambia da portale a portale).
 */
function portalFeedbackParseXml(string $payload): array
{
    $prev = libxml_use_internal_errors(true);
    $xml  = simplexml_load_string($payload);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);

    if ($xml === false) {
        throw new RuntimeException('XML non valido.');
    }

    $rows = [];
    foreach ($xml->children() as $child) {
        $row = [];
        foreach ($child->children() as $field) {
            $row[portalFeedbackNormaliseKey($field->getName())] = (string) $field;
        }
        // Alcuni tracciati mettono i valori come attributi invece che come tag.
        foreach ($child->attributes() ?? [] as $name => $value) {
            $key = portalFeedbackNormaliseKey((string) $name);
            if (!isset($row[$key])) {
                $row[$key] = (string) $value;
            }
        }
        if ($row) {
            $rows[] = $row;
        }
    }
    return $rows;
}

/** CSV con intestazione: separatore dedotto fra ';' (comune in Italia) e ','. */
function portalFeedbackParseCsv(string $payload): array
{
    $lines = preg_split('/\r\n|\r|\n/', trim($payload)) ?: [];
    if (count($lines) < 2) {
        return [];
    }

    $sep = substr_count($lines[0], ';') > substr_count($lines[0], ',') ? ';' : ',';
    $head = array_map('portalFeedbackNormaliseKey', str_getcsv($lines[0], $sep, '"', '\\'));

    $rows = [];
    foreach (array_slice($lines, 1) as $line) {
        if (trim($line) === '') {
            continue;
        }
        $cells = str_getcsv($line, $sep, '"', '\\');
        $row   = [];
        foreach ($head as $i => $key) {
            if ($key !== '') {
                $row[$key] = $cells[$i] ?? '';
            }
        }
        $rows[] = $row;
    }
    return $rows;
}

/**
 * Parsing completo.
 *
 * @return array{results:array, unparsed:int}
 *         `unparsed` conta le righe senza riferimento: vanno mostrate, non
 *         nascoste, perche' di solito significano che il tracciato e' cambiato.
 */
function portalFeedbackParse(string $payload): array
{
    $payload = trim($payload);
    if ($payload === '') {
        throw new RuntimeException('Contenuto vuoto.');
    }

    // Riconoscimento dal contenuto: il nome del file non e' affidabile.
    $rows = str_starts_with($payload, '<')
        ? portalFeedbackParseXml($payload)
        : portalFeedbackParseCsv($payload);

    $results  = [];
    $unparsed = 0;
    foreach ($rows as $row) {
        $normalised = portalFeedbackNormaliseRow($row);
        if ($normalised === null) {
            $unparsed++;
            continue;
        }
        $results[] = $normalised;
    }

    return ['results' => $results, 'unparsed' => $unparsed];
}

// ---------------------------------------------------------------------------
// Applicazione
// ---------------------------------------------------------------------------

/**
 * Trova la riga di pubblicazione da un riferimento. Deve invertire
 * portalFeedReference(): prima il reference_code reale, poi il ripiego
 * GI-000123. Se le due strade divergono, l'esito non si riaggancia piu'
 * all'annuncio ed e' come non averlo ricevuto.
 */
function portalFeedbackMatchListing(PDO $db, string $portal, string $reference): ?array
{
    $stmt = $db->prepare(
        "SELECT pl.* FROM portal_listings pl
           JOIN properties p ON p.id = pl.property_id
          WHERE pl.portal = :portal AND p.reference_code = :ref
          LIMIT 1"
    );
    $stmt->execute(['portal' => $portal, 'ref' => $reference]);
    if ($row = $stmt->fetch()) {
        return $row;
    }

    if (preg_match('/^GI-0*(\d+)$/i', $reference, $m)) {
        $stmt = $db->prepare(
            'SELECT * FROM portal_listings WHERE portal = :portal AND property_id = :pid LIMIT 1'
        );
        $stmt->execute(['portal' => $portal, 'pid' => (int) $m[1]]);
        return $stmt->fetch() ?: null;
    }

    return null;
}

/**
 * Applica gli esiti alle righe di pubblicazione.
 *
 * Le righe toccate diventano `source = 'feed'`: da quel momento la UI rende
 * ID/URL/errore in sola lettura, perche' li possiede il portale e la prossima
 * importazione li riscriverebbe comunque sopra a una modifica manuale.
 *
 * @return array{applied:int, published:int, errors:int, unmatched:array}
 */
function portalFeedbackApply(PDO $db, string $portal, array $results): array
{
    $update = $db->prepare(
        "UPDATE portal_listings
            SET status         = :status,
                external_id    = COALESCE(:external_id, external_id),
                external_url   = COALESCE(:external_url, external_url),
                error_message  = :error_message,
                last_synced_at = NOW(),
                source         = 'feed'
          WHERE id = :id"
    );

    $applied = 0; $published = 0; $errors = 0; $unmatched = [];

    foreach ($results as $r) {
        $listing = portalFeedbackMatchListing($db, $portal, $r['reference']);
        if ($listing === null) {
            // Riferimento sconosciuto: quasi sempre un annuncio cancellato di
            // qua e ancora presente di la'. Si segnala, non si crea nulla:
            // inventare una riga di pubblicazione da un file esterno
            // significherebbe far scrivere il nostro database al portale.
            $unmatched[] = $r['reference'];
            continue;
        }

        $update->execute([
            'status'        => $r['ok'] ? 'published' : 'error',
            'external_id'   => $r['external_id'],
            'external_url'  => $r['external_url'],
            'error_message' => $r['message'],
            'id'            => $listing['id'],
        ]);

        $applied++;
        $r['ok'] ? $published++ : $errors++;
    }

    return [
        'applied'   => $applied,
        'published' => $published,
        'errors'    => $errors,
        'unmatched' => $unmatched,
    ];
}
