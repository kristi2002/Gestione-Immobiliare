<?php
/**
 * Generatore del feed di sindacazione, uno per portale.
 *
 * Modello reale del mercato italiano: NON si spinge annuncio per annuncio via
 * API. Si pubblica un feed a un URL stabile e il portale lo PASSA A PRENDERE
 * (giornaliero/orario), poi restituisce un file di esito. Vedi
 * lib/portal_feedback.php per il ritorno.
 *
 * Tre cose che questo file NON fa, di proposito:
 *
 * 1. NON riscrive la validazione. Chiama portalValidateProperty(), la stessa
 *    del blocco in api/portal_sync.php. Se ne esistessero due, il pre-flight
 *    direbbe "ok" a righe che il feed scarta, e la funzione perderebbe senso.
 * 2. NON inventa codici di tassonomia. Se manca la mappatura la riga viene
 *    esclusa: spedire il valore interno grezzo si traduce in uno scarto lato
 *    portale con un messaggio che non dice niente.
 * 3. NON include dati personali del proprietario. api/property_export.php li
 *    include (nome/telefono/email) perche' e' un export interno dietro
 *    sessione; questo feed invece lo scarica un crawler esterno con un token
 *    in URL. Il contatto dell'annuncio e' l'AGENZIA — al portale il
 *    proprietario non serve, e pubblicarlo sarebbe una cessione di dati
 *    personali a terzi senza alcuna base.
 *
 * ⚠️ I tracciati qui sotto sono una ricostruzione ragionevole della forma
 * comune, NON le specifiche contrattuali dei portali (si ottengono solo con
 * l'account a pagamento). Vanno riconciliati in fase di onboarding: la
 * STRUTTURA si cambia qui, i CODICI in portal_field_map senza rilascio.
 */

require_once __DIR__ . '/../config/portal_specs.php';
// settings.php serve qui dentro (getSetting/setSetting per contatto agenzia,
// base URL e token) e NON si puo' dare per scontato che l'abbia incluso il
// chiamante: api/portal_feed.php lo fa, api/portal_sync.php passa da
// api_bootstrap che non lo carica. Dipendenza dichiarata dove viene usata.
require_once __DIR__ . '/../config/settings.php';
require_once __DIR__ . '/portal_mapping.php';
require_once __DIR__ . '/portal_validation.php';

/** Stati riga che dichiarano l'annuncio destinato al portale. */
const PORTAL_FEED_INCLUDED_STATUSES = ['publishing', 'published'];

/**
 * Riferimento con cui l'annuncio viaggia. E' la CHIAVE DI CORRELAZIONE: e'
 * l'unico valore che ritorna nel feed di esito, quindi deve essere stabile nel
 * tempo e uguale in andata e ritorno (vedi portalFeedbackMatchListing()).
 */
function portalFeedReference(array $property): string
{
    $code = trim((string) ($property['reference_code'] ?? ''));
    return $code !== ''
        ? $code
        : 'GI-' . str_pad((string) $property['id'], 6, '0', STR_PAD_LEFT);
}

/** Base assoluta per foto e planimetrie: il portale deve poterle scaricare. */
function portalFeedBaseUrl(): string
{
    $configured = trim((string) (getSetting('portal_feed_base_url') ?? ''));
    if ($configured !== '') {
        return rtrim($configured, '/');
    }
    // Fallback per generazione da richiesta HTTP; da cron non c'e' host, ed e'
    // esattamente il caso in cui l'impostazione va valorizzata a mano.
    $scheme = (($_SERVER['HTTPS'] ?? '') === 'on') ? 'https' : 'http';
    $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme . '://' . $host;
}

/**
 * Candidati: immobili con una riga di pubblicazione viva per quel portale.
 * L'ordinamento e' stabile cosi' due generazioni consecutive senza modifiche
 * producono byte identici (utile per diff e per non far ri-processare tutto).
 */
function portalFeedCandidates(PDO $db, string $portal): array
{
    $in = implode(',', array_fill(0, count(PORTAL_FEED_INCLUDED_STATUSES), '?'));
    $stmt = $db->prepare(
        "SELECT p.*, pl.id AS listing_id, pl.status AS listing_status, pl.external_id
           FROM portal_listings pl
           JOIN properties p ON p.id = pl.property_id
          WHERE pl.portal = ?
            AND pl.status IN ($in)
          ORDER BY p.id ASC"
    );
    $stmt->execute(array_merge([$portal], PORTAL_FEED_INCLUDED_STATUSES));
    return $stmt->fetchAll();
}

