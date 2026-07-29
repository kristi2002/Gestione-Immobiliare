<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/settings.php';

/**
 * Tests for the Impostazioni input layer (config/settings.php).
 *
 * These fields don't stay in the database: they end up in the FatturaPA XML and
 * in the pain.008 file the bank imports. A wrong IBAN produces a perfectly
 * well-formed file that the bank rejects days later, so the check has to happen
 * where the value is typed — that's what these tests pin down.
 */
class SettingsValidationTest extends TestCase
{
    // ── IBAN / Creditor Identifier ──────────────────────────────────────────

    public function testValidIbanIsAccepted(): void
    {
        $this->assertSame([], validateSettings(['agency_iban' => 'IT60X0542811101000000123456']));
    }

    public function testIbanWithATypoIsRejected(): void
    {
        $errors = validateSettings(['agency_iban' => 'IT60X0542811101000000123457']);
        $this->assertArrayHasKey('agency_iban', $errors);
    }

    public function testIbanSpacesAreNormalisedBeforeValidation(): void
    {
        $pairs = normalizeSettings(['agency_iban' => 'it60 x054 2811 1010 0000 0123 456']);
        $this->assertSame('IT60X0542811101000000123456', $pairs['agency_iban']);
        $this->assertSame([], validateSettings($pairs));
    }

    public function testValidSepaCreditorIdIsAccepted(): void
    {
        $this->assertSame([], validateSettings(['agency_sepa_creditor_id' => 'IT79ZZZA1B02C34D56E78F90']));
    }

    public function testSepaCreditorIdWithWrongCheckDigitsIsRejected(): void
    {
        $errors = validateSettings(['agency_sepa_creditor_id' => 'IT66ZZZA1B02C34D56E78F90']);
        $this->assertArrayHasKey('agency_sepa_creditor_id', $errors);
    }

    // ── Identità fiscale ────────────────────────────────────────────────────

    public function testValidPartitaIvaIsAccepted(): void
    {
        $this->assertSame([], validateSettings(['agency_piva' => '12345678903']));
    }

    public function testPartitaIvaWithWrongCheckDigitIsRejected(): void
    {
        $this->assertArrayHasKey('agency_piva', validateSettings(['agency_piva' => '12345678900']));
    }

    public function testPartitaIvaWithTooFewDigitsIsRejected(): void
    {
        $this->assertArrayHasKey('agency_piva', validateSettings(['agency_piva' => '1234567890']));
    }

    public function testCodiceFiscalePersonaFisicaIsAccepted(): void
    {
        $this->assertSame([], validateSettings(['agency_cf' => 'RSSMRA80A01H501U']));
    }

    public function testCodiceFiscaleSocietaAcceptsAValidPartitaIva(): void
    {
        $this->assertSame([], validateSettings(['agency_cf' => '12345678903']));
    }

    public function testProvinciaMustBeTwoLetters(): void
    {
        $this->assertSame([], validateSettings(normalizeSettings(['agency_provincia' => 'mc'])));
        $this->assertArrayHasKey('agency_provincia', validateSettings(['agency_provincia' => 'MCX']));
    }

    public function testCapMustBeFiveDigits(): void
    {
        $this->assertSame([], validateSettings(['agency_cap' => '62012']));
        $this->assertArrayHasKey('agency_cap', validateSettings(['agency_cap' => '620']));
    }

    public function testRegimeFiscaleOutsideTheListIsRejected(): void
    {
        $this->assertArrayHasKey('agency_regime_fiscale', validateSettings(['agency_regime_fiscale' => 'RF99']));
    }

    // ── SMTP ────────────────────────────────────────────────────────────────

    public function testNonNumericSmtpPortIsRejected(): void
    {
        // Prima veniva salvata e riletta come (int) 0: la connessione falliva
        // con un errore che non nominava la porta.
        $this->assertArrayHasKey('smtp_port', validateSettings(['smtp_port' => 'abc']));
    }

    public function testOutOfRangeSmtpPortIsRejected(): void
    {
        $this->assertArrayHasKey('smtp_port', validateSettings(['smtp_port' => '70000']));
    }

    public function testValidSmtpPortIsAccepted(): void
    {
        $this->assertSame([], validateSettings(['smtp_port' => '587']));
    }

    public function testEmptySmtpSecurityIsAcceptedAsNoEncryption(): void
    {
        $this->assertSame([], validateSettings(['smtp_secure' => '']));
    }

    public function testInvalidAgencyEmailIsRejected(): void
    {
        $this->assertArrayHasKey('agency_email', validateSettings(['agency_email' => 'non-una-email']));
    }

    public function testEnablingRealSendingWithoutAnSmtpHostIsRejected(): void
    {
        $errors = validateSettings(['mail_enabled' => true, 'smtp_host' => '', 'agency_email' => 'info@agenzia.it']);
        $this->assertArrayHasKey('smtp_host', $errors);
    }

