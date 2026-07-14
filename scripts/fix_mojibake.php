<?php
/**
 * Repair double-encoded UTF-8 ("mojibake") in text columns: strings like
 * "â€"" (—), "Ã¨" (è) appear when UTF-8 bytes were re-encoded as Latin-1.
 * Idempotent: only touches values that carry a mojibake signature, and only
 * writes back when the recovered string is valid UTF-8 and signature-free.
 *
 * Usage (CLI only):
 *   php scripts/fix_mojibake.php --dry-run   # report what would change
 *   php scripts/fix_mojibake.php             # apply fixes
 */

if (PHP_SAPI !== 'cli') {
    exit("CLI only\n");
}

require_once __DIR__ . '/../config/bootstrap.php';
require_once __DIR__ . '/../config/db.php';

$dryRun = in_array('--dry-run', $argv, true);

// table => [id column, text columns to repair]
$TARGETS = [
    'reminders'      => ['id', ['title', 'description']],
    'property_keys'  => ['id', ['location', 'notes']],
    'properties'     => ['id', ['address', 'description', 'internal_notes']],
    'clients'        => ['id', ['name', 'surname', 'internal_notes']],
    'tenants'        => ['id', ['name', 'surname', 'notes']],
    'leads'          => ['id', ['name', 'surname', 'notes']],
    'communications' => ['id', ['subject', 'body']],
    'contracts'      => ['id', ['title', 'notes']],
    'documents'      => ['id', ['title']],
    'appointments'   => ['id', ['notes']],
    'expenses'       => ['id', ['description', 'notes']],
    'invoices'       => ['id', ['description', 'notes']],
];

function hasMojibake(string $s): bool
{
    // "â€¦" family (punctuation) or "Ã" + continuation (accented letters).
    // Letters ≥ U+00A0 (à ù ò) double-encode as Ã + Â+cont (C3 83 C2 xx),
    // letters in C0–FF range (è é ì) as Ã + single continuation byte.
    return str_contains($s, "\xC3\xA2\xE2\x82\xAC")                       // â€ → —, –, ', ", …
        || preg_match('/\xC3\x83(?:\xC2[\x80-\xBF]|[\x80-\xBF])/', $s) === 1  // Ã¨ Ã  … → è à …
        || str_contains($s, "\xC3\x82\xC2");                              // Â + cont. → NBSP °…
}

function recover(string $s): string
{
    // Mojibake is UTF-8 bytes that were mis-read as Windows-1252 and
    // re-encoded to UTF-8 — converting back to CP1252 recovers the original
    // (CP1252, not ISO-8859-1: € " " – — live in the 0x80–0x9F range).
    for ($i = 0; $i < 2 && hasMojibake($s); $i++) {
        $candidate = mb_convert_encoding($s, 'Windows-1252', 'UTF-8');
        if ($candidate === false || $candidate === '' || !mb_check_encoding($candidate, 'UTF-8')) {
            break;
        }
        $s = $candidate;
    }
    return $s;
}

$db = getDB();
$totalFixed = 0;

foreach ($TARGETS as $table => [$idCol, $cols]) {
    try {
        $rows = $db->query("SELECT `$idCol` AS id, `" . implode('`,`', $cols) . "` FROM `$table`")
                   ->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
        echo "skip $table: " . $e->getMessage() . "\n";
        continue;
    }

    $fixedInTable = 0;
    foreach ($rows as $row) {
        $sets = [];
        $params = [];
        foreach ($cols as $col) {
            $v = $row[$col];
            if (!is_string($v) || $v === '' || !hasMojibake($v)) {
                continue;
            }
            $fixed = recover($v);
            if ($fixed !== $v && mb_check_encoding($fixed, 'UTF-8') && !hasMojibake($fixed)) {
                $sets[] = "`$col` = ?";
                $params[] = $fixed;
                echo ($dryRun ? '[dry] ' : '') . "$table#{$row['id']}.$col: " .
                     mb_substr($v, 0, 40) . " => " . mb_substr($fixed, 0, 40) . "\n";
            }
        }
        if ($sets) {
            $fixedInTable++;
            if (!$dryRun) {
                $params[] = $row['id'];
                $db->prepare("UPDATE `$table` SET " . implode(', ', $sets) . " WHERE `$idCol` = ?")
                   ->execute($params);
            }
        }
    }
    if ($fixedInTable) {
        echo "$table: $fixedInTable row(s) " . ($dryRun ? 'would be fixed' : 'fixed') . "\n";
    }
    $totalFixed += $fixedInTable;
}

echo ($dryRun ? "DRY RUN — " : "") . "total rows: $totalFixed\n";
