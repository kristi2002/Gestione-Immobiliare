<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Tests for config/meta.php
 *
 * Tests pure/deterministic functions: isMetaConfigured(), maskToken(), publicSocialSettings().
 * publishSocialPost() and HTTP-calling functions are not tested here — they require
 * a live Meta API or a mock HTTP client (future work).
 */
class MetaTest extends TestCase
{
    // ── isMetaConfigured ────────────────────────────────────────────────────────

    public function testIsMetaConfiguredReturnsTrueWhenBothTokensPresent(): void
    {
        $settings = [
            'facebook_page_id'    => '123456789',
            'facebook_page_token' => 'EAABcdef...',
        ];

        $this->assertTrue(isMetaConfigured($settings));
    }

    public function testIsMetaConfiguredReturnsFalseWhenPageIdMissing(): void
    {
        $settings = [
            'facebook_page_id'    => '',
            'facebook_page_token' => 'EAABcdef...',
        ];

        $this->assertFalse(isMetaConfigured($settings));
    }

    public function testIsMetaConfiguredReturnsFalseWhenPageTokenMissing(): void
    {
        $settings = [
            'facebook_page_id'    => '123456789',
            'facebook_page_token' => '',
        ];

        $this->assertFalse(isMetaConfigured($settings));
    }

    public function testIsMetaConfiguredReturnsFalseWhenEmpty(): void
    {
        $this->assertFalse(isMetaConfigured([]));
    }

    #[DataProvider('unconfiguredSettingsProvider')]
    public function testIsMetaConfiguredReturnsFalseForVariousUnconfigured(array $settings): void
    {
        $this->assertFalse(isMetaConfigured($settings));
    }

    public static function unconfiguredSettingsProvider(): array
    {
        return [
            'empty array'              => [[]],
            'only page id'             => [['facebook_page_id' => '123']],
            'only page token'          => [['facebook_page_token' => 'tok']],
            'null values'              => [['facebook_page_id' => null, 'facebook_page_token' => null]],
        ];
    }

    // ── maskToken ───────────────────────────────────────────────────────────────

    public function testMaskTokenHidesMiddleOfLongToken(): void
    {
        $token  = 'EAABwzLixnjYBOZBFxyz1234567890abcdef';
        $masked = maskToken($token);

        $this->assertNotNull($masked);
        // Implementation uses bullet chars (••••••••) + last 4
        $this->assertStringContainsString('••••••••', $masked);
        $this->assertStringEndsWith('cdef', $masked);
    }

    public function testMaskTokenReturnsNullForNull(): void
    {
        $this->assertNull(maskToken(null));
    }

    public function testMaskTokenHandlesShortToken(): void
    {
        $result = maskToken('short'); // strlen 5 < 8 → returns '••••••••'
        $this->assertNotNull($result);
        $this->assertIsString($result);
        $this->assertStringContainsString('••••••••', $result);
    }

    // ── publicSocialSettings ────────────────────────────────────────────────────

    public function testPublicSocialSettingsMasksPageToken(): void
    {
        $settings = [
            'meta_app_id'          => '12345',
            'meta_user_token'      => 'EAABusertoken1234567890', // not exposed publicly
            'facebook_page_id'     => '99887766',
            'facebook_page_token'  => 'EAABpagetoken9876543210',
            'instagram_account_id' => '55443322',
            'token_expires_at'     => '2026-09-01 00:00:00',
        ];

        $public = publicSocialSettings($settings);

        // Non-sensitive IDs are visible
        $this->assertSame('12345', $public['meta_app_id']);
        $this->assertSame('99887766', $public['facebook_page_id']);
        $this->assertSame('55443322', $public['instagram_account_id']);

        // Page token is masked with bullet chars
        $this->assertStringContainsString('••••••••', $public['facebook_page_token']);

        // meta_user_token is NOT included in public output
        $this->assertArrayNotHasKey('meta_user_token', $public);

        // Computed booleans are present
        $this->assertArrayHasKey('is_connected', $public);
        $this->assertArrayHasKey('has_instagram', $public);
        $this->assertTrue($public['is_connected']);
        $this->assertTrue($public['has_instagram']);
    }

    public function testPublicSocialSettingsHandlesEmptySettings(): void
    {
        $public = publicSocialSettings([]);
        $this->assertIsArray($public);
    }
}
