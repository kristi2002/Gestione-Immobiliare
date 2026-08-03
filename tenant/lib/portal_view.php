<?php
/**
 * Portale Inquilino — aiutanti di vista.
 *
 * Solo formattazione e marcatura. Niente query: quelle stanno in portal_data.php.
 */

/** Scorciatoia di escape. Ogni valore che finisce in pagina passa da qui. */
function tEsc($v): string
{
    return htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8');
}

/** Importo in euro all'italiana. */
function tMoney($v, int $dec = 2): string
{
    return '€ ' . number_format((float) $v, $dec, ',', '.');
}

/**
 * Numero all'italiana senza decimali inutili.
 * `sqm` e' un DECIMAL, quindi arriva "133.00": scritto cosi' si legge come un
 * prezzo, non come una superficie. 133 resta 133, 133.50 diventa "133,5".
 */
function tNum($v): string
{
    $f = (float) $v;
    $s = rtrim(rtrim(number_format($f, 2, ',', '.'), '0'), ',');
    return $s === '' ? '0' : $s;
}

/** Data gg/mm/aaaa, con trattino se manca. */
function tDate($v): string
{
    if (!$v) return '—';
    $ts = strtotime((string) $v);
    return $ts ? date('d/m/Y', $ts) : '—';
}

/** Icona lucide. La classe va sull'<i>: createIcons la ricopia sull'<svg>. */
function tIcon(string $name, string $class = ''): string
{
    return '<i data-lucide="' . tEsc($name) . '"'
         . ($class !== '' ? ' class="' . tEsc($class) . '"' : '')
         . ' aria-hidden="true"></i>';
}

/** "Mostrati i piu' recenti N di M" — solo se i due numeri divergono. */
function tTruncNote(int $shown, int $total): string
{
    if ($shown >= $total) return '';
    return '<div class="tp-trunc">Mostrati i piu\' recenti ' . $shown . ' di ' . $total
         . '. Per lo storico completo contatta l\'agenzia.</div>';
}

/** Riquadro "qui non c'e' niente", che e' comunque una risposta. */
function tEmpty(string $icon, string $title, string $sub = ''): string
{
    return '<div class="tp-empty">'
         . '<div class="tp-empty__ico">' . tIcon($icon) . '</div>'
         . '<div class="tp-empty__t">' . tEsc($title) . '</div>'
         . ($sub !== '' ? '<div class="tp-empty__s">' . tEsc($sub) . '</div>' : '')
         . '</div>';
}

/** Variante di pastiglia per uno stato di pagamento. */
function tPayBadge(string $status): string
{
    $variant = match ($status) {
        'paid'      => 'success',
        'late'      => 'danger',
        'cancelled' => 'muted',
        default     => 'warning',
    };
    $label = TENANT_PAY_STATUS[$status] ?? $status;
    return '<span class="badge badge--' . $variant . '">' . tEsc($label) . '</span>';
}

/** Icona lucide adatta all'estensione del file. */
function tDocIcon(?string $filename): string
{
    $ext = strtolower(pathinfo((string) $filename, PATHINFO_EXTENSION));
    return match ($ext) {
        'pdf'                        => 'file-text',
        'doc', 'docx'                => 'file-type',
        'xls', 'xlsx', 'csv'         => 'file-spreadsheet',
        'jpg', 'jpeg', 'png', 'webp', 'gif' => 'file-image',
        'zip', 'rar', '7z'           => 'file-archive',
        default                      => 'file',
    };
}

/** Dimensione file leggibile. Torna stringa vuota se il dato non c'e'. */
function tFileSize($bytes): string
{
    $b = (int) $bytes;
    if ($b <= 0) return '';
    if ($b < 1024) return $b . ' B';
    if ($b < 1048576) return round($b / 1024) . ' KB';
    return round($b / 1048576, 1) . ' MB';
}
