<?php
/**
 * Public property application form — no authentication required.
 * Accessible at: /apply.php?property_id=X
 */

require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/config/settings.php';
require_once __DIR__ . '/config/gdpr.php';

$db = getDB();

// ── Resolve property ────────────────────────────────────────────────────────────
$propertyId = isset($_GET['property_id']) ? (int) $_GET['property_id'] : 0;
$property   = null;
$error      = '';
$success    = false;

if ($propertyId > 0) {
    $stmt = $db->prepare(
        "SELECT p.id, p.address, p.city, p.property_type, p.status,
                p.price, p.price_type, p.description, p.energy_class,
                pm.file_path AS cover_photo
           FROM properties p
           LEFT JOIN property_media pm ON pm.id = p.cover_media_id
          WHERE p.id = :id AND p.status != 'archived'"
    );
    $stmt->execute([':id' => $propertyId]);
    $property = $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
}

$branding = getPublicBranding();
$agencyName = $branding['agency_name'] ?: 'Gestionale Immobiliare';

// ── Handle POST ─────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $property) {

    // Honeypot check
    if (!empty($_POST['website'])) {
        // Bot detected — silently succeed
        $success = true;
    } else {
        $clientIp = $_SERVER['HTTP_X_FORWARDED_FOR']
            ? explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]
            : ($_SERVER['REMOTE_ADDR'] ?? '');
        $clientIp = trim($clientIp);

        // Rate limit: max 3 submissions per IP per hour
        $rateStmt = $db->prepare(
            "SELECT COUNT(*) FROM property_applications
              WHERE ip_address = :ip
                AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)"
        );
        $rateStmt->execute([':ip' => $clientIp]);
        $recentCount = (int) $rateStmt->fetchColumn();

        if ($recentCount >= 3) {
            $error = 'Hai inviato troppe richieste. Riprova tra un\'ora.';
        } else {
            $name    = trim($_POST['applicant_name']  ?? '');
            $email   = trim($_POST['applicant_email'] ?? '');
            $phone   = trim($_POST['applicant_phone'] ?? '');
            $type    = in_array($_POST['application_type'] ?? '', ['affitto', 'acquisto'], true)
                           ? $_POST['application_type']
                           : 'affitto';
            $message = trim($_POST['message'] ?? '');

            $privacyConsent = !empty($_POST['privacy_consent']);

            if ($name === '' || $email === '') {
                $error = 'Nome e email sono obbligatori.';
            } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $error = 'Indirizzo email non valido.';
            } elseif (!$privacyConsent) {
                // GDPR — must accept the privacy informativa before we store PII.
                $error = 'Per inviare la richiesta è necessario accettare l\'informativa sulla privacy.';
            } else {
                $ins = $db->prepare(
                    "INSERT INTO property_applications
                        (property_id, applicant_name, applicant_email, applicant_phone,
                         application_type, message, status, ip_address)
                     VALUES
                        (:pid, :name, :email, :phone, :type, :msg, 'new', :ip)"
                );
                $ins->execute([
                    ':pid'   => $propertyId,
                    ':name'  => $name,
                    ':email' => $email,
                    ':phone' => $phone ?: null,
                    ':type'  => $type,
                    ':msg'   => $message ?: null,
                    ':ip'    => $clientIp,
                ]);

                // Persist proof of the consent enforced above (best-effort).
                $applicationId = (int) $db->lastInsertId();
                logConsent(
                    $db, 'application', $applicationId, 'privacy', true, 'consent',
                    'Informativa privacy accettata tramite il modulo di candidatura immobile (apply.php).',
                    'apply_form', $clientIp
                );

                $success = true;
            }
        }
    }
}

// ── Helper ──────────────────────────────────────────────────────────────────────
function esc(string $v): string { return htmlspecialchars($v, ENT_QUOTES, 'UTF-8'); }

