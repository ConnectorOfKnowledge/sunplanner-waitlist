<?php
/**
 * SunPlanner waitlist signup endpoint.
 * Accepts POST with JSON body { "email": "...", "platform": "android"|"iphone" }
 * Writes to MySQL via PDO. Credentials come from db-config.php.
 *
 * To export the full signup list, run this query in phpMyAdmin:
 *   SELECT email, platform, created_at FROM signups ORDER BY created_at DESC;
 * Then use phpMyAdmin's Export tab to download as CSV.
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// Only accept POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed.']);
    exit;
}

// Parse JSON body
$raw = file_get_contents('php://input');
if ($raw === false || $raw === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Empty request body.']);
    exit;
}

$data = json_decode($raw, true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid JSON.']);
    exit;
}

// Validate email
$email = isset($data['email']) ? trim(strtolower((string) $data['email'])) : '';
if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => 'A valid email address is required.']);
    exit;
}

// Length guard (VARCHAR 254 in the table)
if (strlen($email) > 254) {
    http_response_code(400);
    echo json_encode(['error' => 'Email address is too long.']);
    exit;
}

// Validate platform (default to android if missing or unrecognised)
$platform = isset($data['platform']) ? strtolower(trim((string) $data['platform'])) : 'android';
if (!in_array($platform, ['android', 'iphone'], true)) {
    $platform = 'android';
}

// Load database credentials
require_once __DIR__ . '/db-config.php';

try {
    $pdo = new PDO(
        "mysql:host={$DB_HOST};dbname={$DB_NAME};charset=utf8mb4",
        $DB_USER,
        $DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );

    // INSERT IGNORE silently skips duplicate (email, platform) pairs
    $stmt = $pdo->prepare(
        "INSERT IGNORE INTO signups (email, platform, created_at) VALUES (:email, :platform, NOW())"
    );
    $stmt->execute([':email' => $email, ':platform' => $platform]);

    echo json_encode(['success' => true]);

} catch (PDOException $e) {
    error_log('SunPlanner signup DB error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Server error. Please try again.']);
}