/** Media di un immobile, in URL assoluti. */
function portalFeedMedia(PDO $db, int $propertyId): array
{
    $stmt = $db->prepare(
        "SELECT media_type, file_path
           FROM property_media
          WHERE property_id = :id AND media_type IN ('photo','floor_plan')
          ORDER BY media_type, sort_order, id"
    );
    $stmt->execute(['id' => $propertyId]);

    $base   = portalFeedBaseUrl();
    $photos = [];
    $plans  = [];
    foreach ($stmt->fetchAll() as $row) {
        $url = $base . '/' . ltrim((string) $row['file_path'], '/');
        if ($row['media_type'] === 'photo') { $photos[] = $url; } else { $plans[] = $url; }
    }
    return ['photos' => $photos, 'floor_plans' => $plans];
}

/**
 * Costruisce il feed.
 *
 * @return array{xml:string, included:array, excluded:array, portal:string}
 *         `excluded` elenca cosa e' rimasto fuori e perche': un feed che
 *         dimagrisce in silenzio e' il modo migliore per non accorgersi che
 *         meta' portafoglio non e' piu' pubblicato.
 */
function portalFeedBuild(PDO $db, string $portal): array
{
    $spec = portalSpec($portal);
    if ($spec === null) {
        throw new InvalidArgumentException('Portale non riconosciuto: ' . $portal);
    }

    $included = [];
    $excluded = [];

    foreach (portalFeedCandidates($db, $portal) as $property) {
        $violations = portalValidateProperty($db, (int) $property['id'], $portal);
        if ($violations !== []) {
            $excluded[] = [
                'property_id' => (int) $property['id'],
                'reference'   => portalFeedReference($property),
                'reasons'     => array_column($violations, 'message'),
            ];
            continue;
        }
        $property['_media'] = portalFeedMedia($db, (int) $property['id']);
        $included[] = $property;
    }

    $xml = match ($portal) {
        'idealista' => portalFeedXmlIdealista($db, $included),
        default     => portalFeedXmlImmobiliare($db, $included, $portal),
    };

    return ['xml' => $xml, 'included' => $included, 'excluded' => $excluded, 'portal' => $portal];
}

// ---------------------------------------------------------------------------
// Costruzione XML
//
// DOMDocument e non concatenazione di stringhe: l'escaping di & e degli accenti
// nelle descrizioni lo fa la libreria. Un feed che si rompe su una "&" in un
// indirizzo e' un classico, e si scopre solo dallo scarto del portale.
// ---------------------------------------------------------------------------

function portalFeedAppend(DOMDocument $doc, DOMElement $parent, string $name, $value): ?DOMElement
{
    if ($value === null || $value === '') {
        return null; // tag vuoti: alcuni tracciati li trattano come "azzera il campo"
    }
    $el = $doc->createElement($name);
    $el->appendChild($doc->createTextNode((string) $value));
    $parent->appendChild($el);
    return $el;
}

/** Contatto pubblicato: l'agenzia, mai il proprietario. */
function portalFeedAgencyNode(DOMDocument $doc, DOMElement $parent): void
{
    $agency = $doc->createElement('Agenzia');
    portalFeedAppend($doc, $agency, 'Nome',      getSetting('agency_name'));
    portalFeedAppend($doc, $agency, 'Telefono',  getSetting('agency_phone'));
    portalFeedAppend($doc, $agency, 'Email',     getSetting('agency_email'));
    portalFeedAppend($doc, $agency, 'Indirizzo', getSetting('agency_address'));
    if ($agency->hasChildNodes()) {
        $parent->appendChild($agency);
    }
}

/**
 * Tracciato piatto (Immobiliare.it e simili): un elemento per attributo,
 * optional come tag booleani allo stesso livello.
 */
