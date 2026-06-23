<?php
/**
 * One-time Orlandi branding setup — run once, then delete.
 * Access: yoursite.com/setup_orlandi.php
 */
require_once __DIR__ . '/config/bootstrap.php';
require_once __DIR__ . '/config/settings.php';

$updates = [
    'agency_name'    => 'Gestionale Immobiliare Orlandi',
    'agency_tagline' => 'Orlandi Immobiliare',
    'agency_address' => "Via Gabriele D'Annunzio 49, 62012 Civitanova Marche",
    'primary_color'  => '#206bac',
    'sidebar_color'  => '#0d2140',
    'logo_path'      => 'assets/img/orlandi_logo.jpg',
];

$errors = [];
foreach ($updates as $key => $value) {
    try {
        setSetting($key, $value);
    } catch (Throwable $e) {
        $errors[] = "$key: " . $e->getMessage();
    }
}

if ($errors) {
    http_response_code(500);
    echo "Errori:\n" . implode("\n", $errors);
} else {
    // Self-delete after success
    @unlink(__FILE__);
    echo "✅ Branding Orlandi applicato con successo. Questo file è stato eliminato.";
}
