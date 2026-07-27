<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Tests for the automation scheduling + templating engine (phase66).
 *
 * Two of these lock down bugs that were live in production:
 *
 *  1. PHP's '+1 month' from 31 January lands on 3 MARCH — a monthly automation
 *     started on the 29th-31st skipped February and drifted forever.
 *  2. DateTime::createFromFormat('Y-m-d', …) inherits the current clock, so a
 *     date-only form value scheduled the send for whatever time the agent
 *     happened to hit Save. (Covered by the anchor tests below.)
 */
class AutomationScheduleTest extends TestCase
{
    // ── Deriva mensile ──────────────────────────────────────────────────────

    public function testMonthlyStepFromEndOfMonthDoesNotOverflow(): void
    {
        // Comportamento nativo di PHP, per contrasto: 2026-03-03.
        $native = (new \DateTime('2026-01-31'))->modify('+1 month')->format('Y-m-d');
        $this->assertSame('2026-03-03', $native, 'baseline: PHP overflows here');

        $next = calculateNextReminderDate('2026-01-31 09:00:00', 'monthly');
        $this->assertSame('2026-02-28', substr($next, 0, 10));
    }

    public function testMonthlySeriesWithDayRuleSelfHeals(): void
    {
        // 31 → 28 (febbraio) → 31 (marzo): il giorno viene riderivato ogni mese
        // invece di essere trascinato, quindi non resta bloccato a 28.
        $feb = calculateNextReminderDate('2026-01-31 09:00:00', 'monthly', 'dom:31');
        $mar = calculateNextReminderDate($feb, 'monthly', 'dom:31');
        $apr = calculateNextReminderDate($mar, 'monthly', 'dom:31');

        $this->assertSame('2026-02-28', substr($feb, 0, 10));
        $this->assertSame('2026-03-31', substr($mar, 0, 10));
        $this->assertSame('2026-04-30', substr($apr, 0, 10));
    }

    public function testDefaultDayRuleIsDerivedFromStartDate(): void
    {
        $rule = effectiveReminderDayRule([
            'frequency'     => 'monthly',
            'reminder_date' => '2026-01-31 09:00:00',
            'day_rule'      => null,
        ]);
        $this->assertSame('dom:31', $rule);
    }

    public function testWeeklyFrequenciesGetNoDayRule(): void
    {
        // Snappare una quindicinale a un giorno del mese ne annullerebbe la
        // cadenza: +15 giorni deve restare +15 giorni.
        foreach (['weekly', 'biweekly'] as $freq) {
            $this->assertNull(effectiveReminderDayRule([
                'frequency'     => $freq,
                'reminder_date' => '2026-01-31 09:00:00',
                'day_rule'      => null,
            ]), $freq);
        }
    }

    public function testBiweeklyKeepsFifteenDayCadence(): void
    {
        $next = calculateNextReminderDate('2026-01-01 09:00:00', 'biweekly');
        $this->assertSame('2026-01-16', substr($next, 0, 10));
    }

    // ── Ora di invio ────────────────────────────────────────────────────────

    public function testScheduleTimeIsAppliedToEveryStep(): void
    {
        $next = calculateNextReminderDate('2026-01-15 23:47:11', 'monthly', null, '09:30');
        $this->assertSame('2026-02-15 09:30:00', $next);
    }

    public function testAnchorForcesTheChosenTime(): void
    {
        // È il caso reale del form: data senza ora + ora di invio scelta.
        $anchor = normalizeReminderAnchor('2026-08-26 00:00:00', 'monthly', null, '09:30');
        $this->assertSame('2026-08-26 09:30:00', $anchor);
    }

    // ── Regole del giorno ───────────────────────────────────────────────────

    public function testFirstMondayRule(): void
    {
        // 1 marzo 2026 è una domenica → il primo lunedì è il 2.
        $dt = new \DateTime('2026-03-20 10:00:00');
        applyReminderDayRule($dt, 'nth:1:1');
        $this->assertSame('2026-03-02', $dt->format('Y-m-d'));
        $this->assertSame('10:00', $dt->format('H:i'), 'la regola non tocca l\'ora');
    }

    public function testLastFridayRule(): void
    {
        $dt = new \DateTime('2026-03-10 10:00:00');
        applyReminderDayRule($dt, 'nth:last:5');
        $this->assertSame('2026-03-27', $dt->format('Y-m-d'));
        $this->assertSame('5', $dt->format('N'));
    }

    public function testNthRuleFallsBackWhenTheMonthIsTooShort(): void
    {
        // Febbraio 2026 inizia di domenica: il "quarto lunedì" è il 23, e un
        // quinto non esiste — non deve sconfinare a marzo.
        $dt = new \DateTime('2026-02-10 08:00:00');
        applyReminderDayRule($dt, 'nth:4:1');
        $this->assertSame('2026-02-23', $dt->format('Y-m-d'));
        $this->assertSame('2', $dt->format('n'));
    }

