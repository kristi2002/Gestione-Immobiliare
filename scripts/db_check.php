<?php
require dirname(__DIR__) . '/config/db.php';

try {
    $db = getDB();
    echo "DB connection: OK\n";
    echo "Host: " . DB_HOST . " / DB: " . DB_NAME . "\n\n";

    $tables = ['admin_users', 'clients', 'properties', 'leads', 'tenants', 'email_templates', 'whatsapp_templates'];
    foreach ($tables as $t) {
        $n = (int) $db->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
        echo str_pad($t, 22) . $n . "\n";
    }

    echo "\nAdmin users:\n";
    foreach ($db->query('SELECT id, username, role, is_active FROM admin_users') as $row) {
        echo "  #{$row['id']} {$row['username']} ({$row['role']})\n";
    }
} catch (Throwable $e) {
    echo "DB connection: FAILED\n";
    echo $e->getMessage() . "\n";
    exit(1);
}
