<?php
/**
 * Stripe Webhook handler.
 *
 * POST /api/stripe_webhook.php
 * Called by Stripe — no session auth required.
 * Verifies Stripe-Signature header (HMAC SHA-256).
 *
 * Handles: checkout.session.completed
 */

// Minimal bootstrap — no session, no CSRF
require_once __DIR__ . '/../config/env.php';
loadEnv(dirname(__DIR__) . '/.env');
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../config/settings.php';

// Stripe SDK (installed via Composer)
$autoload = dirname(__DIR__) . '/vendor/autoload.php';
if (file_exists($autoload)) {
    require_once $autoload;
}

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$payload   = file_get_contents('php://input');
$sigHeader = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';

// ── Webhook signing secret ──────────────────────────────────────────────────────
$webhookSecret = getSetting('stripe_webhook_secret')
              ?: (getenv('STRIPE_WEBHOOK_SECRET') ?: '');

$event = null;

if ($webhookSecret) {
    if (!$sigHeader) {
        http_response_code(400);
        echo json_encode(['error' => 'Stripe-Signature header mancante.']);
        exit;
    }

    // ── Use Stripe SDK if available, otherwise fall back to manual HMAC ──────
    if (class_exists('\\Stripe\\Webhook')) {
        try {
            $event = \Stripe\Webhook::constructEvent($payload, $sigHeader, $webhookSecret);
            $event = json_decode(json_encode($event), true); // normalise to plain array
        } catch (\Stripe\Exception\SignatureVerificationException $e) {
            http_response_code(400);
            echo json_encode(['error' => 'Firma non valida.']);
            exit;
        } catch (\UnexpectedValueException $e) {
            http_response_code(400);
            echo json_encode(['error' => 'Payload non valido.']);
            exit;
        }
    } else {
        // Fallback: manual HMAC-SHA256 (identical algorithm to the SDK)
        $parts = [];
        foreach (explode(',', $sigHeader) as $part) {
            [$k, $v] = array_pad(explode('=', $part, 2), 2, '');
            $parts[$k][] = $v;
        }
        $timestamp = (int) ($parts['t'][0] ?? 0);
        if (abs(time() - $timestamp) > 300) {
            http_response_code(400);
            echo json_encode(['error' => 'Timestamp troppo vecchio.']);
            exit;
        }
        $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $webhookSecret);
        $valid    = false;
        foreach ($parts['v1'] ?? [] as $v1) {
            if (hash_equals($expected, $v1)) { $valid = true; break; }
        }
        if (!$valid) {
            http_response_code(400);
            echo json_encode(['error' => 'Firma non valida.']);
            exit;
        }
    }
} else {
    // No signing secret configured.
    // FAIL CLOSED in production: an unsigned/forged event must never be trusted.
    // Only in non-production do we accept unverified events (to ease local testing).
    $isProd = strtolower((string) env('APP_ENV', 'production')) === 'production';
    if ($isProd) {
        error_log('[stripe_webhook] REJECTED: no STRIPE_WEBHOOK_SECRET configured in production — refusing unverified event.');
        http_response_code(503);
        echo json_encode(['error' => 'Webhook non configurato.']);
        exit;
    }
    error_log('[stripe_webhook] WARNING: no STRIPE_WEBHOOK_SECRET set — accepting unverified events (non-production only).');
}

// If $event wasn't already set by SDK path, parse the raw payload now
if ($event === null) {
    $event = json_decode($payload, true);
}
if (!is_array($event)) {
    http_response_code(400);
    echo json_encode(['error' => 'Payload non valido.']);
    exit;
}

try {
    $db        = getDB();
    $eventType = $event['type'] ?? '';
    $processed = false;

    if ($eventType === 'checkout.session.completed') {
        $session   = $event['data']['object'] ?? [];
        $sessionId = $session['id'] ?? '';
        $intentId  = $session['payment_intent'] ?? null;

        if ($sessionId) {
            // Update stripe_payments
            $upd = $db->prepare(
                "UPDATE stripe_payments
                    SET status                 = 'paid',
                        stripe_payment_intent  = :intent,
                        paid_at                = NOW()
                  WHERE stripe_session_id = :session_id
                    AND status            = 'pending'"
            );
            $upd->execute([':intent' => $intentId, ':session_id' => $sessionId]);

            if ($upd->rowCount() > 0) {
                // Fetch related payment_id from stripe_payments
                $sel = $db->prepare(
                    'SELECT payment_id FROM stripe_payments WHERE stripe_session_id = :sid LIMIT 1'
                );
                $sel->execute([':sid' => $sessionId]);
                $spRow = $sel->fetch();

                if ($spRow && $spRow['payment_id']) {
                    $paymentId = (int) $spRow['payment_id'];

                    // Mark payments record as paid.
                    // NOTE: the payments table column is `paid_date` (not `paid_at`,
                    // which only exists on stripe_payments). Using the wrong column
                    // here previously threw after a real charge and returned 500.
                    $db->prepare(
                        "UPDATE payments
                            SET status    = 'paid',
                                paid_date = CURDATE()
                          WHERE id = :pid
                            AND status IN ('pending','late')"
                    )->execute([':pid' => $paymentId]);

                    // Log activity if activity_log table exists
                    try {
                        $db->prepare(
                            "INSERT INTO activity_log (action, entity_type, entity_id, description, created_at)
                             VALUES ('stripe_paid', 'payment', :pid, :desc, NOW())"
                        )->execute([
                            ':pid'  => $paymentId,
                            ':desc' => 'Pagamento ricevuto via Stripe (session: ' . $sessionId . ')',
                        ]);
                    } catch (Throwable) {
                        // activity_log table may not exist yet — ignore
                    }
                }
                $processed = true;
            }
        }
    }

    http_response_code(200);
    echo json_encode(['received' => true, 'processed' => $processed]);

} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Errore database.']);
}
