<?php
/**
 * check_enum_drift.php — confronta ogni whitelist PHP con l'ENUM che le sta sotto.
 *
 *   php scripts/check_enum_drift.php
 *   exit 0 = allineati · exit 1 = almeno una divergenza
 *
 * Perche' esiste
 * --------------
 * E' il bug ricorrente di questo repository, e ricompare a ogni migrazione che
 * tocca un enum. Ha due direzioni, entrambe silenziose:
 *
 *   PHP-only  — il codice offre un valore che la colonna non accetta. Passa la
 *               validazione applicativa e viene rifiutato dal database: in
 *               sql_mode STRICT e' un 1265, che l'utente legge come
 *               "Errore database". (agent_commissions.status non aveva
 *               'cancelled' mentre COMMISSION_STATUSES lo dichiarava.)
 *   DB-only   — una migrazione allarga la colonna e nessuno aggiorna la
 *               costante: l'opzione esiste nei dati ma il form la rifiuta,
 *               e il valore diventa impossibile da reinserire dopo averlo letto.
 *
 * Nessuna delle due si vede provando l'applicazione con dati normali, ed
 * entrambe hanno prodotto findings reali (phase62, phase76, phase78).
 *
 * Aggiungere un controllo = una riga in CHECKS.
 */

require_once __DIR__ . '/../config/cli_only.php';
require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');
require_once __DIR__ . '/../config/db.php';

/** [tabella, colonna, file php, nome della costante] */
const CHECKS = [
    ['suppliers',          'category',        'api/suppliers.php',   'SUPPLIER_CATEGORIES'],
    ['agent_commissions',  'status',          'api/commissions.php', 'COMMISSION_STATUSES'],
    ['agent_commissions',  'commission_type', 'api/commissions.php', 'COMMISSION_TYPES'],
    ['agent_commissions',  'agent_role',      'api/commissions.php', 'COMMISSION_AGENT_ROLES'],
    ['property_insurance', 'policy_type',     'api/insurance.php',   'INSURANCE_TYPES'],
    ['documents',          'doc_type',        'api/documents.php',   'DOC_TYPES'],
    ['leads',              'source',          'config/lead_sources.php', 'LEAD_SOURCE_LABELS'],
    ['payments',           'method',          'api/payments.php',    'PAYMENT_METHODS'],
    ['expenses',           'category',        'api/expenses.php',    'EXPENSE_CATEGORIES'],
    ['contracts',          'contract_type',   'api/contracts.php',   'CONTRACT_TYPES'],
];

/** Estrae i valori di un ENUM dal COLUMN_TYPE di information_schema. */
function enumValues(PDO $db, string $table, string $column): ?array
{
    $stmt = $db->prepare(
        'SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c'
    );
    $stmt->execute(['t' => $table, 'c' => $column]);
    $type = $stmt->fetchColumn();
    if ($type === false || stripos($type, 'enum(') !== 0) {
        return null;
    }
    preg_match_all("/'((?:[^']|'')*)'/", $type, $m);
    return array_map(static fn ($v) => str_replace("''", "'", $v), $m[1]);
}

/**
 * Estrae i valori da `const NOME = ['a','b'];` in un file PHP.
 *
 * Alcune whitelist sono mappe chiave => etichetta (LEAD_SOURCE_LABELS): li' i
 * valori dell'enum sono le CHIAVI, e raccogliere ogni stringa fra apici
 * conterebbe anche le etichette, segnalando una divergenza inventata.
 */
function constValues(string $file, string $const): ?array
{
    $src = @file_get_contents(dirname(__DIR__) . '/' . $file);
    if ($src === false) {
        return null;
    }
    if (!preg_match('/const\s+' . preg_quote($const, '/') . '\s*=\s*\[(.*?)\]\s*;/s', $src, $m)) {
        return null;
    }
    if (str_contains($m[1], '=>')) {
        preg_match_all("/'([^']*)'\s*=>/", $m[1], $q);
        return $q[1];
    }
    preg_match_all("/'([^']*)'/", $m[1], $q);
    return $q[1];
}

$db     = getDB();
$issues = 0;

printf("%-42s %-30s %s\n", 'COLONNA vs COSTANTE', 'SOLO NEL DB', 'SOLO NEL PHP');
echo str_repeat('-', 100), "\n";

foreach (CHECKS as [$table, $column, $file, $const]) {
    $label  = "$table.$column vs $const";
    $dbVals = enumValues($db, $table, $column);
    if ($dbVals === null) {
        printf("%-42s %s\n", $label, '(colonna assente o non ENUM — salto)');
        continue;
    }
    $phpVals = constValues($file, $const);
    if ($phpVals === null) {
        printf("%-42s %s\n", $label, "(costante $const non trovata in $file — salto)");
        continue;
    }

    $onlyDb  = array_values(array_diff($dbVals, $phpVals));
    $onlyPhp = array_values(array_diff($phpVals, $dbVals));

    if ($onlyDb || $onlyPhp) {
        $issues++;
    }
    printf(
        "%-42s %-30s %s\n",
        $label,
        $onlyDb ? implode(',', $onlyDb) : '-',
        $onlyPhp ? implode(',', $onlyPhp) : '-'
    );
}

echo str_repeat('-', 100), "\n";
if ($issues === 0) {
    echo "OK — nessuna divergenza.\n";
    exit(0);
}
// "SOLO NEL PHP" e' la direzione che rompe un salvataggio, e va guardata per prima.
echo "DIVERGENZE: $issues. 'Solo nel PHP' = il salvataggio fallisce con un errore",
     " di database; 'solo nel DB' = un valore esistente non e' piu' reinseribile.\n";
exit(1);
