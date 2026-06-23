<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Tests for config/whatsapp.php
 *
 * parseTwilioWebhook() and normalizeWhatsAppNumber() are pure functions
 * with no external dependencies — ideal for unit testing.
 */
class WhatsAppTest extends TestCase
{
    // ── parseTwilioWebhook ──────────────────────────────────────────────────────

    public function testParseTwilioWebhookExtractsAllFields(): void
    {
        $post = [
            'From'       => 'whatsapp:+393331234567',
            'To'         => 'whatsapp:+14155238886',
            'Body'       => 'Ciao, info sull\'appartamento',
            'MessageSid' => 'SM1234567890abcdef',
        ];

        $result = parseTwilioWebhook($post);

        $this->assertSame('whatsapp:+393331234567', $result['from']);
        $this->assertSame('whatsapp:+14155238886', $result['to']);
        $this->assertSame("Ciao, info sull'appartamento", $result['body']);
        $this->assertSame('SM1234567890abcdef', $result['external_id']);
    }

    public function testParseTwilioWebhookHandlesMissingFields(): void
    {
        $result = parseTwilioWebhook([]);

        $this->assertSame('', $result['from']);
        $this->assertSame('', $result['to']);
        $this->assertSame('', $result['body']);
        $this->assertNull($result['external_id']);
    }

    public function testParseTwilioWebhookResultHasRequiredKeys(): void
    {
        $result = parseTwilioWebhook(['From' => '+39333', 'To' => '+1415', 'Body' => 'Hi', 'MessageSid' => 'SM123']);

        $this->assertArrayHasKey('from', $result);
        $this->assertArrayHasKey('to', $result);
        $this->assertArrayHasKey('body', $result);
        $this->assertArrayHasKey('external_id', $result);
    }

    public function testParseTwilioWebhookPreservesUnicodeBody(): void
    {
        $post = ['From' => '+39333', 'To' => '+1415', 'Body' => 'Ciao! 🏠 Appartamento disponibile?', 'MessageSid' => 'SM1'];
        $result = parseTwilioWebhook($post);
        $this->assertSame('Ciao! 🏠 Appartamento disponibile?', $result['body']);
    }

    // ── normalizeWhatsAppNumber ─────────────────────────────────────────────────

    #[DataProvider('phoneNormalizationProvider')]
    public function testNormalizeWhatsAppNumber(string $input, string $expected): void
    {
        $this->assertSame($expected, normalizeWhatsAppNumber($input));
    }

    public static function phoneNormalizationProvider(): array
    {
        return [
            'already E.164 Italian'     => ['+393331234567',   '+393331234567'],
            'Italian without plus'       => ['393331234567',    '+393331234567'],
            'Italian local (0333...)'    => ['03331234567',     '+393331234567'],
            'leading 00 international'   => ['00393331234567',  '+393331234567'],
            'short 10-digit no prefix'   => ['3331234567',      '+393331234567'],
            'whatsapp: prefix stripped'  => ['3331234567',      '+393331234567'],
        ];
    }

    public function testNormalizePreservesAlreadyFormattedNumber(): void
    {
        $this->assertStringStartsWith('+', normalizeWhatsAppNumber('+393331234567'));
    }
}