    public function testLastDayOfMonthRule(): void
    {
        $dt = new \DateTime('2026-02-10 08:00:00');
        applyReminderDayRule($dt, 'dom:last');
        $this->assertSame('2026-02-28', $dt->format('Y-m-d'));
    }

    public function testDayOfMonthIsClampedNotOverflowed(): void
    {
        $dt = new \DateTime('2026-02-10 08:00:00');
        applyReminderDayRule($dt, 'dom:31');
        $this->assertSame('2026-02-28', $dt->format('Y-m-d'));
    }

    public function testAnchorMovesForwardWhenTheRuleDayHasPassed(): void
    {
        // "Il 1 del mese" scelto il 26 agosto parte a settembre, non torna
        // indietro al 1 agosto.
        $anchor = normalizeReminderAnchor('2026-08-26 00:00:00', 'monthly', 'dom:1', '09:00');
        $this->assertSame('2026-09-01 09:00:00', $anchor);
    }

    public function testAnchorStaysInMonthWhenTheRuleDayIsStillAhead(): void
    {
        $anchor = normalizeReminderAnchor('2026-08-05 00:00:00', 'monthly', 'dom:28', '09:00');
        $this->assertSame('2026-08-28 09:00:00', $anchor);
    }

    // ── Token ───────────────────────────────────────────────────────────────

    public function testTokensAreReplacedAtSendTime(): void
    {
        $ctx  = buildAutomationContext([
            'client_email'     => 'roberto@example.it',
            'client_name'      => 'Roberto',
            'client_surname'   => 'Bianchi',
            'property_address' => 'Via Tortona 28',
            'property_city'    => 'Civitanova Marche',
            'property_price'   => '250000.00',
        ]);

        $out = renderAutomationTemplate(
            'Gentile {{contatto.nome}}, {{immobile.indirizzo}} ({{immobile.citta}}) — {{immobile.prezzo}}',
            $ctx
        );

        $this->assertSame(
            'Gentile Roberto, Via Tortona 28 (Civitanova Marche) — € 250.000',
            $out
        );
    }

    public function testUnknownTokenIsBlankedNotLeaked(): void
    {
        // Un cliente vero non deve mai ricevere '{{contatto.inventato}}'.
        $out = renderAutomationTemplate('Ciao {{contatto.inventato}}!', buildAutomationContext([]));
        $this->assertSame('Ciao !', $out);
    }

    public function testPartialRenderKeepsUnresolvedTokens(): void
    {
        // Materializzazione da evento: i token d'evento si risolvono subito, il
        // resto resta da risolvere all'invio.
        $out = renderAutomationTemplate(
            'Ribasso: da {{evento.prezzo_precedente}} a {{evento.prezzo_attuale}} — {{contatto.nome}}',
            ['evento.prezzo_precedente' => '€ 300.000', 'evento.prezzo_attuale' => '€ 250.000'],
            true
        );
        $this->assertSame('Ribasso: da € 300.000 a € 250.000 — {{contatto.nome}}', $out);
    }

    public function testContactTokensFollowRecipientPrecedence(): void
    {
        // Stesso ordine di reminderRecipient(): il nome nel testo e il
        // destinatario in busta devono essere la stessa persona.
        $ctx = buildAutomationContext([
            'lead_email'   => 'lead@example.it',
            'lead_name'    => 'Giulia',
            'lead_surname' => 'Verdi',
            'tenant_email' => 'inquilino@example.it',
            'tenant_first_name' => 'Marco',
            'tenant_surname'    => 'Neri',
        ]);
        $this->assertSame('Giulia', $ctx['contatto.nome']);
        $this->assertSame('Giulia Verdi', $ctx['contatto.nome_completo']);
    }

    public function testMissingContactFallsBackToGenericSalutation(): void
    {
        $ctx = buildAutomationContext([]);
        $this->assertSame('Cliente', $ctx['contatto.nome']);
    }

    public function testPriceFormattingIsItalian(): void
    {
        $this->assertSame('€ 1.250.000', automationFormatPrice(1250000));
        $this->assertSame('', automationFormatPrice(null));
    }

    // ── Destinatario ────────────────────────────────────────────────────────

    public function testRecipientReportsItsType(): void
    {
        $r = reminderRecipient(['tenant_email' => 'i@example.it', 'tenant_first_name' => 'Marco', 'tenant_surname' => 'Neri']);
        $this->assertSame('tenant', $r['type']);
        $this->assertSame('i@example.it', $r['email']);
    }

    public function testRecipientTypeSurvivesAMissingEmail(): void
    {
        // Il registro invii deve poter distinguere «contatto senza email» da
        // «nessun contatto collegato».
        $r = reminderRecipient(['client_id' => 7, 'client_email' => '']);
        $this->assertSame('client', $r['type']);
        $this->assertSame('', $r['email']);

        $none = reminderRecipient([]);
        $this->assertSame('none', $none['type']);
    }
}