    // ── Coerenza fra interruttore e credenziali ─────────────────────────────

    public function testClearingTheS3SecretWhileCloudBackupIsOnIsRejected(): void
    {
        // Il caso opposto a "attivo senza credenziali": la funzione è già
        // accesa e si svuota il campo da cui dipende.
        $errors = validateSettings([
            'backup_cloud_enabled' => true,
            'backup_s3_endpoint'   => 'https://s3.eu-central-1.amazonaws.com',
            'backup_s3_bucket'     => 'backups',
            'backup_s3_key'        => 'AKIA…',
            'backup_s3_secret'     => '',
        ]);
        $this->assertArrayHasKey('backup_s3_secret', $errors);
    }

    public function testDisablingCloudBackupWithEmptyCredentialsIsAllowed(): void
    {
        $this->assertSame([], validateSettings([
            'backup_cloud_enabled' => false,
            'backup_s3_endpoint'   => '',
            'backup_s3_bucket'     => '',
            'backup_s3_key'        => '',
            'backup_s3_secret'     => '',
        ]));
    }

    public function testSavingAnUnrelatedSectionDoesNotRaiseMailErrors(): void
    {
        // Trovato provando dal vivo: con l'invio email attivo ma senza host,
        // salvare Fatturazione rispondeva 422 su smtp_host — un campo che quel
        // modulo non contiene e che l'utente non poteva correggere da lì.
        $_ENV['TEST_SETTING_MAIL_ENABLED'] = 'true';
        $_ENV['TEST_SETTING_SMTP_HOST']    = '';
        try {
            $errors = validateSettings(['agency_comune' => 'Civitanova Marche']);
            $this->assertSame([], $errors);
        } finally {
            unset($_ENV['TEST_SETTING_MAIL_ENABLED'], $_ENV['TEST_SETTING_SMTP_HOST']);
        }
    }

    public function testEnablingWhatsAppWithoutCredentialsIsRejected(): void
    {
        $errors = validateSettings([
            'whatsapp_enabled'     => true,
            'twilio_account_sid'   => '',
            'twilio_auth_token'    => '',
            'twilio_whatsapp_from' => '',
        ]);
        $this->assertArrayHasKey('twilio_account_sid', $errors);
        $this->assertArrayHasKey('twilio_auth_token', $errors);
        $this->assertArrayHasKey('twilio_whatsapp_from', $errors);
    }

    // ── Branding / integrazioni ─────────────────────────────────────────────

    public function testAgencyNameCannotBeEmptied(): void
    {
        $this->assertArrayHasKey('agency_name', validateSettings(['agency_name' => '   ']));
    }

    public function testColourMustBeHexadecimal(): void
    {
        $this->assertSame([], validateSettings(['primary_color' => '#206bac']));
        $this->assertArrayHasKey('primary_color', validateSettings(['primary_color' => 'blu']));
    }

    public function testColourWithoutHashIsNormalised(): void
    {
        $pairs = normalizeSettings(['primary_color' => '206BAC']);
        $this->assertSame('#206bac', $pairs['primary_color']);
        $this->assertSame([], validateSettings($pairs));
    }

    public function testWhatsAppNumberMustBeInternational(): void
    {
        $this->assertSame([], validateSettings(['twilio_whatsapp_from' => '+14155238886']));
        $this->assertArrayHasKey('twilio_whatsapp_from', validateSettings(['twilio_whatsapp_from' => '3331234567']));
    }

    public function testWhatsAppPrefixIsStrippedOnNormalisation(): void
    {
        $pairs = normalizeSettings(['twilio_whatsapp_from' => 'whatsapp:+14155238886']);
        $this->assertSame('+14155238886', $pairs['twilio_whatsapp_from']);
    }

    public function testBackupPrefixAlwaysEndsWithASlash(): void
    {
        $pairs = normalizeSettings(['backup_s3_prefix' => '/gestionale-backups']);
        $this->assertSame('gestionale-backups/', $pairs['backup_s3_prefix']);
    }

    public function testBackupEndpointMustBeAUrl(): void
    {
        $this->assertArrayHasKey('backup_s3_endpoint', validateSettings(['backup_s3_endpoint' => 's3.amazonaws.com']));
    }

    public function testEmptyOptionalFieldsAreAccepted(): void
    {
        // Svuotare un campo facoltativo è una scelta legittima, non un errore.
        $this->assertSame([], validateSettings([
            'agency_piva' => '', 'agency_cf' => '', 'agency_iban' => '',
            'agency_sepa_creditor_id' => '', 'agency_pec' => '', 'agency_cap' => '',
        ]));
    }
}
