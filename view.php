<?php
/**
 * Authenticated view loader — blocks direct access to views/*.html
 */
require_once __DIR__ . '/config/bootstrap.php';
requireAuthWeb();

$allowed = ['dashboard', 'clients', 'properties', 'documents', 'communications', 'reminders', 'social', 'tenants', 'settings'];
$name    = basename($_GET['name'] ?? '');

if (!in_array($name, $allowed, true)) {
    http_response_code(404);
    exit('Vista non trovata.');
}

if (!canAccessView($name)) {
    http_response_code(403);
    exit('Accesso negato.');
}

$path = __DIR__ . '/views/' . $name . '.html';

if (!is_readable($path)) {
    http_response_code(404);
    exit('Vista non trovata.');
}

header('Content-Type: text/html; charset=utf-8');
readfile($path);
