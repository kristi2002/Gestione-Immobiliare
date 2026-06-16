<?php
/**
 * Stripe Checkout — create a payment session for tenant rent.
 *
 * POST /api/stripe_checkout.php
 * Body: { payment_id, success_url, cancel_url }
 *
 * Returns: { checkout_url, session_id }
 */

require_once __DIR__ . '/../config/api_bootstrap.php';
requireRole('admin', 'agent', 'super_admin', 'readonly');

apiHandleOptions();
apiRequireMethod('POST');

try {
    $db   = getDB();
    $body = apiGetJsonBody();

    $paymentId  = isset($body['payment_id'])  ? (int) $body['payment_id']    : 0;
    $successUrl = trim($body['success_url']   ?? '');
    $cancelUrl  = trim($body['cancel_url']    ?? '');

    if (!$paymentId)  apiError('payment_id obbligatorio.');
    if (!$successUrl) apiError('success_url obbligatorio.');
    if (!$cancelUrl)  apiError('cancel_url obbligatorio.');

    // ── Resolve payment ─────────────────────────────────────────────────────────
    $stmt = $db->prepare(
        "SELECT p.id, p.amount, p.description, p.tenant_id,
                t.first_name, t.last_name, t.email AS tenant_email
           FROM payments p
           LEFT JOIN tenants t ON t.id = p.tenant_id
          WHERE p.id = :id"
    );
    $stmt->execute([':id' => $paymentId]);
    $payment = $stmt->fetch();
    if (!$payment) apiError('Pagamento non trovato.', 404);

    $tenantId = (int) ($payment['tenant_id'] ?? 0);
    if (!$tenantId) apiError('Pagamento non associato a un inquilino.');

    // ── Stripe secret key ───────────────────────────────────────────────────────
    $stripeKey = getSetting('stripe_secret_key')
              ?? (getenv('STRIPE_SECRET_KEY') ?: '');

    if (!$stripeKey || $stripeKey === '') {
        apiError('Stripe non configurato. Aggiungi stripe_secret_key nelle impostazioni o nel file .env.', 503);
    }

    // ── Amount in cents ─────────────────────────────────────────────────────────
    $amountCents = (int) round((float) $payment['amount'] * 100);
    $currency    = 'eur';

    $description = $payment['description']
        ?: ('Pagamento affitto — ' . trim(($payment['first_name'] ?? '') . ' ' . ($payment['last_name'] ?? '')));

    // ── Call Stripe API via cURL ────────────────────────────────────────────────
    $postFields = http_build_query([
        'payment_method_types[]'           => 'card',
        'line_items[0][price_data][currency]'                         => $currency,
        'line_items[0][price_data][product_data][name]'               => $description,
        'line_items[0][price_data][unit_amount]'                      => $amountCents,
        'line_items[0][quantity]'                                      => 1,
        'mode'                             => 'payment',
        'success_url'                      => $successUrl,
        'cancel_url'                       => $cancelUrl,
        'metadata[payment_id]'             => $paymentId,
        'metadata[tenant_id]'              => $tenantId,
    ]);

    $ch = curl_init('https://api.stripe.com/v1/checkout/sessions');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $postFields,
        CURLOPT_USERPWD        => $stripeKey . ':',
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_TIMEOUT        => 20,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr  = curl_error($ch);
    curl_close($ch);

    if ($curlErr) {
        apiError('Errore connessione Stripe: ' . $curlErr, 502);
    }

    $stripe = json_decode($response, true);

    if ($httpCode !== 200 || empty($stripe['id'])) {
        $errMsg = $stripe['error']['message'] ?? 'Errore Stripe sconosciuto.';
        apiError('Stripe: ' . $errMsg, 502);
    }

    $sessionId = $stripe['id'];
    $checkoutUrl = $stripe['url'];

    // ── Store in stripe_payments ────────────────────────────────────────────────
    $ins = $db->prepare(
        "INSERT INTO stripe_payments
            (payment_id, tenant_id, stripe_session_id, amount, currency, status)
         VALUES
            (:payment_id, :tenant_id, :session_id, :amount, :currency, 'pending')"
    );
    $ins->execute([
        ':payment_id' => $paymentId,
        ':tenant_id'  => $tenantId,
        ':session_id' => $sessionId,
        ':amount'     => $payment['amount'],
        ':currency'   => $currency,
    ]);

    apiSuccess([
        'checkout_url' => $checkoutUrl,
        'session_id'   => $sessionId,
    ]);

} catch (PDOException $e) {
    apiError('Errore database.', 500);
}