function portalFeedXmlImmobiliare(PDO $db, array $properties, string $portal): string
{
    $doc = new DOMDocument('1.0', 'UTF-8');
    $doc->formatOutput = true;

    $root = $doc->createElement('Annunci');
    $root->setAttribute('generato', date('c'));
    $root->setAttribute('totale', (string) count($properties));
    $doc->appendChild($root);

    foreach ($properties as $p) {
        $ad = $doc->createElement('Annuncio');

        portalFeedAppend($doc, $ad, 'Riferimento',  portalFeedReference($p));
        portalFeedAppend($doc, $ad, 'Tipologia',    portalMapValue($db, $portal, 'property_type', $p['property_type']));
        portalFeedAppend($doc, $ad, 'Contratto',    portalMapValue($db, $portal, 'price_type', $p['price_type']));
        portalFeedAppend($doc, $ad, 'Titolo',       $p['listing_title']);
        portalFeedAppend($doc, $ad, 'Descrizione',  $p['description']);

        $addr = $doc->createElement('Indirizzo');
        portalFeedAppend($doc, $addr, 'Via',       $p['address']);
        portalFeedAppend($doc, $addr, 'Comune',    $p['city']);
        portalFeedAppend($doc, $addr, 'Provincia', $p['province']);
        portalFeedAppend($doc, $addr, 'CAP',       $p['cap']);
        portalFeedAppend($doc, $addr, 'Latitudine',  $p['latitude']);
        portalFeedAppend($doc, $addr, 'Longitudine', $p['longitude']);
        $ad->appendChild($addr);

        // Il prezzo su richiesta e' una scelta editoriale: si dichiara, non si
        // omette e basta, altrimenti il portale legge "prezzo mancante".
        if ((int) ($p['price_on_request'] ?? 0) === 1) {
            portalFeedAppend($doc, $ad, 'PrezzoSuRichiesta', 'true');
        } else {
            portalFeedAppend($doc, $ad, 'Prezzo', $p['price'] !== null ? number_format((float) $p['price'], 2, '.', '') : null);
        }

        portalFeedAppend($doc, $ad, 'Superficie',      $p['sqm']);
        portalFeedAppend($doc, $ad, 'Locali',          $p['locali'] ?: $p['rooms']);
        portalFeedAppend($doc, $ad, 'Bagni',           $p['bathrooms']);
        portalFeedAppend($doc, $ad, 'Piano',           $p['floor']);
        portalFeedAppend($doc, $ad, 'PianiEdificio',   $p['total_floors']);
        portalFeedAppend($doc, $ad, 'AnnoCostruzione', $p['year_built']);
        portalFeedAppend($doc, $ad, 'ClasseEnergetica', $p['energy_class']);
        portalFeedAppend($doc, $ad, 'IPE',             $p['ipe_value']);
        portalFeedAppend($doc, $ad, 'SpeseCondominio', $p['condo_fees']);
        portalFeedAppend($doc, $ad, 'Ascensore',       isset($p['elevator']) ? ((int) $p['elevator'] ? 'true' : 'false') : null);
        portalFeedAppend($doc, $ad, 'Arredato',        $p['furnished']);
        portalFeedAppend($doc, $ad, 'Riscaldamento',   $p['heating']);
        portalFeedAppend($doc, $ad, 'Stato',           $p['condition_state']);

        $media = $doc->createElement('Media');
        foreach ($p['_media']['photos'] as $i => $url) {
            $img = portalFeedAppend($doc, $media, 'Foto', $url);
            if ($img) { $img->setAttribute('ordine', (string) ($i + 1)); }
        }
        foreach ($p['_media']['floor_plans'] as $url) {
            portalFeedAppend($doc, $media, 'Planimetria', $url);
        }
        if ($media->hasChildNodes()) { $ad->appendChild($media); }

        portalFeedAgencyNode($doc, $ad);
        $root->appendChild($ad);
    }

    return $doc->saveXML();
}

/**
 * Tracciato annidato (Idealista e simili): tassonomia inglese e optional
 * raccolti sotto <features> come elementi codificati invece che piatti.
 * E' precisamente il motivo per cui la struttura NON puo' stare in una
 * tabella di mappatura: qui cambia la forma, non solo il codice.
 */