$primaryColor = $branding['primary_color'] ?? '#2563eb';
?>
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Richiesta immobile — <?= esc($agencyName) ?></title>
    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: system-ui, -apple-system, sans-serif;
            background: #f1f5f9;
            color: #1e293b;
            min-height: 100vh;
            padding: 24px 16px;
        }
        .card {
            background: #fff;
            border-radius: 12px;
            box-shadow: 0 2px 16px rgba(0,0,0,.08);
            max-width: 640px;
            margin: 0 auto;
            padding: 32px;
        }
        .agency-header {
            text-align: center;
            margin-bottom: 28px;
            padding-bottom: 20px;
            border-bottom: 1px solid #e2e8f0;
        }
        .agency-header h2 {
            font-size: 1.1rem;
            color: #64748b;
            font-weight: 500;
        }
        .property-info {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
        }
        .property-info h3 {
            font-size: 1.1rem;
            margin-bottom: 4px;
        }
        .property-info .meta {
            font-size: .875rem;
            color: #64748b;
        }
        .property-photo {
            width: 100%;
            max-height: 220px;
            object-fit: cover;
            border-radius: 6px;
            margin-bottom: 12px;
        }
        h1 { font-size: 1.4rem; margin-bottom: 20px; }
        label { display: block; font-size: .875rem; font-weight: 600; margin-bottom: 4px; }
        input, select, textarea {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            font-size: .95rem;
            color: #1e293b;
            background: #fff;
            transition: border-color .15s;
        }
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: <?= esc($primaryColor) ?>;
            box-shadow: 0 0 0 3px <?= esc($primaryColor) ?>22;
        }
        .field { margin-bottom: 18px; }
        .consent-label { display: flex; gap: 10px; align-items: flex-start; font-weight: 400; font-size: .85rem; color: #475569; cursor: pointer; }
        .consent-label input[type="checkbox"] { width: 18px; height: 18px; margin-top: 1px; flex: 0 0 auto; }
        .consent-label a { color: <?= esc($primaryColor) ?>; }
        .honeypot { display: none !important; }
        .btn {
            background: <?= esc($primaryColor) ?>;
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 12px 24px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            transition: opacity .15s;
        }
        .btn:hover { opacity: .88; }
        .alert {
            border-radius: 6px;
            padding: 14px 16px;
            margin-bottom: 20px;
            font-size: .95rem;
        }
        .alert--success { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
        .alert--error   { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
        .not-found { text-align: center; padding: 40px 0; color: #64748b; }
        .price-badge {
            display: inline-block;
            background: <?= esc($primaryColor) ?>;
            color: #fff;
            font-size: .85rem;
            font-weight: 700;
            padding: 2px 10px;
            border-radius: 20px;
            margin-top: 6px;
        }
    </style>
</head>
<body>
    <div class="card">
        <div class="agency-header">
            <h2><?= esc($agencyName) ?></h2>
        </div>

        <?php if (!$property): ?>
            <div class="not-found">
                <p style="font-size:2rem">🏠</p>
                <p style="margin-top:12px">Immobile non trovato o non disponibile.</p>
            </div>

        <?php elseif ($success): ?>
            <div class="alert alert--success">
                <strong>Richiesta inviata con successo!</strong><br>
                Ti contatteremo al più presto all'indirizzo email fornito.
            </div>
            <p style="text-align:center;margin-top:16px">
                <a href="apply.php?property_id=<?= $propertyId ?>" style="color:<?= esc($primaryColor) ?>">Invia un'altra richiesta</a>
            </p>

        <?php else: ?>
            <?php if ($error): ?>
                <div class="alert alert--error"><?= esc($error) ?></div>
            <?php endif; ?>

            <!-- Property preview -->
            <div class="property-info">
                <?php if (!empty($property['cover_photo'])): ?>
                    <img class="property-photo" src="<?= esc($property['cover_photo']) ?>" alt="Foto immobile">
                <?php endif; ?>
                <h3><?= esc($property['address']) ?><?= $property['city'] ? ', ' . esc($property['city']) : '' ?></h3>
                <p class="meta"><?= esc(ucfirst(str_replace('_', ' ', $property['property_type'] ?? ''))) ?>
                    · Classe energetica: <?= !empty($property['energy_class']) ? esc($property['energy_class']) : 'n.d.' ?></p>
                <?php if (!empty($property['price']) && $property['price_type'] === 'affitto'): ?>
                    <span class="price-badge">Affitto: € <?= number_format((float)$property['price'], 0, ',', '.') ?>/mese</span>
                <?php elseif (!empty($property['price']) && $property['price_type'] === 'vendita'): ?>
                    <span class="price-badge">Vendita: € <?= number_format((float)$property['price'], 0, ',', '.') ?></span>
                <?php endif; ?>
                <?php if (!empty($property['description'])): ?>
                    <p style="margin-top:10px;font-size:.9rem;color:#475569"><?= nl2br(esc($property['description'])) ?></p>
                <?php endif; ?>
            </div>

            <h1>Invia una richiesta</h1>

            <form method="POST" action="apply.php?property_id=<?= $propertyId ?>">
                <!-- Honeypot -->
                <div class="honeypot">
                    <label>Website</label>
                    <input type="text" name="website" tabindex="-1" autocomplete="off">
                </div>

                <div class="field">
                    <label for="applicant_name">Nome e Cognome <span style="color:#dc2626">*</span></label>
                    <input type="text" id="applicant_name" name="applicant_name"
                           value="<?= esc($_POST['applicant_name'] ?? '') ?>"
                           required placeholder="Mario Rossi">
                </div>

                <div class="field">
                    <label for="applicant_email">Email <span style="color:#dc2626">*</span></label>
                    <input type="email" id="applicant_email" name="applicant_email"
                           value="<?= esc($_POST['applicant_email'] ?? '') ?>"
                           required placeholder="mario@esempio.it">
                </div>

                <div class="field">
                    <label for="applicant_phone">Telefono</label>
                    <input type="tel" id="applicant_phone" name="applicant_phone"
                           value="<?= esc($_POST['applicant_phone'] ?? '') ?>"
                           placeholder="+39 333 1234567">
                </div>

                <div class="field">
                    <label for="application_type">Tipo di richiesta <span style="color:#dc2626">*</span></label>
                    <select id="application_type" name="application_type" required>
                        <option value="affitto" <?= (($_POST['application_type'] ?? 'affitto') === 'affitto') ? 'selected' : '' ?>>Affitto</option>
                        <option value="acquisto" <?= (($_POST['application_type'] ?? '') === 'acquisto') ? 'selected' : '' ?>>Acquisto</option>
                    </select>
                </div>

                <div class="field">
                    <label for="message">Messaggio</label>
                    <textarea id="message" name="message" rows="4"
                              placeholder="Scrivi qui ulteriori informazioni o domande..."><?= esc($_POST['message'] ?? '') ?></textarea>
                </div>

                <div class="field consent">
                    <label class="consent-label">
                        <input type="checkbox" name="privacy_consent" value="1" required
                               <?= !empty($_POST['privacy_consent']) ? 'checked' : '' ?>>
                        <span>Ho letto e accetto l'<a href="privacy.php" target="_blank" rel="noopener">informativa sulla privacy</a>
                        e acconsento al trattamento dei miei dati per gestire questa richiesta. <span style="color:#dc2626">*</span></span>
                    </label>
                </div>

                <button type="submit" class="btn">Invia richiesta</button>
            </form>
        <?php endif; ?>
    </div>
</body>
</html>
