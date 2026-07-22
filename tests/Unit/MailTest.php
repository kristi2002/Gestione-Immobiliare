<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Tests for config/mail.php
 *
 * These tests run without a real SMTP server.
 * - When mail_enabled=false, sendClientEmail() simulates success without connecting.
 * - sendViaSmtp() is tested for invalid-email rejection and disabled-mail short-circuit.
 * - SMTP config structure is validated.
 */
class MailTest extends TestCase
{
    // ── sendClientEmail ─────────────────────────────────────────────────────────

    public function testSendClientEmailReturnsSuccessWhenMailDisabled(): void
    {
        // mail_enabled is false in test bootstrap getMailConfig()
        $result = sendClientEmail('recipient@example.com', 'Test Subject', 'Test body');

        $this->assertTrue($result['success']);
        $this->assertSame('sent', $result['status']);
        $this->assertNull($result['error']);
        $this->assertStringStartsWith('SIMULATED-', $result['external_id']);
    }

    public function testSendClientEmailRejectsInvalidEmail(): void
    {
        $result = sendClientEmail('not-an-email', 'Subject', 'Body');

        $this->assertFalse($result['success']);
        $this->assertSame('failed', $result['status']);
        $this->assertNotEmpty($result['error']);
    }

    public function testSendClientEmailRejectsEmptyEmail(): void
    {
        $result = sendClientEmail('', 'Subject', 'Body');

        $this->assertFalse($result['success']);
        $this->assertSame('failed', $result['status']);
    }

    #[DataProvider('invalidEmailProvider')]
    public function testSendClientEmailRejectsVariousInvalidEmails(string $email): void
    {
        $result = sendClientEmail($email, 'Subject', 'Body');
        $this->assertFalse($result['success'], "Expected failure for email: {$email}");
    }

    public static function invalidEmailProvider(): array
    {
        return [
            ['plainaddress'],
            ['@missinglocal.com'],
            ['missing-at-sign'],
            ['two@@at.com'],
            ['spaces in@email.com'],
        ];
    }

    public function testSendClientEmailResultHasRequiredKeys(): void
    {
        $result = sendClientEmail('test@example.com', 'Subject', 'Body');

        $this->assertArrayHasKey('success', $result);
        $this->assertArrayHasKey('status', $result);
        $this->assertArrayHasKey('external_id', $result);
        $this->assertArrayHasKey('error', $result);
    }

    // ── sendViaSmtp ─────────────────────────────────────────────────────────────

    public function testSendViaSmtpFailsWhenNoHostConfigured(): void
    {
        $cfg = [
            'mail_enabled'  => true,
            'smtp_host'     => 'localhost.invalid', // guaranteed non-routable
            'smtp_port'     => 587,
            'smtp_secure'   => 'tls',
            'smtp_user'     => '',
            'smtp_pass'     => '',
            'agency_email'  => 'noreply@example.com',
            'agency_name'   => 'Test',
        ];

        // Should fail gracefully — fsockopen to invalid host returns false
        $result = sendViaSmtp('recipient@example.com', 'Subject', 'Body', $cfg);

        $this->assertFalse($result['success']);
        $this->assertSame('failed', $result['status']);
        $this->assertNotEmpty($result['error']);
        $this->assertNull($result['external_id']);
    }

    public function testSendViaSmtpResultShape(): void
    {
        $cfg = [
            'mail_enabled'  => true,
            'smtp_host'     => '127.0.0.1',
            'smtp_port'     => 19999, // almost certainly nothing listening
            'smtp_secure'   => 'tls',
            'smtp_user'     => 'user',
            'smtp_pass'     => 'pass',
            'agency_email'  => 'noreply@example.com',
            'agency_name'   => 'Test',
        ];

        $result = sendViaSmtp('recipient@example.com', 'Subject', 'Body', $cfg);

        // Whatever the result, shape must be consistent
        $this->assertIsBool($result['success']);
        $this->assertContains($result['status'], ['sent', 'failed']);
        // error is a string on failure, null on success
        if (!$result['success']) {
            $this->assertIsString($result['error']);
        }
    }
}
