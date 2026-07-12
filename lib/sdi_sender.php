<?php
/**
 * Pluggable SdI (Sistema di Interscambio) sender.
 *
 * Transmission to the SdI is done through an ACCREDITED INTERMEDIARY, never
 * directly by an agency's web app. This layer abstracts that intermediary so the
 * lifecycle code doesn't care which one is used:
 *
 *   SDI_PROVIDER   manual (default) | aruba | fatturaincloud | custom
 *   SDI_API_KEY    intermediary API key / token
 *   SDI_BASE_URL   intermediary API base (for custom / self-hosted)
 *
 * With SDI_PROVIDER=manual (or no key) transmission is NOT performed automatically:
 * sdiTransmit() returns a "manual" result meaning "the XML is ready — upload it to
 * your accredited channel (Aruba / Fatture in Cloud / commercialista)". This keeps
 * the flow honest: no fake "sent" status without a real channel.
 */

require_once __DIR__ . '/../config/env.php';

function sdiProvider(): string
{
    $p = strtolower((string) env('SDI_PROVIDER', 'manual'));
    return in_array($p, ['manual', 'aruba', 'fatturaincloud', 'custom'], true) ? $p : 'manual';
}

function sdiIsAutomatic(): bool
{
    return sdiProvider() !== 'manual' && (string) env('SDI_API_KEY', '') !== '';
}

/**
 * Transmit an XML invoice.
 *
 * @return array{
 *   ok:bool, manual:bool, channel:string,
 *   sdi_identificativo?:string|null, message:string
 * }
 */
function sdiTransmit(string $xml, string $filename): array
{
    $provider = sdiProvider();

    if ($provider === 'manual' || (string) env('SDI_API_KEY', '') === '') {
        return [
            'ok'      => true,
            'manual'  => true,
            'channel' => 'manuale',
            'sdi_identificativo' => null,
            'message' => 'XML pronto. Nessun intermediario configurato: scarica il file e caricalo sul tuo canale accreditato (Aruba / Fatture in Cloud / commercialista) per l\'invio allo SdI.',
        ];
    }

    if (!function_exists('curl_init')) {
        return ['ok' => false, 'manual' => false, 'channel' => $provider, 'message' => 'Estensione cURL non disponibile sul server.'];
    }

    try {
        return match ($provider) {
            'aruba'          => sdiTransmitGeneric('https://ws.fatturazioneelettronica.aruba.it', $xml, $filename, 'aruba'),
            'fatturaincloud' => sdiTransmitGeneric('https://api-v2.fattureincloud.it', $xml, $filename, 'fatturaincloud'),
            default          => sdiTransmitGeneric(rtrim((string) env('SDI_BASE_URL', ''), '/'), $xml, $filename, 'custom'),
        };
    } catch (Throwable $e) {
        return ['ok' => false, 'manual' => false, 'channel' => $provider, 'message' => 'Errore invio: ' . $e->getMessage()];
    }
}

/**
 * Generic intermediary POST. The exact endpoint/paths differ per provider and
 * must be confirmed against their docs; this is the transport scaffold that runs
 * only when SDI_API_KEY is set. It uploads the XML and expects a JSON body with
 * an identificativo SdI on success.
 */
function sdiTransmitGeneric(string $base, string $xml, string $filename, string $channel): array
{
    if ($base === '') {
        return ['ok' => false, 'manual' => false, 'channel' => $channel, 'message' => 'SDI_BASE_URL non impostato per il provider ' . $channel . '.'];
    }

    $key = (string) env('SDI_API_KEY', '');
    $ch  = curl_init($base . '/invoices'); // provider-specific path — verify in docs
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $key,
            'Content-Type: application/xml',
            'X-Filename: ' . $filename,
        ],
        CURLOPT_POSTFIELDS     => $xml,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_CONNECTTIMEOUT => 15,
    ]);
    $body   = curl_exec($ch);
    $errno  = curl_errno($ch);
    $err    = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($errno) {
        return ['ok' => false, 'manual' => false, 'channel' => $channel, 'message' => 'Errore di rete verso l\'intermediario: ' . $err];
    }
    if ($status < 200 || $status >= 300) {
        return ['ok' => false, 'manual' => false, 'channel' => $channel, 'message' => 'L\'intermediario ha risposto ' . $status . ': ' . substr((string) $body, 0, 300)];
    }

    $decoded = json_decode((string) $body, true);
    $sdiId   = is_array($decoded) ? ($decoded['sdi_id'] ?? $decoded['identificativoSdI'] ?? $decoded['id'] ?? null) : null;

    return [
        'ok'      => true,
        'manual'  => false,
        'channel' => $channel,
        'sdi_identificativo' => $sdiId !== null ? (string) $sdiId : null,
        'message' => 'Fattura trasmessa all\'intermediario.',
    ];
}
