<?php
/**
 * Database connection — PDO singleton (reads from .env).
 */

require_once __DIR__ . '/env.php';

if (!defined('DB_HOST')) {
    loadEnv(dirname(__DIR__) . '/.env');

    define('DB_HOST',    (string) env('DB_HOST', 'localhost'));
    define('DB_NAME',    (string) env('DB_NAME', 'gestione_immobiliare'));
    define('DB_USER',    (string) env('DB_USER', 'root'));
    define('DB_PASS',    (string) env('DB_PASS', 'root'));
    define('DB_CHARSET', (string) env('DB_CHARSET', 'utf8mb4'));
}

function getDB(): PDO
{
    static $pdo = null;

    if ($pdo === null) {
        $host = DB_HOST;
        $port = null;

        if (str_contains($host, ':')) {
            [$host, $port] = explode(':', $host, 2);
        }

        $dsn = sprintf(
            'mysql:host=%s%s;dbname=%s;charset=%s',
            $host,
            $port ? ';port=' . $port : '',
            DB_NAME,
            DB_CHARSET
        );

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => true,
        ];

        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            if (PHP_SAPI === 'cli') {
                throw $e;
            }
            http_response_code(500);
            header('Content-Type: application/json');
            echo json_encode([
                'success' => false,
                'error'   => env('APP_DEBUG', false)
                    ? 'Database connection failed: ' . $e->getMessage()
                    : 'Database connection failed.',
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    return $pdo;
}

/**
 * A tenant is a person, not a fixed property assignment — the CONTRACTS table
 * is the source of truth for where they live and on what terms. This resolves
 * the tenant's "current" property/lease by preferring an active contract
 * (no end_date, or end_date in the future), falling back to their most recent
 * contract otherwise. Returns null if the tenant has no contract at all.
 */
function getTenantCurrentContract(PDO $db, int $tenantId): ?array
{
    $stmt = $db->prepare(
        "SELECT c.id AS contract_id, c.property_id, c.start_date AS lease_start,
                c.end_date AS lease_end, c.monthly_rent, c.status AS contract_status,
                p.address, p.city, p.cap, p.province, p.sqm, p.rooms, p.description,
                p.client_id AS property_client_id
         FROM contracts c
         INNER JOIN properties p ON p.id = c.property_id
         WHERE c.tenant_id = :tid
         ORDER BY (c.end_date IS NULL OR c.end_date >= CURDATE()) DESC, c.start_date DESC, c.id DESC
         LIMIT 1"
    );
    $stmt->execute(['tid' => $tenantId]);
    $row = $stmt->fetch();
    return $row ?: null;
}
