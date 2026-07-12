<?php
/**
 * Compliance-rich demo seed (Monday presentation).
 *
 * Populates a coherent agency dataset with the NEW fiscal/compliance fields and
 * dates RELATIVE TO TODAY, so the Scadenzario, the dashboard compliance widget,
 * the valuation engine, reverse Magic Match, AML and FatturaPA status all look
 * alive during a demo. Idempotent-ish: it clears the demo tables first.
 *
 * Run inside the app container:
 *   php database/seeds/seed_demo_compliance.php
 *
 * Admin created/reset: admin / DemoOrlandi2026
 */

require_once __DIR__ . '/../../config/env.php';
loadEnv(__DIR__ . '/../../.env');

// SAFETY: this seed TRUNCATEs demo tables. Never let it wipe a production DB by
// accident — require an explicit --force in production.
if (strtolower((string) (getenv('APP_ENV') ?: 'local')) === 'production' && !in_array('--force', $argv, true)) {
    fwrite(STDERR, "RIFIUTATO: APP_ENV=production. Questo seed cancella i dati demo. Usa --force solo se sei certo.\n");
    exit(1);
}

$host = getenv('DB_HOST') ?: 'db';
$db   = new PDO("mysql:host=$host;dbname=gestione_immobiliare;charset=utf8mb4", 'root', 'root', [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$T = new DateTimeImmutable('today');
$d = fn(int $days) => $T->modify(($days >= 0 ? '+' : '') . $days . ' days')->format('Y-m-d');
$report = [];
function section(string $name, callable $fn, array &$report, PDO $db): void {
    try { $n = $fn(); $report[] = "  ✓ $name: $n"; }
    catch (Throwable $e) { $report[] = "  ✗ $name: " . $e->getMessage(); }
}

// --- clean demo tables (children first) --------------------------------------
$db->exec('SET FOREIGN_KEY_CHECKS = 0');
foreach ([
    'fattura_transmissions','payments','contracts','property_insurance','aml_records',
    'omi_quotazioni','portal_listings','leads','invoices','reminders','tenants','properties','clients',
] as $t) {
    try { $db->exec("TRUNCATE TABLE `$t`"); } catch (Throwable $e) {}
}
$db->exec('SET FOREIGN_KEY_CHECKS = 1');

// --- admin -------------------------------------------------------------------
section('admin', function () use ($db) {
    $hash = password_hash('DemoOrlandi2026', PASSWORD_DEFAULT);
    $db->prepare("INSERT INTO admin_users (username, password_hash, role, email, is_active)
                  VALUES ('admin', :h, 'super_admin', 'admin@orlandi.it', 1)
                  ON DUPLICATE KEY UPDATE password_hash = :h2, is_active = 1")
       ->execute(['h' => $hash, 'h2' => $hash]);
    return 1;
}, $report, $db);

// --- proprietari -------------------------------------------------------------
$clientIds = [];
section('clients', function () use ($db, &$clientIds) {
    $rows = [
        ['Roberto','Esposito','SPSRRT65A01F205X','335 1112221','r.esposito@example.it','Milano'],
        ['Francesca','Ricci','RCCFNC72M41D612Y','333 2223332','f.ricci@example.it','Firenze'],
        ['Antonio','Mancini','MNCNTN58H12H501Z','347 3334443','a.mancini@example.it','Roma'],
        ['Elena','Colombo','CLMLNE80D55L219W','340 4445554','e.colombo@example.it','Torino'],
        ['Giulia','Orlandi','RLNGLI85T60C770K','338 5556665','g.orlandi@example.it','Civitanova Marche'],
    ];
    $st = $db->prepare("INSERT INTO clients (name,surname,codice_fiscale,phone,email,status)
                        VALUES (?,?,?,?,?, 'active')");
    foreach ($rows as $r) { $st->execute(array_slice($r, 0, 5)); $GLOBALS['clientIds'][$r[5]] = (int) $db->lastInsertId(); }
    return count($rows);
}, $report, $db);
$clientIds = $GLOBALS['clientIds'];

// --- immobili (with catasto + APE relative dates) ----------------------------
$propIds = [];
section('properties', function () use ($db, $d, $clientIds, &$propIds) {
    // [city, cid, addr, cap, prov, type, price, price_type, sqm, rooms, status, energy, zone, cat, foglio, part, rendita, apeExpiryDays]
    $rows = [
        ['Milano',            'Milano','Via Dante 12','20121','MI','appartamento',420000,'vendita',110,4,'available','C','B2','A/2','45','120',980.50,  +15],
        ['Milano',            'Milano','Corso Buenos Aires 88','20124','MI','appartamento',1350,'affitto',75,3,'rented','D','C1','A/3','52','233',640.00, -30],
        ['Firenze',           'Firenze','Borgo San Frediano 5','50124','FI','appartamento',390000,'vendita',95,4,'available','E','B1','A/2','30','88',1120.00, +300],
        ['Roma',              'Roma','Via Nazionale 200','00184','RM','ufficio',2200,'affitto',140,5,'rented','F','D2','A/10','101','450',1850.00, +8],
        ['Roma',              'Roma','Viale Marconi 15','00146','RM','appartamento',285000,'vendita',80,3,'sold','C','C2','A/3','77','610',720.00, +120],
        ['Torino',            'Torino','Via Po 30','10124','TO','negozio',1600,'affitto',120,2,'rented','G','C1','C/1','19','204',990.00, -5],
        ['Civitanova Marche', 'Civitanova Marche','Via Roma 10','62012','MC','appartamento',180000,'vendita',95,4,'available','D','B1','A/2','12','345',560.00, +45],
        ['Civitanova Marche', 'Civitanova Marche','Lungomare Sud 88','62012','MC','villa',650000,'vendita',210,7,'available','B','B1','A/7','8','19',2100.00, +600],
    ];
    $cityCoords = [
        'Milano'            => [45.4642, 9.1900],
        'Firenze'           => [43.7696, 11.2558],
        'Roma'              => [41.9028, 12.4964],
        'Torino'            => [45.0703, 7.6869],
        'Civitanova Marche' => [43.3076, 13.7228],
    ];
    $st = $db->prepare("INSERT INTO properties
        (client_id,address,city,cap,province,property_type,price,price_type,sqm,rooms,bathrooms,status,
         energy_class,cadastral_comune,cadastral_zone,cadastral_category,cadastral_foglio,cadastral_particella,
         cadastral_rendita,ape_number,ape_issue_date,ape_expiry_date,ipe_value,latitude,longitude,geo_confidence)
        VALUES (?,?,?,?,?,?,?,?,?,?,2,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'street')");
    $i = 0;
    foreach ($rows as $r) {
        $cid = $clientIds[$r[1]] ?? array_values($clientIds)[0];
        $apeExpiry = $d($r[17]);
        $apeIssue  = (new DateTimeImmutable($apeExpiry))->modify('-10 years')->format('Y-m-d');
        $base = $cityCoords[$r[0]] ?? [43.3076, 13.7228];
        // Spread pins so same-city properties don't overlap.
        $lat = $base[0] + (($i % 3) - 1) * 0.004 + $i * 0.0006;
        $lng = $base[1] + ((($i + 1) % 3) - 1) * 0.005;
        $st->execute([
            $cid, $r[2], $r[0], $r[3], $r[4], $r[5], $r[6], $r[7], $r[8], $r[9], $r[10],
            $r[11], $r[0], $r[12], $r[13], $r[14], $r[15], $r[16],
            'APE-' . (2016 + ($i % 8)) . '-' . str_pad((string)(100 + $i), 4, '0', STR_PAD_LEFT),
            $apeIssue, $apeExpiry, 40 + $i * 12,
            round($lat, 6), round($lng, 6),
        ]);
        $GLOBALS['propIds'][] = (int) $db->lastInsertId();
        $i++;
    }
    return count($rows);
}, $report, $db);
$propIds = $GLOBALS['propIds'];

// --- inquilini (with SEPA mandate) -------------------------------------------
$tenantIds = [];
section('tenants', function () use ($db, $d, &$tenantIds) {
    $rows = [
        ['Alessandro','Gatti','a.gatti@example.it','339 7778887','IT28W8000000292100645211151','UMR-0001', -300],
        ['Valentina','Moretti','v.moretti@example.it','334 6665556','IT60X0542811101000000123456','UMR-0002', -120],
        ['Carlo','Ferretti','c.ferretti@example.it','347 1231231','IT40S0542811101000000999888','UMR-0003', -60],
    ];
    $st = $db->prepare("INSERT INTO tenants (name,surname,email,phone,status,iban,sdd_mandate_ref,sdd_mandate_date)
                        VALUES (?,?,?,?, 'active', ?,?,?)");
    foreach ($rows as $r) { $st->execute([$r[0],$r[1],$r[2],$r[3],$r[4],$r[5],$d($r[6])]); $GLOBALS['tenantIds'][] = (int) $db->lastInsertId(); }
    return count($rows);
}, $report, $db);
$tenantIds = $GLOBALS['tenantIds'];

// --- contratti (registration + cedolare + ISTAT, varied expiries) ------------
$contractIds = [];
section('contracts', function () use ($db, $d, $propIds, $tenantIds, $clientIds, &$contractIds) {
    // [propIdx, tenantIdx, subtype, endDays, cedolare, registroDueDays, rent, istatIndex]
    $rows = [
        [1, 0, '4+4',        +20,  0, -5,   1350, 118.2],  // rented Milano — expiring soon, imposta overdue
        [3, 1, 'commerciale',+200, 1, +150, 2200, 119.6],  // Roma ufficio — cedolare, upcoming
        [5, 2, '3+2',        -10,  0, +40,  1600, 117.0],  // Torino negozio — expired
    ];
    $st = $db->prepare("INSERT INTO contracts
        (property_id,tenant_id,client_id,title,contract_type,contract_subtype,status,start_date,end_date,
         monthly_rent,deposit,registration_number,registration_date,registration_office,cedolare_secca,
         registration_tax_annual,stamp_duty,imposta_registro_due_date,istat_update_enabled,istat_baseline_index,istat_baseline_month)
        VALUES (?,?,?,?, 'locazione', ?, 'signed', ?, ?, ?, ?, ?, ?, 'Agenzia Entrate', ?, ?, 16.00, ?, 1, ?, ?)");
    $i = 0;
    foreach ($rows as $r) {
        $pid = $propIds[$r[0]]; $tid = $tenantIds[$r[1]];
        $cidRow = $db->query("SELECT client_id FROM properties WHERE id = $pid")->fetchColumn();
        $start = (new DateTimeImmutable($d($r[3])))->modify('-4 years')->format('Y-m-d');
        $regTax = $r[4] ? null : round($r[6] * 12 * 0.02, 2); // 2% imposta registro if not cedolare
        $st->execute([
            $pid, $tid, $cidRow, 'Contratto locazione ' . ($i + 1), $r[2], $start, $d($r[3]),
            $r[6], $r[6] * 2, 'RV' . (2021 + $i) . '/' . str_pad((string)(1000 + $i), 4, '0', STR_PAD_LEFT),
            $start, $r[4], $regTax, $d($r[5]), $r[7], substr($start, 0, 7),
        ]);
        $GLOBALS['contractIds'][] = (int) $db->lastInsertId();
        $i++;
    }
    return count($rows);
}, $report, $db);
$contractIds = $GLOBALS['contractIds'];

// --- pagamenti (paid / pending / late, with methods) -------------------------
section('payments', function () use ($db, $d, $propIds, $tenantIds, $contractIds) {
    $st = $db->prepare("INSERT INTO payments (tenant_id,property_id,contract_id,amount,due_date,paid_date,status,method)
                        VALUES (?,?,?,?,?,?,?,?)");
    $n = 0;
    // 6 months of history for contract 0 (tenant 0, prop 1): mostly paid, last pending
    for ($m = -5; $m <= 1; $m++) {
        $status = $m <= -1 ? 'paid' : ($m === 0 ? 'pending' : 'pending');
        $paid   = $status === 'paid' ? $d($m * 30 + 2) : null;
        $st->execute([$tenantIds[0], $propIds[1], $contractIds[0], 1350, $d($m * 30), $paid, $status, 'sdd']);
        $n++;
    }
    // one late payment for tenant 2 / Torino
    $st->execute([$tenantIds[2], $propIds[5], $contractIds[2], 1600, $d(-20), null, 'late', 'bonifico']); $n++;
    // one paid for tenant 1 / Roma
    $st->execute([$tenantIds[1], $propIds[3], $contractIds[1], 2200, $d(-8), $d(-6), 'paid', 'bonifico']); $n++;
    return $n;
}, $report, $db);

// --- leads (for reverse Magic Match) -----------------------------------------
section('leads', function () use ($db) {
    $rows = [
        ['Marco','Bianchi','acquisto',380000,450000,'Milano','appartamento',3,90,'interested'],
        ['Sara','Verdi','acquisto',150000,200000,'Civitanova Marche','appartamento',3,80,'negotiating'],
        ['Luca','Rossi','affitto',1000,1500,'Milano','appartamento',2,60,'contacted'],
        ['Paola','Neri','acquisto',600000,750000,'Civitanova Marche','villa',5,180,'new'],
        ['Davide','Gallo','affitto',1500,2500,'Roma','ufficio',4,120,'interested'],
        ['Chiara','Fontana','acquisto',350000,420000,'Firenze','appartamento',3,90,'new'],
    ];
    $st = $db->prepare("INSERT INTO leads (name,surname,phone,email,interest_type,budget_min,budget_max,
                        preferred_city,preferred_type,min_rooms,min_sqm,status,source)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'web')");
    foreach ($rows as $r) {
        $st->execute([$r[0],$r[1],'34'.rand(00000000,99999999),strtolower($r[0].'.'.$r[1]).'@example.it',
                      $r[2],$r[3],$r[4],$r[5],$r[6],$r[7],$r[8],$r[9]]);
    }
    return count($rows);
}, $report, $db);

// --- assicurazioni (varied expiries) -----------------------------------------
section('insurance', function () use ($db, $d, $propIds) {
    $rows = [
        [0,'Generali','POL-1001','globale_fabbricato',420, +12],  // soon
        [3,'UnipolSai','POL-1002','incendio',680, +45],           // upcoming
        [6,'Allianz','POL-1003','responsabilita',310, -3],        // overdue
    ];
    $st = $db->prepare("INSERT INTO property_insurance
        (property_id,client_id,insurer_name,policy_number,policy_type,premium_annual,start_date,end_date)
        VALUES (?,?,?,?,?,?,?,?)");
    foreach ($rows as $r) {
        $pid = $propIds[$r[0]];
        $cid = $db->query("SELECT client_id FROM properties WHERE id = $pid")->fetchColumn();
        $st->execute([$pid,$cid,$r[1],$r[2],$r[3],$r[4], $d($r[5]-365), $d($r[5])]);
    }
    return count($rows);
}, $report, $db);

// --- antiriciclaggio ---------------------------------------------------------
section('aml', function () use ($db, $d) {
    $c1 = $db->query("SELECT id FROM clients ORDER BY id LIMIT 1")->fetchColumn();
    $rows = [
        ['Roberto Esposito','persona_fisica','SPSRRT65A01F205X','ordinaria','basso','vendita',420000,-30,'completata',+3650],
        ['Immobiliare Adriatica Srl','persona_giuridica',null,'rafforzata','alto','mediazione',650000,-5,'da_completare',+60],
        ['Antonio Mancini','persona_fisica','MNCNTN58H12H501Z','ordinaria','medio','locazione',26400,-90,'completata',+3650],
    ];
    $st = $db->prepare("INSERT INTO aml_records
        (subject_name,subject_type,codice_fiscale,client_id,verification_type,risk_level,operation_type,
         operation_value,verification_date,retention_until,status,is_pep)
        VALUES (?,?,?,?,?,?,?,?,?,?,?, 0)");
    foreach ($rows as $r) {
        $st->execute([$r[0],$r[1],$r[2],$c1,$r[3],$r[4],$r[5],$r[6],$d($r[7]),$d($r[9]),$r[8]]);
    }
    return count($rows);
}, $report, $db);

// --- quotazioni OMI (for valuation) ------------------------------------------
section('omi', function () use ($db) {
    $rows = [
        ['Milano','B2','appartamento',3600,4800,14,20],
        ['Milano','C1','appartamento',2800,3600,11,16],
        ['Firenze','B1','appartamento',3200,4200,13,18],
        ['Roma','D2','ufficio',2600,3400,12,17],
        ['Torino','C1','negozio',1400,2200,8,13],
        ['Civitanova Marche','B1','appartamento',1600,2100,7,10],
        ['Civitanova Marche','B1','villa',1800,2500,8,12],
    ];
    $st = $db->prepare("INSERT INTO omi_quotazioni (comune,cadastral_zone,property_type,price_min_sqm,price_max_sqm,rent_min_sqm,rent_max_sqm,period)
                        VALUES (?,?,?,?,?,?,?, '2026-S1')");
    foreach ($rows as $r) { $st->execute($r); }
    return count($rows);
}, $report, $db);

// --- fatture + una trasmissione FE -------------------------------------------
section('invoices+fe', function () use ($db, $d) {
    $cid = $db->query("SELECT id FROM clients ORDER BY id LIMIT 1")->fetchColumn();
    $st = $db->prepare("INSERT INTO invoices (invoice_number,client_id,description,amount,vat_rate,status,issue_date,due_date)
                        VALUES (?,?,?,?,22,?,?,?)");
    $st->execute(['FAT-2026-0001',$cid,'Provvigione mediazione vendita',8400,'paid',$d(-40),$d(-10)]);
    $inv1 = (int) $db->lastInsertId();
    $st->execute(['FAT-2026-0002',$cid,'Gestione locazione — trimestre',900,'sent',$d(-8),$d(+22)]);

    $db->prepare("INSERT INTO fattura_transmissions
        (invoice_id,status,progressivo,xml_filename,xml_path,channel,sdi_identificativo,receipt_type,delivered_at,sent_at)
        VALUES (?, 'consegnato', ?, ?, ?, 'manuale', ?, 'RC', NOW(), NOW())")
       ->execute([$inv1, (string)$inv1, 'IT01234567890_' . str_pad((string)$inv1,5,'0',STR_PAD_LEFT) . '.xml',
                  'uploads/documents/fatture/demo.xml', '3600' . $inv1]);
    return 2;
}, $report, $db);

// --- pubblicazioni portali ---------------------------------------------------
section('portal_listings', function () use ($db, $propIds) {
    $st = $db->prepare("INSERT INTO portal_listings (property_id,portal,status,external_id,last_synced_at)
                        VALUES (?,?,?,?, NOW())");
    $st->execute([$propIds[0],'immobiliare','published','IMM-88231']);
    $st->execute([$propIds[0],'idealista','published','IDE-55012']);
    $st->execute([$propIds[2],'immobiliare','error','']);
    $st->execute([$propIds[6],'sito_agenzia','published','']);
    return 4;
}, $report, $db);

// --- promemoria (dashboard "Prossimi promemoria" + KPI) ----------------------
section('reminders', function () use ($db, $d, $propIds, $clientIds) {
    $c = array_values($clientIds);
    $rows = [
        ['Rinnovo contratto locazione Milano','monthly', +3,  $c[0], $propIds[1]],
        ['Sopralluogo immobile Firenze','once',            +6,  $c[1], $propIds[2]],
        ['Rinnovo polizza incendio Roma','yearly',         +14, $c[2], $propIds[3]],
        ['Verifica caldaia Torino','once',                 +25, $c[3], $propIds[5]],
        ['Sollecito documenti proprietario','once',        -2,  $c[0], null],
    ];
    $st = $db->prepare("INSERT INTO reminders (title,frequency,reminder_date,status,client_id,property_id,notify_admin)
                        VALUES (?,?,?, 'pending', ?,?, 1)");
    foreach ($rows as $r) { $st->execute([$r[0],$r[1],$d($r[2]),$r[3],$r[4]]); }
    return count($rows);
}, $report, $db);

echo "Demo seed completed (base date " . $T->format('Y-m-d') . "):\n" . implode("\n", $report) . "\n";
