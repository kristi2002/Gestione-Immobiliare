<?php
/**
 * Portal lead import — parses real-estate portal notification emails
 * (Immobiliare.it, Idealista, Casa.it, Subito) into `leads` rows.
 *
 * Used by:
 *   - api/email_inbound.php                 (Mailgun webhook, $onlyPortals = true)
 *   - api/leads.php?action=import_email     (manual paste from the Leads view)
 *
 * Parsing is deliberately defensive: portal email formats drift, so field
 * extraction is label-alias + fallback based, and the original text is always
 * preserved in the lead notes — the worst case degrades to "lead with raw
 * text in the notes", never to silent data loss.
 */

const PORTAL_LEAD_DOMAINS = [
    'immobiliare.it' => 'immobiliare',
    'idealista.it'   => 'idealista',
    'idealista.com'  => 'idealista',
    'casa.it'        => 'casa',
    'subito.it'      => 'subito',
];

const PORTAL_LEAD_LABELS = [
    'immobiliare' => 'Immobiliare.it',
    'idealista'   => 'Idealista',
    'casa'        => 'Casa.it',
    'subito'      => 'Subito',
    'email'       => 'email',
];

/**
 * Which portal (if any) sent this email. Checks the sender domain first,
 * then falls back to the portal naming itself in subject/body (covers
 * emails forwarded by the agency from its own inbox).
 */
function portalLeadDetect(string $fromRaw, string $subject = '', string $body = ''): ?string
{
    $senderDomain = '';
    if (preg_match('/@([a-z0-9.\-]+)/i', $fromRaw, $m)) {
        $senderDomain = strtolower(rtrim($m[1], '.>'));
    }
    foreach (PORTAL_LEAD_DOMAINS as $domain => $portal) {
        if ($senderDomain === $domain || str_ends_with($senderDomain, '.' . $domain)) {
            return $portal;
        }
    }
    $haystack = mb_strtolower($subject . ' ' . mb_substr($body, 0, 3000));
    foreach (PORTAL_LEAD_DOMAINS as $domain => $portal) {
        if (str_contains($haystack, $domain)) {
            return $portal;
        }
    }
    return null;
}

