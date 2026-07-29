<?php

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../config/password.php';

/**
 * Hashing password: algoritmo preferito, fallback, e migrazione al login.
 *
 * Il test che conta davvero e' l'ultimo gruppo: se l'upgrade non e' silenzioso e
 * non-bloccante, un errore di scrittura durante la manutenzione trasformerebbe un
 * login valido in un login rifiutato.
 */
class PasswordTest extends TestCase
{
    public function testHashIsVerifiable(): void
    {
        $hash = appPasswordHash('CorrectHorseBattery1');

        $this->assertTrue(password_verify('CorrectHorseBattery1', $hash));
        $this->assertFalse(password_verify('CorrectHorseBattery2', $hash));
    }

    public function testPrefersArgon2idWhenTheRuntimeHasIt(): void
    {
        if (appPasswordAlgo() === null) {
            $this->markTestSkipped('PHP compilato senza libargon2: si resta su bcrypt (fallback voluto).');
        }

        $info = password_get_info(appPasswordHash('CorrectHorseBattery1'));
        $this->assertSame('argon2id', $info['algoName']);
    }

    /** Un hash appena prodotto non deve mai chiedere di essere rifatto. */
    public function testFreshHashDoesNotNeedRehash(): void
    {
        $this->assertFalse(appPasswordNeedsRehash(appPasswordHash('CorrectHorseBattery1')));
    }

    /**
     * Il caso della migrazione: gli account esistenti sono tutti bcrypt, e senza
     * questo lo resterebbero per sempre.
     */
    public function testLegacyBcryptHashNeedsRehash(): void
    {
        if (appPasswordAlgo() === null) {
            $this->markTestSkipped('Senza argon2id bcrypt e- gia- l-algoritmo corrente.');
        }

        $bcrypt = password_hash('CorrectHorseBattery1', PASSWORD_BCRYPT);
        $this->assertTrue(appPasswordNeedsRehash($bcrypt));
    }

    public function testUpgradeRewritesLegacyHashAndKeepsThePasswordValid(): void
    {
        if (appPasswordAlgo() === null) {
            $this->markTestSkipped('Nessun upgrade da fare su questo runtime.');
        }

        $bcrypt  = password_hash('CorrectHorseBattery1', PASSWORD_BCRYPT);
        $written = null;

        appPasswordUpgrade('CorrectHorseBattery1', $bcrypt, function (string $hash) use (&$written) {
            $written = $hash;
        });

        $this->assertNotNull($written, 'Il nuovo hash doveva essere persistito');
        $this->assertSame('argon2id', password_get_info($written)['algoName']);
        $this->assertTrue(password_verify('CorrectHorseBattery1', $written));
    }

    public function testUpgradeDoesNothingWhenTheHashIsAlreadyCurrent(): void
    {
        $called = false;

        appPasswordUpgrade('CorrectHorseBattery1', appPasswordHash('CorrectHorseBattery1'), function () use (&$called) {
            $called = true;
        });

        $this->assertFalse($called, 'Nessuna UPDATE inutile a ogni login');
    }

    /**
     * Una UPDATE fallita durante l-upgrade non deve buttare fuori chi ha appena
     * inserito la password giusta.
     */
    public function testUpgradeSwallowsPersistenceFailures(): void
    {
        if (appPasswordAlgo() === null) {
            $this->markTestSkipped('Nessun upgrade da fare su questo runtime.');
        }

        $bcrypt = password_hash('CorrectHorseBattery1', PASSWORD_BCRYPT);

        appPasswordUpgrade('CorrectHorseBattery1', $bcrypt, function () {
            throw new RuntimeException('DB in sola lettura');
        });

        $this->addToAssertionCount(1);   // arrivare qui senza eccezione E- il test
    }
}
