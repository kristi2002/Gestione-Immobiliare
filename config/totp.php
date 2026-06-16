<?php
/**
 * TOTP (RFC 6238) implementation — no external dependencies.
 * Implements base32, HMAC-SHA1 based one-time passwords, QR provisioning
 * URIs and backup codes.
 */

const TOTP_PERIOD  = 30;
const TOTP_DIGITS  = 6;
const TOTP_B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateTotpSecret(int $length = 20): string
{
    $bytes  = random_bytes($length);
    return base32Encode($bytes);
}

function base32Encode(string $data): string
{
    $alphabet = TOTP_B32_ALPHABET;
    $binary   = '';
    foreach (str_split($data) as $char) {
        $binary .= str_pad(decbin(ord($char)), 8, '0', STR_PAD_LEFT);
    }

    $output = '';
    foreach (str_split($binary, 5) as $chunk) {
        $chunk  = str_pad($chunk, 5, '0', STR_PAD_RIGHT);
        $output .= $alphabet[bindec($chunk)];
    }
    return $output;
}

function base32Decode(string $b32): string
{
    $alphabet = TOTP_B32_ALPHABET;
    $b32      = strtoupper(preg_replace('/[^A-Z2-7]/', '', $b32));
    if ($b32 === '') {
        return '';
    }

    $binary = '';
    foreach (str_split($b32) as $char) {
        $pos = strpos($alphabet, $char);
        if ($pos === false) {
            continue;
        }
        $binary .= str_pad(decbin($pos), 5, '0', STR_PAD_LEFT);
    }

    $output = '';
    foreach (str_split($binary, 8) as $byte) {
        if (strlen($byte) === 8) {
            $output .= chr(bindec($byte));
        }
    }
    return $output;
}

function totpCodeAt(string $secret, int $counter): string
{
    $key    = base32Decode($secret);
    $binary = pack('N*', 0) . pack('N*', $counter); // 8-byte big-endian counter
    $hash   = hash_hmac('sha1', $binary, $key, true);

    $offset = ord($hash[strlen($hash) - 1]) & 0x0F;
    $part   = (ord($hash[$offset]) & 0x7F) << 24
        | (ord($hash[$offset + 1]) & 0xFF) << 16
        | (ord($hash[$offset + 2]) & 0xFF) << 8
        | (ord($hash[$offset + 3]) & 0xFF);

    $code = $part % (10 ** TOTP_DIGITS);
    return str_pad((string) $code, TOTP_DIGITS, '0', STR_PAD_LEFT);
}

/**
 * Verify a code with +/- 1 step tolerance.
 */
function verifyTotpCode(string $secret, string $code): bool
{
    $code = preg_replace('/\s+/', '', $code);
    if (!preg_match('/^\d{' . TOTP_DIGITS . '}$/', $code)) {
        return false;
    }

    $counter = (int) floor(time() / TOTP_PERIOD);
    for ($i = -1; $i <= 1; $i++) {
        if (hash_equals(totpCodeAt($secret, $counter + $i), $code)) {
            return true;
        }
    }
    return false;
}

function generateQrCodeUrl(string $secret, string $username, string $issuer): string
{
    $label = rawurlencode($issuer . ':' . $username);
    $query = http_build_query([
        'secret'    => $secret,
        'issuer'    => $issuer,
        'algorithm' => 'SHA1',
        'digits'    => TOTP_DIGITS,
        'period'    => TOTP_PERIOD,
    ]);
    return 'otpauth://totp/' . $label . '?' . $query;
}

/**
 * @return string[] eight 8-digit backup codes.
 */
function generateBackupCodes(int $count = 8): array
{
    $codes = [];
    for ($i = 0; $i < $count; $i++) {
        $codes[] = str_pad((string) random_int(0, 99999999), 8, '0', STR_PAD_LEFT);
    }
    return $codes;
}

function hashBackupCode(string $code): string
{
    return hash('sha256', preg_replace('/\s+/', '', $code));
}
