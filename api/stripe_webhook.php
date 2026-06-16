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
              ?? (getenv('STRIPE_WEBHOOK_SECRET') ?: '');

if ($webhookSecret && $sigHeader) {
    // Verify Stripe signature (Stripe-Signature: t=...,v1=...)
    $valid = false;
    $parts = [];
    foreach (explode(',', $sigHeader) as $part) {
        [$k, $v] = array_pad(explode('=', $part, 2), 2, '');
        $parts[$k][] = $v;
    }

    $timestamp = $parts['t'][0] ?? 0;
    // Reject if timestamp is too old (5 minutes)
    if (abs(time() - (int) $timestamp) > 300) {
        http_response_code(400);
        echo json_encode(['error' => 'Timestamp troppo vecchio.']);
        exit;
    }

    $signedPayload = $timestamp . '.' . $payload;
    $expectedSig   = hash_hmac('sha256', $signedPayload, $webhookSecret);
    foreach ($parts['v1'] ?? [] as $v1) {
        if (hash_equals($expectedSig, $v1)) {
            $valid = true;
            break;
        }
    }

    if (!$valid) {
        http_response_code(400);
        echo json_encode(['error' => 'Firma non valida.']);
        exit;
    }
} elseif ($webhookSecret && !$sigHeader) {
    // Secret configured but signature missing — reject
    http_response_code(400);
    echo json_encode(['error' => 'Stripe-Signature header mancante.']);
    exit;
}
// If no webhook secret is configured, accept the event (development mode)

$event = json_decode($payload, true);
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

                    // Mark payments record as paid
                    $db->prepare(
                        "UPDATE payments
                            SET status   = 'paid',
                                paid_at  = NOW()
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
