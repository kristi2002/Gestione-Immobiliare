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

/**
 * [tabella, colonna, file php, nome della costante]
 *
 * Una colonna puo' comparire PIU' VOLTE, con costanti diverse: e' voluto. Le
 * liste duplicate sono il caso peggiore, non il piu' innocuo — `appointments.
 * appointment_type` e' scritta sia in api/appointments.php sia in
 * tenant/lib/portal_data.php, e le due possono divergere fra loro anche restando
 * ognuna d'accordo col database. Controllarle entrambe contro la colonna e'
 * l'unico modo per accorgersene.
 */
const CHECKS = [
    // ── Anagrafiche e immobili ──────────────────────────────────────────────
    ['clients',            'status',          'api/clients.php',     'CLIENT_STATUSES'],
    ['tenants',            'status',          'api/clients.php',     'CLIENT_STATUSES'],
    ['properties',         'status',          'api/properties.php',  'PROPERTY_STATUSES'],
    ['properties',         'property_type',   'api/properties.php',  'PROPERTY_TYPE_VALUES'],
    ['omi_quotazioni',     'property_type',   'api/valuation.php',   'OMI_TYPES'],
    ['building_millesimi', 'table_type',      'api/buildings.php',   'MILLESIMI_TABLES'],
    ['property_media',     'media_type',      'api/property_media.php', 'MEDIA_TYPES'],
    ['property_appraisals','condition_rating','api/property_appraisals.php', 'APPRAISAL_RATINGS'],
    ['property_keys',      'status',          'api/property_keys.php', 'KEY_STATUSES'],

    // ── Contratti, soldi, fisco ─────────────────────────────────────────────
    ['contracts',          'contract_type',   'api/contracts.php',   'CONTRACT_TYPES'],
    ['contracts',          'status',          'api/contracts.php',   'CONTRACT_STATUSES'],
    ['payments',           'method',          'api/payments.php',    'PAYMENT_METHODS'],
    ['payments',           'status',          'api/payments.php',    'PAYMENT_STATUSES'],
    ['payments',           'status',          'tenant/lib/portal_data.php', 'TENANT_PAY_STATUS'],
    ['invoices',           'status',          'api/invoices.php',    'INVOICE_STATUSES'],
    ['expenses',           'category',        'api/expenses.php',    'EXPENSE_CATEGORIES'],
    ['agent_commissions',  'status',          'api/commissions.php', 'COMMISSION_STATUSES'],
    ['agent_commissions',  'commission_type', 'api/commissions.php', 'COMMISSION_TYPES'],
    ['agent_commissions',  'agent_role',      'api/commissions.php', 'COMMISSION_AGENT_ROLES'],
    ['sdd_collections',    'seq_type',        'lib/sepa_sdd.php',    'SEPA_SEQ_TYPES'],

    // ── Trattativa ──────────────────────────────────────────────────────────
    ['leads',              'source',          'config/lead_sources.php', 'LEAD_SOURCE_LABELS'],
    ['leads',              'status',          'api/leads.php',       'LEAD_STATUSES'],
    ['leads',              'interest_type',   'api/leads.php',       'LEAD_INTERESTS'],
    ['leads',              'preferred_type',  'api/leads.php',       'LEAD_PROP_TYPES'],
    ['property_applications', 'application_type', 'api/property_applications.php', 'APP_TYPES'],
    ['property_applications', 'status',        'api/property_applications.php', 'APP_STATUSES'],

    // ── Agenda e promemoria ─────────────────────────────────────────────────
    ['appointments',       'appointment_type','api/appointments.php', 'APPOINTMENT_TYPES'],
    ['appointments',       'appointment_type','tenant/lib/portal_data.php', 'TENANT_APPT_TYPES'],
    ['appointments',       'location_type',   'api/appointments.php', 'APPOINTMENT_LOCATION_TYPES'],
    ['appointments',       'location_type',   'tenant/lib/portal_data.php', 'TENANT_APPT_PLACES'],
    ['appointments',       'status',          'api/appointments.php', 'APPOINTMENT_STATUSES'],
    ['appointment_requests', 'appointment_type', 'api/appointment_request.php', 'APPT_TYPES'],
    ['appointment_requests', 'preferred_time',   'api/appointment_request.php', 'APPT_TIMES'],
    ['reminders',          'status',          'api/reminders.php',   'REMINDER_STATUSES'],
    ['reminders',          'frequency',       'config/reminders.php','REMINDER_FREQUENCIES'],
    ['reminders',          'maintenance_status', 'api/reminders.php', 'REMINDER_MAINTENANCE_STATUSES'],
    ['reminders',          'maintenance_status', 'tenant/lib/portal_data.php', 'TENANT_REQUEST_PROGRESS'],

    // ── Contatori e inventario ──────────────────────────────────────────────
    ['meters',             'meter_type',      'api/meters.php',      'METER_TYPES'],
    ['meter_readings',     'meter_type',      'api/meter_readings.php', 'METER_TYPES'],
    ['meter_readings',     'meter_type',      'tenant/lib/portal_data.php', 'TENANT_METER_TYPES'],
    ['inventory_snapshots','phase',           'config/inventory_snapshots.php', 'INVENTORY_SNAPSHOT_PHASES'],

    // ── Documenti, comunicazioni, portali ───────────────────────────────────
    ['documents',          'doc_type',        'api/documents.php',   'DOC_TYPES'],
    ['communications',     'direction',       'api/communications.php', 'COMM_DIRECTIONS'],
    ['whatsapp_templates', 'category',        'api/whatsapp_templates.php', 'WA_TEMPLATE_CATEGORIES'],
    ['whatsapp_templates', 'meta_status',     'api/whatsapp_templates.php', 'WA_TEMPLATE_META_STATUSES'],
    ['social_posts',       'platform',        'config/meta.php',     'SOCIAL_PLATFORMS'],
    ['portal_listings',    'portal',          'api/portal_sync.php', 'PORTALS'],
    ['portal_listings',    'status',          'api/portal_sync.php', 'PORTAL_STATUSES'],
    ['portal_field_map',   'portal',          'api/portal_sync.php', 'PORTALS'],

    // ── Fornitori, assicurazioni, antiriciclaggio ───────────────────────────
    ['suppliers',          'category',        'api/suppliers.php',   'SUPPLIER_CATEGORIES'],
    ['property_insurance', 'policy_type',     'api/insurance.php',   'INSURANCE_TYPES'],
    ['aml_records',        'subject_type',    'api/aml.php',         'AML_SUBJECT_TYPES'],
    ['aml_records',        'verification_type','api/aml.php',        'AML_VERIFICATION'],
    ['aml_records',        'risk_level',      'api/aml.php',         'AML_RISK'],
    ['aml_records',        'operation_type',  'api/aml.php',         'AML_OPERATIONS'],
    ['aml_records',        'status',          'api/aml.php',         'AML_STATUSES'],

    // ── Accessi e tracciamento ──────────────────────────────────────────────
    ['admin_users',        'role',            'config/roles.php',    'ADMIN_ROLES'],
    ['activity_log',       'action',          'api/activity_log.php','LOG_ACTIONS'],
    ['consent_records',    'subject_type',    'config/consent.php',  'CONSENT_SUBJECT_TYPES'],
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

$db      = getDB();
$issues  = 0;
$skipped = 0;

printf("%-42s %-30s %s\n", 'COLONNA vs COSTANTE', 'SOLO NEL DB', 'SOLO NEL PHP');
echo str_repeat('-', 100), "\n";

foreach (CHECKS as [$table, $column, $file, $const]) {
    $label  = "$table.$column vs $const";
    $dbVals = enumValues($db, $table, $column);
    if ($dbVals === null) {
        printf("%-42s %s\n", $label, 'NON VERIFICATO: colonna assente o non ENUM');
        $skipped++;
        continue;
    }
    $phpVals = constValues($file, $const);
    if ($phpVals === null) {
        printf("%-42s %s\n", $label, "NON VERIFICATO: costante $const non trovata in $file");
        $skipped++;
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

// Un controllo SALTATO non e' un controllo passato.
//
// Prima questo script contava solo le divergenze: un check che non trovava la
// costante stampava "salto" e usciva 0, cioe' la riga "OK — nessuna divergenza"
// veniva stampata da un controllo che non aveva verificato niente. E' successo
// davvero — `payments.method` cercava una costante PAYMENT_METHODS che non
// esisteva (la whitelist era un array dentro createPayment()), quindi l'ENUM
// piu' vicino ai soldi non e' stato confrontato per mesi mentre CI diceva verde.
//
// E' lo stesso difetto di api/readiness.php che dava "ok" perche' la stringa non
// era vuota: una sonda che non sa distinguere "verificato e a posto" da "non
// verificato" mente nella direzione peggiore. Da qui in poi un salto fa fallire.
if ($issues === 0 && $skipped === 0) {
    echo "OK — ", count(CHECKS), " controlli eseguiti, nessuna divergenza.\n";
    exit(0);
}

if ($skipped > 0) {
    echo "NON VERIFICATI: $skipped controlli su ", count(CHECKS), ". Un controllo che non gira",
         " non e' un controllo che passa: correggi il nome della costante o del file in CHECKS.\n";
}
if ($issues > 0) {
    // "SOLO NEL PHP" e' la direzione che rompe un salvataggio, e va guardata per prima.
    echo "DIVERGENZE: $issues. 'Solo nel PHP' = il salvataggio fallisce con un errore",
         " di database; 'solo nel DB' = un valore esistente non e' piu' reinseribile.\n";
}
exit(1);