function portalFeedXmlIdealista(PDO $db, array $properties): string
{
    $doc = new DOMDocument('1.0', 'UTF-8');
    $doc->formatOutput = true;

    $root = $doc->createElement('properties');
    $root->setAttribute('generated', date('c'));
    $doc->appendChild($root);

    foreach ($properties as $p) {
        $node = $doc->createElement('property');

        portalFeedAppend($doc, $node, 'reference',    portalFeedReference($p));
        portalFeedAppend($doc, $node, 'propertyType', portalMapValue($db, 'idealista', 'property_type', $p['property_type']));
        portalFeedAppend($doc, $node, 'operation',    portalMapValue($db, 'idealista', 'price_type', $p['price_type']));
        portalFeedAppend($doc, $node, 'title',        $p['listing_title']);
        portalFeedAppend($doc, $node, 'description',  $p['description']);

        $loc = $doc->createElement('location');
        portalFeedAppend($doc, $loc, 'address',   $p['address']);
        portalFeedAppend($doc, $loc, 'town',      $p['city']);
        portalFeedAppend($doc, $loc, 'province',  $p['province']);
        portalFeedAppend($doc, $loc, 'postalCode', $p['cap']);
        portalFeedAppend($doc, $loc, 'latitude',  $p['latitude']);
        portalFeedAppend($doc, $loc, 'longitude', $p['longitude']);
        $node->appendChild($loc);

        if ((int) ($p['price_on_request'] ?? 0) === 1) {
            portalFeedAppend($doc, $node, 'priceOnRequest', 'true');
        } else {
            portalFeedAppend($doc, $node, 'price', $p['price'] !== null ? number_format((float) $p['price'], 2, '.', '') : null);
        }
        portalFeedAppend($doc, $node, 'currency',    'EUR');
        portalFeedAppend($doc, $node, 'area',        $p['sqm']);
        portalFeedAppend($doc, $node, 'rooms',       $p['locali'] ?: $p['rooms']);
        portalFeedAppend($doc, $node, 'bathrooms',   $p['bathrooms']);
        portalFeedAppend($doc, $node, 'floor',       $p['floor']);
        portalFeedAppend($doc, $node, 'energyClass', $p['energy_class']);

        // Optional annidati: <feature code="..."/> invece di tag piatti.
        $features = $doc->createElement('features');
        $flags = [
            'lift'           => $p['elevator'] ?? null,
            'armouredDoor'   => $p['armored_door'] ?? null,
            'alarm'          => $p['alarm_system'] ?? null,
            'opticalFiber'   => $p['optical_fiber'] ?? null,
            'fireplace'      => $p['fireplace'] ?? null,
            'swimmingPool'   => $p['pool'] ?? null,
            'disabledAccess' => $p['disabled_access'] ?? null,
        ];
        foreach ($flags as $code => $on) {
            if ((int) $on === 1) {
                $f = $doc->createElement('feature');
                $f->setAttribute('code', $code);
                $features->appendChild($f);
            }
        }
        if ($features->hasChildNodes()) { $node->appendChild($features); }

        $images = $doc->createElement('images');
        foreach ($p['_media']['photos'] as $i => $url) {
            $img = portalFeedAppend($doc, $images, 'image', $url);
            if ($img) { $img->setAttribute('order', (string) ($i + 1)); }
        }
        foreach ($p['_media']['floor_plans'] as $url) {
            $img = portalFeedAppend($doc, $images, 'image', $url);
            if ($img) { $img->setAttribute('type', 'floorPlan'); }
        }
        if ($images->hasChildNodes()) { $node->appendChild($images); }

        $contact = $doc->createElement('contact');
        portalFeedAppend($doc, $contact, 'name',  getSetting('agency_name'));
        portalFeedAppend($doc, $contact, 'phone', getSetting('agency_phone'));
        portalFeedAppend($doc, $contact, 'email', getSetting('agency_email'));
        if ($contact->hasChildNodes()) { $node->appendChild($contact); }

        $root->appendChild($node);
    }

    return $doc->saveXML();
}

// ---------------------------------------------------------------------------
// Token di accesso
// ---------------------------------------------------------------------------

/**
 * Token del feed. Il crawler del portale non ha una sessione: l'URL e' un
 * segreto, quindi va trattato come tale (confronto a tempo costante, e ruotabile
 * senza toccare il codice).
 */
function portalFeedToken(): string
{
    $token = trim((string) (getSetting('portal_feed_token') ?? ''));
    if ($token === '') {
        $token = bin2hex(random_bytes(24));
        setSetting('portal_feed_token', $token);
    }
    return $token;
}

function portalFeedTokenValid(string $candidate): bool
{
    $expected = portalFeedToken();
    return $candidate !== '' && hash_equals($expected, $candidate);
}
