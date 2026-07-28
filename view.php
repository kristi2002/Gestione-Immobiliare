<?php
/**
 * Authenticated view loader — blocks direct access to views/*.html
 */
require_once __DIR__ . '/config/bootstrap.php';
requireAuthWeb();

$allowed = [
    'dashboard', 'clients', 'leads', 'properties', 'contracts', 'documents', 'payments', 'expenses',
    'invoices', 'communications', 'appointments', 'calendar', 'map', 'reminders', 'tenants', 'keys',
    'agents', 'reports', 'social', 'activity_log', 'settings',
    'buildings', 'insurance', 'meters', 'suppliers', 'inventory', 'commissions', 'surveys', 'forecast',
    'maintenance_workflow', 'whatsapp_inbox', 'property_applications', 'client_profile', 'automations',
    'property_profile', 'agent_profile', 'client_edit', 'property_edit', 'tenant_profile', 'building_profile',
    'aml', 'scadenzario', 'portal_sync', 'valuation',
    'contract_edit', 'invoice_edit', 'lead_edit', 'tenant_edit', 'appointment_edit', 'expense_edit', 'payment_edit',
    'appointment_profile',
];
$name    = basename($_GET['name'] ?? '');

if (!in_array($name, $allowed, true)) {
    http_response_code(404);
    exit('Vista non trovata.');
}

if (!canAccessView($name)) {
    http_response_code(403);
    exit('Accesso negato.');
}

// Direct browser navigation loads the bare partial (no CSS/layout). Redirect into the SPA shell.
if (($_SERVER['HTTP_X_APP_PARTIAL'] ?? '') !== '1') {
    header('Location: index.php?view=' . urlencode($name));
    exit;
}

if (isViewDisabled($name)) {
    header('Content-Type: text/html; charset=utf-8');
    echo '<div class="placeholder-view">'
        . '<div class="placeholder-icon"><i data-lucide="lock"></i></div>'
        . '<h2>Funzionalità in fase di attivazione</h2>'
        . '<p>Questa sezione è disattivata in attesa dell\'attivazione del servizio su cui si appoggia.</p>'
        . '</div>';
    exit;
}

$path = __DIR__ . '/views/' . $name . '.html';

if (!is_readable($path)) {
    http_response_code(404);
    exit('Vista non trovata.');
}

header('Content-Type: text/html; charset=utf-8');
readfile($path);