/** HTML → readable plain text; normalized newlines. */
function portalLeadPlainText(string $body): string
{
    if (preg_match('/<[a-z][\s\S]*>/i', $body)) {
        $body = preg_replace('/<br\s*\/?\s*>|<\/(?:p|div|tr|li|h[1-6])>/i', "\n", $body);
        $body = strip_tags($body);
        $body = html_entity_decode($body, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    }
    $body = str_replace(["\r\n", "\r"], "\n", $body);
    $body = preg_replace('/[ \t]+\n/', "\n", $body);
    return trim(preg_replace('/\n{3,}/', "\n\n", $body));
}

/**
 * Extract contact + inquiry fields from a portal notification email.
 * Every field is optional — callers must handle nulls.
 */
function portalLeadParse(string $subject, string $body): array
{
    $text = portalLeadPlainText($body);
    $out  = [
        'name' => null, 'email' => null, 'phone' => null,
        'reference' => null, 'message' => null, 'listing_url' => null,
        'interest' => 'entrambi',
    ];

    // "Label: value" lines, tolerant of bullets/quoting/bold markers.
    $label = static function (string $aliases) use ($text): ?string {
        if (preg_match('/^[ \t*>\-•#]*(?:' . $aliases . ')[ \t]*:[ \t]*(\S.*)$/mi', $text, $m)) {
            return trim($m[1], " \t*");
        }
        return null;
    };

    $out['name']      = $label('nome e cognome|nome cliente|nominativo|nome|cliente|contatto');
    $out['email']     = $label('e-?mail(?: cliente)?|indirizzo e-?mail|posta elettronica');
    $out['phone']     = $label('telefono(?: cliente)?|tel|cellulare|numero di telefono|recapito(?: telefonico)?');
    $out['reference'] = $label('riferimento annuncio|codice annuncio|codice riferimento|riferimento|rif');
    $out['message']   = $label('messaggio|richiesta|testo del messaggio|commento');

    // Message as a block under a bare "Messaggio" heading (no inline value).
    if ($out['message'] === null
        && preg_match('/^[ \t*>\-•#]*(?:messaggio|richiesta)[ \t]*:?[ \t]*\n((?:.+\n?)+?)(?=\n[ \t]*\n|\z)/mi', $text, $m)) {
        $out['message'] = trim($m[1]);
    }

    // "Rif. ABC123" inline in subject or body (no colon form).
    if ($out['reference'] === null
        && preg_match('/\brif(?:erimento)?\.?[ \t:]+([A-Z0-9][A-Z0-9\-\/_.]{1,20})\b/i', $subject . "\n" . $text, $m)) {
        $out['reference'] = $m[1];
    }

    // Email fallback: any address that is not the portal's own machine sender.
    if (!$out['email'] && preg_match_all('/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i', $text, $mm)) {
        foreach ($mm[0] as $candidate) {
            $dom      = strtolower(substr(strrchr($candidate, '@'), 1));
            $isPortal = false;
            foreach (PORTAL_LEAD_DOMAINS as $pd => $_) {
                if ($dom === $pd || str_ends_with($dom, '.' . $pd)) { $isPortal = true; break; }
            }
            if ($isPortal || preg_match('/^(?:no-?reply|notifiche?|newsletter|info|mailer|postmaster)@/i', $candidate)) {
                continue;
            }
            $out['email'] = strtolower($candidate);
            break;
        }
    }
    if ($out['email'] !== null && !filter_var($out['email'], FILTER_VALIDATE_EMAIL)) {
        $out['email'] = null;
    }

    // Phone fallback: Italian mobile/landline anywhere in the text.
    if (!$out['phone'] && preg_match('/(?<![\d\/])((?:\+39[ .]?)?3\d{2}[ .\-]?\d{3}[ .\-]?\d{3,4}|(?:\+39[ .]?)?0\d{1,3}[ .\-\/]?\d{5,8})(?!\d)/', $text, $m)) {
        $out['phone'] = trim($m[1]);
    }
    if ($out['phone'] !== null) {
        $out['phone'] = mb_substr(trim($out['phone']), 0, 30);
    }

    // Listing URL (kept in notes so the agent can open the ad in one click).
    if (preg_match('/https?:\/\/[^\s<>"\']*(?:immobiliare\.it|idealista\.(?:it|com)|casa\.it|subito\.it)[^\s<>"\']*/i', $text, $m)) {
        $out['listing_url'] = $m[0];
    }

    // Affitto vs acquisto from the wording; ambiguous → 'entrambi'.
    $hay  = mb_strtolower($subject . ' ' . mb_substr($text, 0, 3000));
    $rent = str_contains($hay, 'affitt');
    $buy  = (bool) preg_match('/vendit|acquist|compra/', $hay);
    $out['interest'] = ($rent && !$buy) ? 'affitto' : ((!$rent && $buy) ? 'acquisto' : 'entrambi');

    return $out;
}

/**
 * Full import pipeline: detect portal → parse → dedup → create/append lead.
 * Links the inquiry to a property via the agency reference code when present.
 *
 * $onlyPortals: when true (webhook context) a non-portal email returns null
 * instead of being imported — ordinary client emails must NOT become leads.
 *
 * Returns null (skipped), ['error' => 'no_contact', ...] (nothing usable),
 * or ['created'|'duplicate' => true, 'lead_id' => int, ...] on success.
 */
function portalLeadImport(PDO $db, string $fromRaw, string $subject, string $body, bool $onlyPortals = false): ?array
{
    $portal = portalLeadDetect($fromRaw, $subject, $body);
    if ($portal === null && $onlyPortals) {
        return null;
    }

    $parsed = portalLeadParse($subject, $body);
    $source = $portal ?? 'email';
    $lbl    = PORTAL_LEAD_LABELS[$source] ?? $source;

    // Direct (non-portal) inquiry: the sender is the lead — use their address.
    if (!$parsed['email'] && $portal === null
        && preg_match('/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i', $fromRaw, $m)) {
        $parsed['email'] = strtolower($m[0]);
    }

    if (!$parsed['email'] && !$parsed['phone']) {
        return ['error' => 'no_contact', 'portal' => $portal, 'parsed' => $parsed];
    }

    // Migration guard: if leads.source does not (yet) know this portal value,
    // fall back to an always-valid enum member rather than failing the INSERT.
    $col = $db->query(
        "SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'source'"
    )->fetchColumn();
    if ($col && !str_contains($col, "'" . $source . "'")) {
        $source = 'web';
    }

    // leads has separate NOT NULL name/surname — split the parsed full name.
    // Some portals put the email address in the "Nome" field: use its local part.
    $fullName = trim((string) ($parsed['name'] ?? ''));
    if (str_contains($fullName, '@')) {
        $fullName = ucfirst((string) (strstr($fullName, '@', true) ?: ''));
    }
    if ($fullName === '' && $parsed['email']) {
        $fullName = ucfirst((string) (strstr($parsed['email'], '@', true) ?: 'Lead'));
    }
    if ($fullName === '') {
        $fullName = 'Lead ' . $lbl;
    }
    $parts   = preg_split('/\s+/', $fullName, 2);
    $name    = mb_substr($parts[0] ?? '', 0, 100);
    $surname = mb_substr($parts[1] ?? '', 0, 100);

    // Link the inquiry to the property via the agency reference code.
    $property = null;
    if ($parsed['reference']) {
        $stmt = $db->prepare(
            'SELECT id, address, city, reference_code FROM properties
              WHERE reference_code IS NOT NULL AND UPPER(reference_code) = UPPER(:ref) LIMIT 1'
        );
        $stmt->execute(['ref' => $parsed['reference']]);
        $property = $stmt->fetch() ?: null;
    }

    $when  = date('d/m/Y H:i');
    $lines = ['Lead importato da ' . $lbl . ' il ' . $when . '.'];
    if ($property) {
        $lines[] = "Immobile richiesto: {$property['address']}, {$property['city']} (Rif {$property['reference_code']}, ID {$property['id']})";
    } elseif ($parsed['reference']) {
        $lines[] = 'Riferimento annuncio: ' . $parsed['reference'] . ' (nessun immobile corrispondente)';
    }
    if ($parsed['listing_url']) {
        $lines[] = 'Annuncio: ' . $parsed['listing_url'];
    }
    if ($subject !== '') {
        $lines[] = 'Oggetto: ' . $subject;
    }
    if ($parsed['message']) {
        $lines[] = "\nMessaggio:\n" . mb_substr($parsed['message'], 0, 2000);
    } else {
        $plain = portalLeadPlainText($body);
        if ($plain !== '') {
            $lines[] = "\nTesto email:\n" . mb_substr($plain, 0, 1500);
        }
    }
    $notes = implode("\n", $lines);

    // Dedup: same person inquiring again appends to the open lead instead of
    // creating a duplicate card the agent has to merge by hand.
    $existing = null;
    if ($parsed['email']) {
        $stmt = $db->prepare(
            "SELECT id, name, surname FROM leads
              WHERE status NOT IN ('converted','lost') AND email IS NOT NULL AND LOWER(email) = :e
              ORDER BY id DESC LIMIT 1"
        );
        $stmt->execute(['e' => strtolower($parsed['email'])]);
        $existing = $stmt->fetch() ?: null;
    }
    if (!$existing && $parsed['phone']) {
        $digits = preg_replace('/\D+/', '', $parsed['phone']);
        if (strlen($digits) >= 8) {
            $stmt = $db->prepare(
                "SELECT id, name, surname FROM leads
                  WHERE status NOT IN ('converted','lost') AND phone IS NOT NULL
                    AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'.',''),'/',''),'+','') LIKE :p
                  ORDER BY id DESC LIMIT 1"
            );
            $stmt->execute(['p' => '%' . substr($digits, -9)]);
            $existing = $stmt->fetch() ?: null;
        }
    }

    if ($existing) {
        $append = "\n\n— {$when} · Nuova richiesta da {$lbl}"
            . ($property ? " per {$property['address']}" : ($parsed['reference'] ? " (Rif {$parsed['reference']})" : ''))
            . ($parsed['message'] ? ":\n" . mb_substr($parsed['message'], 0, 2000) : '.');
        $db->prepare("UPDATE leads SET notes = CONCAT(COALESCE(notes, ''), :app) WHERE id = :id")
           ->execute(['app' => $append, 'id' => $existing['id']]);

        return [
            'created'      => false,
            'duplicate'    => true,
            'lead_id'      => (int) $existing['id'],
            'lead_name'    => trim($existing['surname'] . ' ' . $existing['name']),
            'portal'       => $source,
            'portal_label' => $lbl,
            'property'     => $property,
        ];
    }

    $ins = $db->prepare(
        "INSERT INTO leads (name, surname, phone, email, interest_type, source, status, notes)
         VALUES (:name, :surname, :phone, :email, :interest, :source, 'new', :notes)"
    );
    $ins->execute([
        'name'     => $name,
        'surname'  => $surname,
        'phone'    => $parsed['phone'],
        'email'    => $parsed['email'],
        'interest' => $parsed['interest'],
        'source'   => $source,
        'notes'    => $notes,
    ]);

    return [
        'created'      => true,
        'duplicate'    => false,
        'lead_id'      => (int) $db->lastInsertId(),
        'lead_name'    => trim($surname . ' ' . $name) ?: $name,
        'portal'       => $source,
        'portal_label' => $lbl,
        'property'     => $property,
    ];
}
