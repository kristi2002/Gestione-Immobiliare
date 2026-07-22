#!/usr/bin/env php
<?php
/**
 * Demo data seeder — populates the platform with realistic volume for UI testing.
 *
 * Usage (inside Docker app container):
 *   php scripts/seed_demo.php --fresh
 *   php scripts/seed_demo.php --fresh --scale=2
 *
 * From host (PowerShell):
 *   .\scripts\seed-demo.ps1
 *   .\scripts\seed-demo.ps1 -Fresh -Scale 2
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "Run from CLI only.\n");
    exit(1);
}

require_once dirname(__DIR__) . '/config/db.php';

$opts  = getopt('', ['fresh', 'scale::', 'help']);
$scale = max(1, min(5, (int) ($opts['scale'] ?? 1)));

if (isset($opts['help'])) {
    echo "Usage: php scripts/seed_demo.php [--fresh] [--scale=1..5]\n";
    echo "  --fresh   Clear business data before seeding (keeps admin users & settings)\n";
    echo "  --scale   Volume multiplier (default 1)\n";
    exit(0);
}

$db = getDB();
$db->exec('SET NAMES utf8mb4');

function say(string $msg): void
{
    echo $msg . PHP_EOL;
}

function pick(array $items): mixed
{
    return $items[array_rand($items)];
}

function randDate(int $daysBack, int $daysForward = 0): string
{
    $offset = random_int(-$daysBack, $daysForward);
    return (new DateTimeImmutable('today'))->modify("$offset days")->format('Y-m-d');
}

function randDateTime(int $daysBack, int $daysForward = 0): string
{
    $d = randDate($daysBack, $daysForward);
    return $d . sprintf(' %02d:%02d:00', random_int(8, 18), pick([0, 15, 30, 45]));
}

function tableExists(PDO $db, string $table): bool
{
    $stmt = $db->prepare(
        'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :t LIMIT 1'
    );
    $stmt->execute(['t' => $table]);
    return (bool) $stmt->fetchColumn();
}

function truncateBusinessData(PDO $db): void
{
    $tables = [
        'stripe_payments', 'payment_reminder_log', 'esign_requests',
        'whatsapp_messages', 'property_applications', 'agent_commissions',
        'tenant_surveys', 'property_inventory',
        'meter_readings', 'property_insurance', 'property_price_history',
        'property_keys', 'lead_property_matches', 'property_appraisals',
        'invoices', 'activity_log', 'expenses', 'payments', 'contracts',
        'appointments', 'leads', 'communications', 'reminders',
        'pdf_documents', 'documents', 'property_media',
        'tenant_users', 'tenants', 'properties', 'clients',
        'social_posts', 'suppliers', 'buildings',
    ];

    $db->exec('SET FOREIGN_KEY_CHECKS = 0');
    foreach ($tables as $table) {
        if (tableExists($db, $table)) {
            $db->exec("TRUNCATE TABLE `$table`");
            say("  cleared $table");
        }
    }
    $db->exec('SET FOREIGN_KEY_CHECKS = 1');
}

// ── Italian demo data pools ─────────────────────────────────────────────────

$firstNames = ['Marco', 'Giulia', 'Luca', 'Francesca', 'Andrea', 'Sara', 'Paolo', 'Elena', 'Matteo', 'Chiara', 'Davide', 'Valentina', 'Simone', 'Martina', 'Alessandro', 'Federica', 'Roberto', 'Laura', 'Stefano', 'Anna'];
$lastNames  = ['Rossi', 'Bianchi', 'Ferrari', 'Russo', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Conti', 'Galli', 'Barbieri', 'Fontana', 'Moretti', 'Caruso', 'Ferrara', 'Rizzo', 'Lombardi', 'Santini', 'Martini'];

$streets = ['Via Emilia', 'Via Giardini', 'Corso Canalchiaro', 'Via Mazzini', 'Via Farini', 'Viale Buon Pastore', 'Via San Carlo', 'Via Ganaceto', 'Via Taglio', 'Corso Vittorio Emanuele II', 'Via Castelfranco', 'Via del Taglio', 'Strada Sant\'Anna', 'Via Nonantolana', 'Via Stalingrado'];

$cities = [
    ['city' => 'Modena',      'cap' => '41121', 'province' => 'MO', 'lat' => 44.6471, 'lng' => 10.9252],
    ['city' => 'Modena',      'cap' => '41122', 'province' => 'MO', 'lat' => 44.6380, 'lng' => 10.9150],
    ['city' => 'Bologna',     'cap' => '40121', 'province' => 'BO', 'lat' => 44.4949, 'lng' => 11.3426],
    ['city' => 'Reggio Emilia','cap' => '42121', 'province' => 'RE', 'lat' => 44.6983, 'lng' => 10.6313],
    ['city' => 'Carpi',       'cap' => '41012', 'province' => 'MO', 'lat' => 44.7824, 'lng' => 10.8777],
    ['city' => 'Sassuolo',    'cap' => '41049', 'province' => 'MO', 'lat' => 44.5432, 'lng' => 10.7845],
];

$statuses = ['available', 'rented', 'sold', 'available', 'rented', 'available'];

say('=== Gestionale Immobiliare — demo seed (scale=' . $scale . ') ===');

if (isset($opts['fresh'])) {
    say('Clearing business data…');
    truncateBusinessData($db);
}

$adminId = (int) $db->query('SELECT id FROM admin_users ORDER BY id ASC LIMIT 1')->fetchColumn();
if ($adminId <= 0) {
    say('ERROR: No admin user found. Run setup.php first.');
    exit(1);
}

$nClients    = 30 * $scale;
$nProperties = 60 * $scale;
$nLeads      = 25 * $scale;
$nReminders  = 40 * $scale;
$nComms      = 35 * $scale;
$nAppts      = 30 * $scale;
$nExpenses   = 40 * $scale;
$nInvoices   = 20 * $scale;
$nSuppliers  = 12 * $scale;
$nBuildings  = 6 * $scale;
$nWaMsgs     = 30 * $scale;
$nApps       = 18 * $scale;
$nSocial     = 12 * $scale;
$nActivity   = 50 * $scale;
$nMaint      = 15 * $scale;

// ── Clients ─────────────────────────────────────────────────────────────────

// Agents an owner can be assigned to (Agente Ref.) — active admin/agent users.
$agentIds = $db->query(
    "SELECT id FROM admin_users
     WHERE is_active = 1 AND role IN ('super_admin','admin','agent')"
)->fetchAll(PDO::FETCH_COLUMN);
if (!$agentIds) {
    $agentIds = [$adminId];
}

say("Seeding $nClients clients…");
$clientIds = [];
$insClient = $db->prepare(
    'INSERT INTO clients (name, surname, phone, email, internal_notes, status, creation_date, assigned_agent_id)
     VALUES (:name, :surname, :phone, :email, :notes, :status, :created, :agent)'
);

for ($i = 1; $i <= $nClients; $i++) {
    $fn = pick($firstNames);
    $ln = pick($lastNames);
    $insClient->execute([
        'name'    => $fn,
        'surname' => $ln . ($i > 20 ? " $i" : ''),
        'phone'   => '+393' . random_int(10, 99) . random_int(1000000, 9999999),
        'email'   => strtolower($fn . '.' . $ln . $i . '@demo.test'),
        'notes'   => '[DEMO] Cliente di test generato automaticamente.',
        'status'  => pick(['active', 'active', 'active', 'inactive']),
        'created' => randDateTime(800, 0),
        // ~15% left unassigned so the "Non assegnato" state is visible too.
        'agent'   => random_int(1, 100) <= 85 ? pick($agentIds) : null,
    ]);
    $clientIds[] = (int) $db->lastInsertId();
}

// ── Properties ──────────────────────────────────────────────────────────────

say("Seeding $nProperties properties…");
$propertyIds = [];
$insProp = $db->prepare(
    'INSERT INTO properties
        (client_id, address, city, cap, province, sqm, rooms, bathrooms, floor,
         description, status, price, price_type, latitude, longitude, geo_confidence, internal_notes)
     VALUES
        (:cid, :addr, :city, :cap, :prov, :sqm, :rooms, :bath, :floor,
         :desc, :status, :price, :ptype, :lat, :lng, :geo, :notes)'
);

for ($i = 1; $i <= $nProperties; $i++) {
    $loc    = pick($cities);
    $status = pick($statuses);
    $ptype  = $status === 'sold' ? 'vendita' : pick(['affitto', 'affitto', 'vendita']);
    $sqm    = random_int(45, 220);
    $price  = $ptype === 'affitto'
        ? random_int(550, 1800)
        : random_int(120000, 480000);

    $insProp->execute([
        'cid'    => pick($clientIds),
        'addr'   => pick($streets) . ' ' . random_int(1, 180) . ($i % 7 === 0 ? ' — interno ' . random_int(1, 12) : ''),
        'city'   => $loc['city'],
        'cap'    => $loc['cap'],
        'prov'   => $loc['province'],
        'sqm'    => $sqm,
        'rooms'  => max(1, (int) round($sqm / 28)),
        'bath'   => random_int(1, 3),
        'floor'  => (string) random_int(0, 6),
        'desc'   => '[DEMO] Appartamento luminoso con ottimi finimenti. Zona servita da mezzi e negozi.',
        'status' => $status,
        'price'  => $price,
        'ptype'  => $ptype,
        'lat'    => $loc['lat'] + (random_int(-800, 800) / 100000),
        'lng'    => $loc['lng'] + (random_int(-800, 800) / 100000),
        'geo'    => pick(['exact', 'street', 'street', 'cap_area']),
        'notes'  => '[DEMO]',
    ]);
    $propertyIds[] = (int) $db->lastInsertId();
}

// ── Tenants (on rented properties) ──────────────────────────────────────────

say('Seeding tenants…');
$tenantIds = [];
// Tenants are just people — property/lease terms live on CONTRACTS, so we
// stash them here keyed by tenant id and write the contract rows further down.
$tenantLease = [];
$rentedProps = $db->query("SELECT id, price FROM properties WHERE status = 'rented' LIMIT " . (20 * $scale))->fetchAll(PDO::FETCH_ASSOC);
$insTenant = $db->prepare(
    'INSERT INTO tenants (name, surname, email, phone, notes, status)
     VALUES (:name, :surname, :email, :phone, :notes, :status)'
);

foreach ($rentedProps as $idx => $prop) {
    $fn = pick($firstNames);
    $ln = pick($lastNames);
    $start = randDate(600, -30);
    $end   = (new DateTimeImmutable($start))->modify('+3 years')->format('Y-m-d');
    // properties.price is a sale/listing figure; derive a realistic monthly rent.
    $price = (float) ($prop['price'] ?? 0);
    if ($price > 0 && $price <= 5000) {
        $rent = (int) round($price);                                  // already a monthly figure
    } elseif ($price > 5000) {
        $rent = max(450, min(3000, (int) round($price / 250 / 10) * 10)); // ~0.4% of sale price
    } else {
        $rent = random_int(600, 1200);
    }
    $insTenant->execute([
        'name'   => $fn,
        'surname'=> $ln,
        'email'  => strtolower("inquilino.$fn.$ln$idx@demo.test"),
        'phone'  => '+393' . random_int(20, 99) . random_int(1000000, 9999999),
        'notes'  => '[DEMO]',
        'status' => 'active',
    ]);
    $newTenantId = (int) $db->lastInsertId();
    $tenantIds[] = $newTenantId;
    $tenantLease[$newTenantId] = ['property_id' => $prop['id'], 'start' => $start, 'end' => $end, 'rent' => $rent];
}
say('  ' . count($tenantIds) . ' tenants');

// ── Leads ───────────────────────────────────────────────────────────────────

say("Seeding $nLeads leads…");
$leadIds = [];
$leadStatuses = ['new', 'contacted', 'interested', 'negotiating', 'converted', 'lost'];
$insLead = $db->prepare(
    'INSERT INTO leads (name, surname, phone, email, interest_type, budget_min, budget_max,
        preferred_city, preferred_type, min_rooms, status, source, assigned_to, notes)
     VALUES (:name, :surname, :phone, :email, :interest, :bmin, :bmax, :city, :ptype, :rooms, :status, :source, :agent, :notes)'
);

for ($i = 0; $i < $nLeads; $i++) {
    $fn = pick($firstNames);
    $ln = pick($lastNames);
    $insLead->execute([
        'name'     => $fn,
        'surname'  => $ln,
        'phone'    => '+393' . random_int(10, 99) . random_int(1000000, 9999999),
        'email'    => strtolower("$fn.$ln.lead$i@demo.test"),
        'interest' => pick(['affitto', 'acquisto', 'entrambi']),
        'bmin'     => random_int(400, 800),
        'bmax'     => random_int(900, 2500),
        'city'     => pick($cities)['city'],
        'ptype'    => pick(['appartamento', 'villa', 'ufficio', 'negozio']),
        'rooms'    => random_int(2, 5),
        'status'   => pick($leadStatuses),
        'source'   => pick(['telefono', 'email', 'web', 'social', 'passaparola']),
        'agent'    => $adminId,
        'notes'    => '[DEMO] Lead interessato a visitare immobili in zona centrale.',
    ]);
    $leadIds[] = (int) $db->lastInsertId();
}

if (tableExists($db, 'lead_property_matches') && $leadIds && $propertyIds) {
    $insMatch = $db->prepare('INSERT IGNORE INTO lead_property_matches (lead_id, property_id) VALUES (:l, :p)');
    for ($i = 0; $i < min(40, count($leadIds) * 2); $i++) {
        $insMatch->execute(['l' => pick($leadIds), 'p' => pick($propertyIds)]);
    }
}

// ── Reminders + maintenance ─────────────────────────────────────────────────

say("Seeding $nReminders reminders + $nMaint maintenance…");
$insRem = $db->prepare(
    'INSERT INTO reminders (title, description, reminder_date, frequency, status, client_id, property_id, notify_admin)
     VALUES (:title, :desc, :date, :freq, :status, :cid, :pid, 1)'
);

$remTitles = ['Visita immobile', 'Rinnovo contratto', 'Chiamata proprietario', 'Invio documenti', 'Scadenza assicurazione', 'Revisione caldaia', 'Aggiornamento annuncio'];
for ($i = 0; $i < $nReminders; $i++) {
    $insRem->execute([
        'title'  => pick($remTitles) . " #$i",
        'desc'   => '[DEMO] Promemoria automatico per test interfaccia.',
        'date'   => randDateTime(30, 90),
        'freq'   => pick(['once', 'monthly', 'weekly']),
        'status' => pick(['pending', 'pending', 'completed', 'cancelled']),
        'cid'    => pick($clientIds),
        'pid'    => pick($propertyIds),
    ]);
}

$maintTitles = ['Perdita rubinetto cucina', 'Caldaia non si accende', 'Infiltrazione soffitto', 'Serratura porta blindata', 'Interruttore bagno', 'Crepa muro salotto'];
$maintStatus = ['aperta', 'in_lavorazione', 'completata', 'chiusa'];
for ($i = 0; $i < $nMaint; $i++) {
    $title = pick($maintTitles);
    $insRem->execute([
        'title'  => "[Richiesta maintenance] $title",
        'desc'   => "[DEMO] Segnalazione inquilino: $title. Priorità: " . pick(['normale', 'alta', 'urgente']) . "\nStato workflow: " . pick($maintStatus),
        'date'   => randDateTime(60, 14),
        'freq'   => 'once',
        'status' => 'pending',
        'cid'    => pick($clientIds),
        'pid'    => pick($propertyIds),
    ]);
}

// ── Communications ──────────────────────────────────────────────────────────

say("Seeding $nComms communications…");
$insComm = $db->prepare(
    'INSERT INTO communications (client_id, direction, channel, subject, body, status, created_at)
     VALUES (:cid, :dir, :ch, :subj, :body, :status, :created)'
);

for ($i = 0; $i < $nComms; $i++) {
    $ch = pick(['email', 'email', 'whatsapp']);
    $insComm->execute([
        'cid'     => pick($clientIds),
        'dir'     => pick(['sent', 'received']),
        'ch'      => $ch,
        'subj'    => $ch === 'email' ? pick(['Conferma appuntamento', 'Documenti contratto', 'Aggiornamento locazione']) : 'WhatsApp: messaggio demo',
        'body'    => '[DEMO] Messaggio di prova per testare lo storico comunicazioni con testo sufficientemente lungo da verificare overflow e troncamento nelle liste.',
        'status'  => pick(['sent', 'delivered', 'received']),
        'created' => randDateTime(120, 0),
    ]);
}

// ── Appointments ────────────────────────────────────────────────────────────

say("Seeding $nAppts appointments…");
$insAppt = $db->prepare(
    'INSERT INTO appointments (property_id, lead_id, client_id, agent_id, appointment_date, duration_minutes, status, notes)
     VALUES (:pid, :lid, :cid, :agent, :date, :dur, :status, :notes)'
);

for ($i = 0; $i < $nAppts; $i++) {
    $insAppt->execute([
        'pid'    => pick($propertyIds),
        'lid'    => pick($leadIds) ?: null,
        'cid'    => pick($clientIds),
        'agent'  => $adminId,
        'date'   => randDateTime(45, 60),
        'dur'    => pick([30, 45, 60, 90]),
        'status' => pick(['scheduled', 'scheduled', 'completed', 'cancelled', 'no_show']),
        'notes'  => '[DEMO] Visita immobile con potenziale acquirente/affittuario.',
    ]);
}

// ── Contracts & payments ────────────────────────────────────────────────────

if (tableExists($db, 'contracts')) {
    say('Seeding contracts…');
    $insContract = $db->prepare(
        'INSERT INTO contracts (property_id, tenant_id, client_id, title, contract_type, status, start_date, end_date, monthly_rent, deposit, created_by)
         VALUES (:pid, :tid, :cid, :title, :type, :status, :start, :end, :rent, :dep, :by)'
    );
    $contractIds = [];
    foreach (array_slice($tenantIds, 0, min(15 * $scale, count($tenantIds))) as $tid) {
        $lease = $tenantLease[$tid] ?? null;
        if (!$lease) continue;
        $prop = $db->prepare('SELECT client_id FROM properties WHERE id = :id');
        $prop->execute(['id' => $lease['property_id']]);
        $cid = $prop->fetchColumn();
        $start = randDate(400, -60);
        $insContract->execute([
            'pid'    => $lease['property_id'],
            'tid'    => $tid,
            'cid'    => $cid,
            'title'  => 'Contratto locazione demo',
            'type'   => 'locazione',
            'status' => pick(['draft', 'sent', 'signed', 'signed', 'expired']),
            'start'  => $start,
            'end'    => (new DateTimeImmutable($start))->modify('+3 years')->format('Y-m-d'),
            'rent'   => $lease['rent'],
            'dep'    => ($lease['rent'] ?? 800) * 3,
            'by'     => $adminId,
        ]);
        $contractIds[] = (int) $db->lastInsertId();
    }
    say('  ' . count($contractIds) . ' contracts');
}

if (tableExists($db, 'payments') && $tenantIds) {
    say('Seeding payments…');
    $insPay = $db->prepare(
        'INSERT INTO payments (tenant_id, property_id, amount, due_date, paid_date, status, notes)
         VALUES (:tid, :pid, :amt, :due, :paid, :status, :notes)'
    );
    $payCount = 0;
    foreach ($tenantIds as $tid) {
        $t = $tenantLease[$tid] ?? null;
        if (!$t) continue;
        // Window from 8 months back to 6 months ahead so the revenue forecast
        // (which is forward-looking) has upcoming, not-yet-due payments to chart.
        for ($m = -8; $m <= 6; $m++) {
            $due = (new DateTimeImmutable('first day of this month'))
                ->modify(sprintf('%+d months', $m))
                ->format('Y-m-05');

            if ($m > 0) {
                $status = 'pending';                                  // upcoming
            } elseif ($m === 0) {
                $status = pick(['pending', 'late']);                  // current month
            } else {
                $status = pick(['paid', 'paid', 'paid', 'late', 'pending']); // past
            }

            $insPay->execute([
                'tid'    => $tid,
                'pid'    => $t['property_id'],
                'amt'    => $t['rent'] ?? random_int(600, 1200),
                'due'    => $due,
                'paid'   => $status === 'paid' ? (new DateTimeImmutable($due))->modify('+'.random_int(0,5).' days')->format('Y-m-d') : null,
                'status' => $status,
                'notes'  => '[DEMO]',
            ]);
            $payCount++;
        }
    }
    say("  $payCount payments");
}

// ── Expenses & invoices ─────────────────────────────────────────────────────

if (tableExists($db, 'expenses')) {
    say("Seeding $nExpenses expenses…");
    $insExp = $db->prepare(
        'INSERT INTO expenses (property_id, client_id, category, description, amount, expense_date, notes, created_by)
         VALUES (:pid, :cid, :cat, :desc, :amt, :date, :notes, :by)'
    );
    $cats = ['manutenzione', 'utenze', 'tasse', 'assicurazione', 'agenzia', 'altro'];
    for ($i = 0; $i < $nExpenses; $i++) {
        $insExp->execute([
            'pid'  => pick($propertyIds),
            'cid'  => pick($clientIds),
            'cat'  => pick($cats),
            'desc' => pick(['Riparazione impianto', 'Bolletta luce', 'IMU trimestrale', 'Polizza assicurativa', 'Commissione agenzia', 'Spese condominiali']),
            'amt'  => random_int(45, 2500),
            'date' => randDate(365, 0),
            'notes'=> '[DEMO]',
            'by'   => $adminId,
        ]);
    }
}

if (tableExists($db, 'invoices')) {
    say("Seeding $nInvoices invoices…");
    $insInv = $db->prepare(
        'INSERT INTO invoices (invoice_number, client_id, description, amount, vat_rate, status, issue_date, due_date, paid_date, created_by)
         VALUES (:num, :cid, :desc, :amt, 22, :status, :issue, :due, :paid, :by)'
    );
    for ($i = 1; $i <= $nInvoices; $i++) {
        $status = pick(['draft', 'sent', 'paid', 'cancelled']);
        $issue  = randDate(200, 0);
        $insInv->execute([
            'num'   => 'FAT-DEMO-' . str_pad((string) $i, 4, '0', STR_PAD_LEFT),
            'cid'   => pick($clientIds),
            'desc'  => '[DEMO] Provvigione gestione locazione e servizi agenzia immobiliare',
            'amt'   => random_int(200, 3500),
            'status'=> $status,
            'issue' => $issue,
            'due'   => (new DateTimeImmutable($issue))->modify('+30 days')->format('Y-m-d'),
            'paid'  => $status === 'paid' ? randDate(30, 0) : null,
            'by'    => $adminId,
        ]);
    }
}

// ── Documents (metadata only) ───────────────────────────────────────────────

say('Seeding document records…');
$insDoc = $db->prepare(
    'INSERT INTO documents (doc_type, title, client_id, property_id, file_path, original_name, mime_type, file_size, notes)
     VALUES (:type, :title, :cid, :pid, :path, :orig, :mime, :size, :notes)'
);
for ($i = 0; $i < 20 * $scale; $i++) {
    $insDoc->execute([
        'type'  => pick(['contract', 'invoice', 'id', 'other']),
        'title' => pick(['Contratto locazione', 'Documento identità', 'Fattura riparazione', 'Planimetria']),
        'cid'   => pick($clientIds),
        'pid'   => pick($propertyIds),
        'path'  => 'uploads/demo/placeholder.pdf',
        'orig'  => 'documento_demo.pdf',
        'mime'  => 'application/pdf',
        'size'  => random_int(50000, 900000),
        'notes' => '[DEMO]',
    ]);
}

// ── Phase 12+ features ──────────────────────────────────────────────────────

if (tableExists($db, 'property_keys')) {
    say('Seeding property keys…');
    $insKey = $db->prepare(
        'INSERT INTO property_keys (property_id, holder_id, location, status, handed_at, notes)
         VALUES (:pid, :holder, :loc, :status, :handed, :notes)'
    );
    foreach (array_slice($propertyIds, 0, 15 * $scale) as $pid) {
        $insKey->execute([
            'pid'    => $pid,
            'holder' => pick([$adminId, null]),
            'loc'    => pick(['Cassetta ufficio A', 'Armadio reception', 'Lockbox ingresso', 'Portachiavi agente']),
            'status' => pick(['in_office', 'out', 'in_office']),
            'handed' => randDate(90, 0),
            'notes'  => '[DEMO]',
        ]);
    }
}

if (tableExists($db, 'suppliers')) {
    say("Seeding $nSuppliers suppliers…");
    $insSup = $db->prepare(
        'INSERT INTO suppliers (name, category, phone, email, address, notes, rating, is_active)
         VALUES (:name, :cat, :phone, :email, :addr, :notes, :rating, 1)'
    );
    $supNames = ['Idraulica Modena Srl', 'Elettra Service', 'Edil Costruzioni', 'Falegnameria Bianchi', 'Pulizie Express', 'Giardini Verdi', 'Termoidraulica Emilia'];
    for ($i = 0; $i < $nSuppliers; $i++) {
        $insSup->execute([
            'name'   => pick($supNames) . ($i > 6 ? " $i" : ''),
            'cat'    => pick(['idraulico', 'elettricista', 'muratore', 'falegname', 'pulizie', 'giardiniere']),
            'phone'  => '+39059' . random_int(100000, 999999),
            'email'  => "fornitore$i@demo.test",
            'addr'   => pick($streets) . ' ' . random_int(1, 50) . ', Modena',
            'notes'  => '[DEMO]',
            'rating' => random_int(3, 5),
        ]);
    }
}

if (tableExists($db, 'buildings')) {
    say("Seeding $nBuildings buildings…");
    $buildingIds = [];
    $insBld = $db->prepare(
        'INSERT INTO buildings (name, address, city, total_units, notes) VALUES (:name, :addr, :city, :units, :notes)'
    );
    for ($i = 1; $i <= $nBuildings; $i++) {
        $loc = pick($cities);
        $insBld->execute([
            'name'  => "Condominio Demo $i",
            'addr'  => pick($streets) . ' ' . random_int(1, 100),
            'city'  => $loc['city'],
            'units' => random_int(4, 24),
            'notes' => '[DEMO]',
        ]);
        $buildingIds[] = (int) $db->lastInsertId();
    }
    // phase26: unit->building is 1:N via properties.building_id (junction table dropped)
    $updBld = $db->prepare('UPDATE properties SET building_id = :b WHERE id = :p AND building_id IS NULL');
    foreach ($buildingIds as $bid) {
        for ($j = 0; $j < random_int(3, 8); $j++) {
            $updBld->execute(['b' => $bid, 'p' => pick($propertyIds)]);
        }
    }
}

if (tableExists($db, 'property_insurance')) {
    $insIns = $db->prepare(
        'INSERT INTO property_insurance (property_id, client_id, insurer_name, policy_number, policy_type, premium_annual, start_date, end_date)
         VALUES (:pid, :cid, :ins, :pol, :type, :prem, :start, :end)'
    );
    foreach (array_slice($propertyIds, 0, 20 * $scale) as $pid) {
        $start = randDate(300, -30);
        $insIns->execute([
            'pid'   => $pid,
            'cid'   => pick($clientIds),
            'ins'   => pick(['Generali', 'UnipolSai', 'Allianz', 'Reale Mutua']),
            'pol'   => 'POL-DEMO-' . random_int(100000, 999999),
            'type'  => pick(['incendio', 'globale_fabbricato', 'responsabilita']),
            'prem'  => random_int(180, 1200),
            'start' => $start,
            'end'   => (new DateTimeImmutable($start))->modify('+1 year')->format('Y-m-d'),
        ]);
    }
}

if (tableExists($db, 'meter_readings')) {
    $insMeter = $db->prepare(
        'INSERT INTO meter_readings (property_id, meter_type, reading_value, reading_date, notes)
         VALUES (:pid, :type, :val, :date, :notes)'
    );
    foreach (array_slice($propertyIds, 0, 25 * $scale) as $pid) {
        foreach (['gas', 'electricity', 'water'] as $mtype) {
            $insMeter->execute([
                'pid'  => $pid,
                'type' => $mtype,
                'val'  => random_int(100, 9999) + random_int(0, 99) / 100,
                'date' => randDate(180, 0),
                'notes'=> '[DEMO]',
            ]);
        }
    }
}

if (tableExists($db, 'property_inventory')) {
    $items = ['Frigorifero', 'Lavatrice', 'Divano', 'Armadio', 'Caldaia', 'Condizionatore', 'Forno', 'Tavolo cucina'];
    $insInv = $db->prepare(
        'INSERT INTO property_inventory (property_id, item_name, category, quantity, condition_rating, check_in_date)
         VALUES (:pid, :item, :cat, :qty, :cond, :date)'
    );
    foreach (array_slice($propertyIds, 0, 20 * $scale) as $pid) {
        for ($k = 0; $k < random_int(3, 7); $k++) {
            $insInv->execute([
                'pid'  => $pid,
                'item' => pick($items),
                'cat'  => pick(['elettrodomestico', 'arredamento', 'impianto', 'mobile']),
                'qty'  => random_int(1, 2),
                'cond' => random_int(2, 5),
                'date' => randDate(400, 0),
            ]);
        }
    }
}

if (tableExists($db, 'agent_commissions')) {
    $insComm = $db->prepare(
        'INSERT INTO agent_commissions (admin_user_id, property_id, client_id, amount, percentage, commission_type, status, due_date, notes)
         VALUES (:aid, :pid, :cid, :amt, :pct, :type, :status, :due, :notes)'
    );
    for ($i = 0; $i < 15 * $scale; $i++) {
        $insComm->execute([
            'aid'    => $adminId,
            'pid'    => pick($propertyIds),
            'cid'    => pick($clientIds),
            'amt'    => random_int(300, 5000),
            'pct'    => pick([3, 4, 5, 10]),
            'type'   => pick(['locazione', 'vendita', 'gestione']),
            'status' => pick(['pending', 'paid']),
            'due'    => randDate(60, 90),
            'notes'  => '[DEMO]',
        ]);
    }
}

if (tableExists($db, 'tenant_surveys') && $tenantIds) {
    $insSurvey = $db->prepare(
        'INSERT INTO tenant_surveys (tenant_id, property_id, overall_rating, maintenance_rating, communication_rating, comment, token, submitted_at)
         VALUES (:tid, :pid, :overall, :maint, :comm, :comment, :token, :submitted)'
    );
    foreach (array_slice($tenantIds, 0, 10 * $scale) as $tid) {
        $pid = $tenantLease[$tid]['property_id'] ?? null;
        $insSurvey->execute([
            'tid'      => $tid,
            'pid'      => $pid,
            'overall'  => random_int(3, 5),
            'maint'    => random_int(2, 5),
            'comm'     => random_int(3, 5),
            'comment'  => '[DEMO] Servizio cordiale e tempi di risposta accettabili.',
            'token'    => bin2hex(random_bytes(16)),
            'submitted'=> randDateTime(90, 0),
        ]);
    }
}

if (tableExists($db, 'property_appraisals')) {
    $insAppr = $db->prepare(
        'INSERT INTO property_appraisals (property_id, appraised_by, estimated_value, estimated_rent, condition_rating, appraisal_date, notes)
         VALUES (:pid, :by, :val, :rent, :cond, :date, :notes)'
    );
    foreach (array_slice($propertyIds, 0, 15 * $scale) as $pid) {
        $insAppr->execute([
            'pid'  => $pid,
            'by'   => $adminId,
            'val'  => random_int(150000, 450000),
            'rent' => random_int(600, 1600),
            'cond' => pick(['ottimo', 'buono', 'discreto', 'da_ristrutturare']),
            'date' => randDate(200, 0),
            'notes'=> '[DEMO]',
        ]);
    }
}

if (tableExists($db, 'whatsapp_messages')) {
    say("Seeding $nWaMsgs WhatsApp messages…");
    $insWa = $db->prepare(
        'INSERT INTO whatsapp_messages (direction, from_number, to_number, body, client_id, is_read, received_at)
         VALUES (:dir, :from, :to, :body, :cid, :read, :at)'
    );
    for ($i = 0; $i < $nWaMsgs; $i++) {
        $phone = '+393' . random_int(10, 99) . random_int(1000000, 9999999);
        $insWa->execute([
            'dir'  => pick(['inbound', 'outbound']),
            'from' => pick([$phone, '+393911122233']),
            'to'   => pick(['+393911122233', $phone]),
            'body' => '[DEMO] Buongiorno, vorrei informazioni sull\'immobile in Via Emilia. È ancora disponibile?',
            'cid'  => pick($clientIds),
            'read' => pick([0, 0, 1]),
            'at'   => randDateTime(60, 0),
        ]);
    }
}

if (tableExists($db, 'property_applications')) {
    say("Seeding $nApps property applications…");
    $insApp = $db->prepare(
        'INSERT INTO property_applications (property_id, applicant_name, applicant_email, applicant_phone, application_type, message, status)
         VALUES (:pid, :name, :email, :phone, :type, :msg, :status)'
    );
    for ($i = 0; $i < $nApps; $i++) {
        $fn = pick($firstNames);
        $ln = pick($lastNames);
        $insApp->execute([
            'pid'   => pick($propertyIds),
            'name'  => "$fn $ln",
            'email' => strtolower("$fn.$ln.app$i@demo.test"),
            'phone' => '+393' . random_int(10, 99) . random_int(1000000, 9999999),
            'type'  => pick(['affitto', 'acquisto']),
            'msg'   => '[DEMO] Sono interessato/a a un sopralluogo nel pomeriggio.',
            'status'=> pick(['new', 'contacted', 'approved', 'rejected']),
        ]);
    }
}

if (tableExists($db, 'social_posts')) {
    say("Seeding $nSocial social posts…");
    $insPost = $db->prepare(
        'INSERT INTO social_posts (property_id, platform, caption, status, scheduled_at, published_at)
         VALUES (:pid, :plat, :caption, :status, :sched, :pub)'
    );
    for ($i = 0; $i < $nSocial; $i++) {
        $status = pick(['draft', 'scheduled', 'published', 'failed']);
        $insPost->execute([
            'pid'     => pick($propertyIds),
            'plat'    => pick(['facebook', 'instagram', 'both']),
            'caption' => '[DEMO] Nuovo appartamento disponibile in zona centrale — 3 locali, balcone, cantina. Contattaci per una visita!',
            'status'  => $status,
            'sched'   => randDateTime(14, 30),
            'pub'     => $status === 'published' ? randDateTime(30, 0) : null,
        ]);
    }
}

if (tableExists($db, 'activity_log')) {
    say("Seeding $nActivity activity log entries…");
    $insLog = $db->prepare(
        'INSERT INTO activity_log (admin_user_id, username, action, entity_type, entity_id, description, created_at)
         VALUES (:aid, :user, :action, :etype, :eid, :desc, :at)'
    );
    $username = $db->query('SELECT username FROM admin_users WHERE id = ' . $adminId)->fetchColumn() ?: 'admin';
    $actions  = ['create', 'update', 'delete', 'login'];
    $types    = ['client', 'property', 'tenant', 'lead', 'contract', 'payment'];
    for ($i = 0; $i < $nActivity; $i++) {
        $insLog->execute([
            'aid'    => $adminId,
            'user'   => $username,
            'action' => pick($actions),
            'etype'  => pick($types),
            'eid'    => random_int(1, 100),
            'desc'   => '[DEMO] Operazione di test registrata nel log attività.',
            'at'     => randDateTime(90, 0),
        ]);
    }
}

// ── Summary ─────────────────────────────────────────────────────────────────

say('');
say('Done! Summary:');
$counts = [
    'clients' => 'clients', 'properties' => 'properties', 'tenants' => 'tenants',
    'leads' => 'leads', 'reminders' => 'reminders', 'communications' => 'communications',
    'appointments' => 'appointments', 'payments' => 'payments', 'expenses' => 'expenses',
    'invoices' => 'invoices', 'documents' => 'documents',
];
foreach ($counts as $label => $table) {
    if (tableExists($db, $table)) {
        $n = (int) $db->query("SELECT COUNT(*) FROM `$table`")->fetchColumn();
        say(sprintf('  %-18s %d', $label . ':', $n));
    }
}

say('');
say('Open http://localhost:8090/ and browse all sections.');
say('Re-run with --fresh to reset business data and seed again.');
