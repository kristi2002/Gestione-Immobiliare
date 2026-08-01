<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Tests for config/whatsapp.php
 *
 * parseMetaWebhook() and normalizeWhatsAppNumber() are pure functions
 * with no external dependencies — ideal for unit testing.
 */
class WhatsAppTest extends TestCase
{
    // ── parseMetaWebhook ────────────────────────────────────────────────────────

    /** Il payload di Meta, nella forma in cui arriva davvero. */
    private static function metaPayload(array $message, array $statuses = []): array
    {
        return [
            'entry' => [[
                'changes' => [[
                    'value' => [
                        'metadata' => ['display_phone_number' => '393401112233'],
                        'messages' => $message ? [$message] : [],
                        'statuses' => $statuses,
                    ],
                ]],
            ]],
        ];
    }

    public function testParseMetaWebhookExtractsAllFields(): void
    {
        $parsed = parseMetaWebhook(self::metaPayload([
            'from' => '393331234567',
            'id'   => 'wamid.ABC123',
            'type' => 'text',
            'text' => ['body' => 'Ciao, info sull\'appartamento'],
        ]));

        $this->assertCount(1, $parsed['messages']);
        $msg = $parsed['messages'][0];

        // Meta consegna il numero senza "+": va rimesso, perché è la forma su
        // cui tutta l'applicazione raggruppa le conversazioni.
        $this->assertSame('+393331234567', $msg['from']);
        $this->assertSame('+393401112233', $msg['to']);
        $this->assertSame("Ciao, info sull'appartamento", $msg['body']);
        $this->assertSame('wamid.ABC123', $msg['external_id']);
        $this->assertSame([], $msg['media']);
    }

    public function testParseMetaWebhookHandlesEmptyPayload(): void
    {
        $parsed = parseMetaWebhook([]);

        $this->assertSame([], $parsed['messages']);
        $this->assertSame([], $parsed['statuses']);
    }

    public function testParseMetaWebhookReadsImageCaptionAsBody(): void
    {
        $parsed = parseMetaWebhook(self::metaPayload([
            'from'  => '393331234567',
            'id'    => 'wamid.IMG',
            'type'  => 'image',
            'image' => ['id' => '1234567890', 'mime_type' => 'image/jpeg', 'caption' => 'La caldaia che perde'],
        ]));

        $msg = $parsed['messages'][0];
        $this->assertSame('La caldaia che perde', $msg['body']);
        $this->assertSame([['id' => '1234567890', 'mime' => 'image/jpeg', 'filename' => '']], $msg['media']);
    }

    /**
     * Una foto senza didascalia: corpo vuoto ma allegato presente. È il caso che
     * il vecchio webhook scartava come "messaggio vuoto", perdendolo del tutto.
     */
    public function testParseMetaWebhookKeepsMediaWithoutCaption(): void
    {
        $parsed = parseMetaWebhook(self::metaPayload([
            'from'  => '393331234567',
            'id'    => 'wamid.NOCAPTION',
            'type'  => 'image',
            'image' => ['id' => '999', 'mime_type' => 'image/jpeg'],
        ]));

        $msg = $parsed['messages'][0];
        $this->assertSame('', $msg['body']);
        $this->assertNotEmpty($msg['media']);
    }

    public function testParseMetaWebhookReadsDocumentFilename(): void
    {
        $parsed = parseMetaWebhook(self::metaPayload([
            'from'     => '393331234567',
            'id'       => 'wamid.DOC',
            'type'     => 'document',
            'document' => ['id' => '77', 'mime_type' => 'application/pdf', 'filename' => 'contratto.pdf'],
        ]));

        $this->assertSame('contratto.pdf', $parsed['messages'][0]['media'][0]['filename']);
    }

    public function testParseMetaWebhookExtractsDeliveryStatuses(): void
    {
        $parsed = parseMetaWebhook(self::metaPayload([], [[
            'id'           => 'wamid.SENT',
            'status'       => 'delivered',
            'recipient_id' => '393331234567',
        ]]));

        $this->assertSame([], $parsed['messages']);
        $this->assertCount(1, $parsed['statuses']);
        $this->assertSame('wamid.SENT', $parsed['statuses'][0]['external_id']);
        $this->assertSame('delivered', $parsed['statuses'][0]['status']);
        $this->assertSame('+393331234567', $parsed['statuses'][0]['recipient']);
    }

    public function testParseMetaWebhookPreservesUnicodeBody(): void
    {
        $parsed = parseMetaWebhook(self::metaPayload([
            'from' => '393331234567',
            'id'   => 'wamid.UNI',
            'type' => 'text',
            'text' => ['body' => 'Ciao! 🏠 Appartamento disponibile?'],
        ]));

        $this->assertSame('Ciao! 🏠 Appartamento disponibile?', $parsed['messages'][0]['body']);
    }

    // ── metaStatusToCommStatus ──────────────────────────────────────────────────

    #[DataProvider('metaStatusProvider')]
    public function testMetaStatusToCommStatus(string $meta, string $expected): void
    {
        $this->assertSame($expected, metaStatusToCommStatus($meta));
    }

    public static function metaStatusProvider(): array
    {
        return [
            'accepted → queued'   => ['accepted',  'queued'],
            'sent → sent'         => ['sent',      'sent'],
            'delivered'           => ['delivered', 'delivered'],
            'read'                => ['read',      'read'],
            'failed'              => ['failed',    'failed'],
            'sconosciuto → sent'  => ['boh',       'sent'],
        ];
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
            // I prefissi 391/392/393 (Wind Tre, Very Mobile) iniziano per "39" e
            // sembravano numeri che il prefisso internazionale ce l'avevano già:
            // "393 1234567" diventava +3931234567, dieci cifre che non esistono.
            'Wind Tre 393 keeps prefix'  => ['3931234567',      '+393931234567'],
            'Iliad 391 keeps prefix'     => ['3911234567',      '+393911234567'],
            'already E.164 393 mobile'   => ['+393931234567',   '+393931234567'],
            // I fissi italiani TENGONO lo zero in formato internazionale: il
            // prefisso di Civitanova è 0733, non 733. Toglierlo (come faceva la
            // vecchia regola "via lo zero iniziale, sempre") produceva
            // +39733123456, che non è il numero di nessuno.
            'Italian landline keeps 0'   => ['0733123456',      '+390733123456'],
            'Milan landline keeps 0'     => ['021234567',       '+39021234567'],
            'landline with 00 prefix'    => ['00390733123456',  '+390733123456'],
        ];
    }

    public function testNormalizePreservesAlreadyFormattedNumber(): void
    {
        $this->assertStringStartsWith('+', normalizeWhatsAppNumber('+393331234567'));
    }
}
