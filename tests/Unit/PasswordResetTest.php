<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/password_reset.php';

/**
 * Parte pura del flusso di reset (quella che non tocca il database).
 *
 * Il resto — emissione, uso singolo, revoca, scadenza, corsa fra due invii —
 * vive solo contro MySQL vero e sta nello script di integrazione: qui si copre
 * cio' che puo' girare in CI senza un database.
 */
class PasswordResetTest extends TestCase
{
    public function testTokenHashIsSha256AndNotReversible(): void
    {
        $token = bin2hex(random_bytes(32));

        $hash = passwordResetTokenHash($token);

        $this->assertSame(hash('sha256', $token), $hash);
        $this->assertSame(64, strlen($hash));
        $this->assertStringNotContainsString($token, $hash);
    }

    public function testTokenHashIsStable(): void
    {
        $this->assertSame(passwordResetTokenHash('abc'), passwordResetTokenHash('abc'));
        $this->assertNotSame(passwordResetTokenHash('abc'), passwordResetTokenHash('abd'));
    }

    /**
     * Un token malformato non deve nemmeno arrivare alla query. Si passa null
     * come connessione: se il controllo di forma sparisse, il test morirebbe con
     * un TypeError invece di restituire null — ed e' esattamente cio' che si
     * vuole sapere.
     */
    public function testMalformedTokensAreRejectedBeforeTouchingTheDatabase(): void
    {
        foreach (['', 'abc', 'non-un-token', str_repeat('z', 64), str_repeat('a', 63), str_repeat('A', 64)] as $bad) {
            $this->assertNull(
                passwordResetFind(new PDO('sqlite::memory:'), $bad),
                "Token rifiutato: '{$bad}'"
            );
        }
    }

    public function testEmailCarriesTheLinkAndSaysTheAgencyCannotSeeThePassword(): void
    {
        $link = 'https://esempio.it/reset_password.php?token=' . str_repeat('a', 64);

        $mail = passwordResetEmail('Mario Rossi', $link, '2026-07-30 12:00:00', 'Orlandi Immobiliare');

        $this->assertStringContainsString($link, $mail['body']);
        $this->assertStringContainsString('Mario Rossi', $mail['body']);
        $this->assertStringContainsString('30/07/2026', $mail['body'], 'La scadenza va detta in chiaro');
        $this->assertStringContainsString('una sola volta', $mail['body']);
        $this->assertStringContainsString('non la vede', $mail['body']);
        $this->assertStringContainsString('Orlandi Immobiliare', $mail['subject']);
    }

    /** Senza nome il messaggio non deve aprirsi con una virgola orfana. */
    public function testEmailFallsBackWhenTheNameIsEmpty(): void
    {
        $mail = passwordResetEmail('   ', 'https://x.it/r?token=1', '2026-07-30 12:00:00', 'Agenzia');

        $this->assertStringStartsWith('Gentile utente,', $mail['body']);
    }

    public function testSubjectAndTtlAreTheDocumentedOnes(): void
    {
        $this->assertSame(['tenant', 'owner'], PASSWORD_RESET_SUBJECTS);
        $this->assertSame(24, PASSWORD_RESET_TTL_HOURS);
        $this->assertSame(8, PASSWORD_MIN_LENGTH);
    }
}
