<?php
/**
 * FatturaPA 1.2.2 XML generator (fattura elettronica verso privati — FPR12).
 *
 * Builds a structurally valid <FatturaElettronica> from an invoice row + the
 * agency (cedente/prestatore) fiscal identity + the customer (cessionario)
 * details. It does NOT transmit to the SdI — transmission is delegated to an
 * accredited intermediary (Aruba / Fatture in Cloud / commercialista). See
 * fatturaPaMissingAgencyFields() to warn about incomplete agency data.
 *
 * References: specifiche tecniche Agenzia delle Entrate, formato 1.2.2.
 */

/**
 * @param array<string,mixed> $invoice   invoice row (with client_/lead_ joins)
 * @param array<string,string> $agency   agency fiscal identity (from settings)
 * @param array<string,mixed> $customer  cessionario data
 * @param int $progressivo               transmission progressive number
 */
function fatturaPaBuildXml(array $invoice, array $agency, array $customer, int $progressivo = 1): string
{
    $dom = new DOMDocument('1.0', 'UTF-8');
    $dom->formatOutput = true;

    $ns   = 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2';
    $root = $dom->createElementNS($ns, 'p:FatturaElettronica');
    $root->setAttribute('versione', 'FPR12');
    $dom->appendChild($root);

    // ── Header ────────────────────────────────────────────────────────────
    $header = $dom->createElement('FatturaElettronicaHeader');
    $root->appendChild($header);

    // DatiTrasmissione
    $dt = $dom->createElement('DatiTrasmissione');
    $header->appendChild($dt);
    $idTx = $dom->createElement('IdTrasmittente');
    $idTx->appendChild($dom->createElement('IdPaese', 'IT'));
    $idTx->appendChild($dom->createElement('IdCodice', fpaVal($agency['piva'] ?? $agency['cf'] ?? '00000000000')));
    $dt->appendChild($idTx);
    $dt->appendChild($dom->createElement('ProgressivoInvio', substr((string) $progressivo, 0, 10)));
    $dt->appendChild($dom->createElement('FormatoTrasmissione', 'FPR12'));

    $codDest = strtoupper(trim((string) ($customer['codice_destinatario'] ?? '')));
    $pecDest = trim((string) ($customer['pec'] ?? ''));
    if ($codDest === '' && $pecDest === '') {
        $codDest = '0000000'; // privato senza canale telematico
    }
    if ($codDest !== '') {
        $dt->appendChild($dom->createElement('CodiceDestinatario', $codDest));
    }
    if (($codDest === '' || $codDest === '0000000') && $pecDest !== '') {
        $dt->appendChild($dom->createElement('PECDestinatario', fpaVal($pecDest)));
    }

    // CedentePrestatore (agency)
    $cedente = $dom->createElement('CedentePrestatore');
    $header->appendChild($cedente);
    $cedAna = $dom->createElement('DatiAnagrafici');
    $cedente->appendChild($cedAna);
    if (!empty($agency['piva'])) {
        $iva = $dom->createElement('IdFiscaleIVA');
        $iva->appendChild($dom->createElement('IdPaese', 'IT'));
        $iva->appendChild($dom->createElement('IdCodice', fpaVal($agency['piva'])));
        $cedAna->appendChild($iva);
    }
    if (!empty($agency['cf'])) {
        $cedAna->appendChild($dom->createElement('CodiceFiscale', fpaVal($agency['cf'])));
    }
    $cedAnag = $dom->createElement('Anagrafica');
    $cedAnag->appendChild($dom->createElement('Denominazione', fpaVal($agency['denominazione'] ?? 'Agenzia')));
    $cedAna->appendChild($cedAnag);
    $cedAna->appendChild($dom->createElement('RegimeFiscale', fpaVal($agency['regime_fiscale'] ?? 'RF01')));

    $cedSede = $dom->createElement('Sede');
    $cedSede->appendChild($dom->createElement('Indirizzo', fpaVal($agency['indirizzo'] ?? 'N/D')));
    $cedSede->appendChild($dom->createElement('CAP', fpaCap($agency['cap'] ?? '')));
    $cedSede->appendChild($dom->createElement('Comune', fpaVal($agency['comune'] ?? 'N/D')));
    if (!empty($agency['provincia'])) {
        $cedSede->appendChild($dom->createElement('Provincia', fpaProv($agency['provincia'])));
    }
    $cedSede->appendChild($dom->createElement('Nazione', 'IT'));
    $cedente->appendChild($cedSede);

    // CessionarioCommittente (customer)
    $cess = $dom->createElement('CessionarioCommittente');
    $header->appendChild($cess);
    $cessAna = $dom->createElement('DatiAnagrafici');
    $cess->appendChild($cessAna);
    if (!empty($customer['piva'])) {
        $iva = $dom->createElement('IdFiscaleIVA');
        $iva->appendChild($dom->createElement('IdPaese', 'IT'));
        $iva->appendChild($dom->createElement('IdCodice', fpaVal($customer['piva'])));
        $cessAna->appendChild($iva);
    }
    if (!empty($customer['cf'])) {
        $cessAna->appendChild($dom->createElement('CodiceFiscale', fpaVal($customer['cf'])));
    }
    $cessAnag = $dom->createElement('Anagrafica');
    if (!empty($customer['denominazione'])) {
        $cessAnag->appendChild($dom->createElement('Denominazione', fpaVal($customer['denominazione'])));
    } else {
        $cessAnag->appendChild($dom->createElement('Nome', fpaVal($customer['nome'] ?? 'N/D')));
        $cessAnag->appendChild($dom->createElement('Cognome', fpaVal($customer['cognome'] ?? 'N/D')));
    }
    $cessAna->appendChild($cessAnag);

    $cessSede = $dom->createElement('Sede');
    $cessSede->appendChild($dom->createElement('Indirizzo', fpaVal($customer['indirizzo'] ?? 'N/D')));
    $cessSede->appendChild($dom->createElement('CAP', fpaCap($customer['cap'] ?? '')));
    $cessSede->appendChild($dom->createElement('Comune', fpaVal($customer['comune'] ?? 'N/D')));
    if (!empty($customer['provincia'])) {
        $cessSede->appendChild($dom->createElement('Provincia', fpaProv($customer['provincia'])));
    }
    $cessSede->appendChild($dom->createElement('Nazione', 'IT'));
    $cess->appendChild($cessSede);

    // ── Body ──────────────────────────────────────────────────────────────
    $body = $dom->createElement('FatturaElettronicaBody');
    $root->appendChild($body);

    $amount    = round((float) ($invoice['amount'] ?? 0), 2);
    $vatRate   = round((float) ($invoice['vat_rate'] ?? 0), 2);
    $vatAmount = round($amount * $vatRate / 100, 2);
    $total     = round($amount + $vatAmount, 2);

    $datiGen = $dom->createElement('DatiGenerali');
    $body->appendChild($datiGen);
    $dgd = $dom->createElement('DatiGeneraliDocumento');
    $datiGen->appendChild($dgd);
    $dgd->appendChild($dom->createElement('TipoDocumento', 'TD01')); // fattura
    $dgd->appendChild($dom->createElement('Divisa', 'EUR'));
    $dgd->appendChild($dom->createElement('Data', substr((string) ($invoice['issue_date'] ?? ''), 0, 10)));
    $dgd->appendChild($dom->createElement('Numero', fpaVal((string) ($invoice['invoice_number'] ?? '1'))));
    $dgd->appendChild($dom->createElement('ImportoTotaleDocumento', fpaNum($total)));

    $dbs = $dom->createElement('DatiBeniServizi');
    $body->appendChild($dbs);
    $linea = $dom->createElement('DettaglioLinee');
    $dbs->appendChild($linea);
    $linea->appendChild($dom->createElement('NumeroLinea', '1'));
    $linea->appendChild($dom->createElement('Descrizione', fpaVal((string) ($invoice['description'] ?? 'Servizio')) ?: 'Servizio'));
    $linea->appendChild($dom->createElement('Quantita', '1.00'));
    $linea->appendChild($dom->createElement('PrezzoUnitario', fpaNum($amount)));
    $linea->appendChild($dom->createElement('PrezzoTotale', fpaNum($amount)));
    $linea->appendChild($dom->createElement('AliquotaIVA', fpaNum($vatRate)));

    $riep = $dom->createElement('DatiRiepilogo');
    $dbs->appendChild($riep);
    $riep->appendChild($dom->createElement('AliquotaIVA', fpaNum($vatRate)));
    $riep->appendChild($dom->createElement('ImponibileImporto', fpaNum($amount)));
    $riep->appendChild($dom->createElement('Imposta', fpaNum($vatAmount)));
    $riep->appendChild($dom->createElement('EsigibilitaIVA', 'I')); // immediata

    return $dom->saveXML();
}

/** Fields the agency MUST fill before a real submission. Returns human labels. */
function fatturaPaMissingAgencyFields(array $agency): array
{
    $missing = [];
    if (empty($agency['piva']) && empty($agency['cf'])) $missing[] = 'Partita IVA o Codice Fiscale agenzia';
    if (empty($agency['denominazione']))                $missing[] = 'Denominazione agenzia';
    if (empty($agency['indirizzo']))                    $missing[] = 'Indirizzo sede';
    if (empty($agency['cap']))                          $missing[] = 'CAP sede';
    if (empty($agency['comune']))                       $missing[] = 'Comune sede';
    return $missing;
}

// --- small formatting helpers ------------------------------------------------

function fpaVal(?string $s): string
{
    return trim((string) $s);
}

function fpaNum(float $n): string
{
    return number_format($n, 2, '.', '');
}

function fpaCap(?string $cap): string
{
    $cap = preg_replace('/\D/', '', (string) $cap);
    return $cap !== '' ? str_pad(substr($cap, 0, 5), 5, '0', STR_PAD_LEFT) : '00000';
}

function fpaProv(?string $p): string
{
    return strtoupper(substr(preg_replace('/[^A-Za-z]/', '', (string) $p), 0, 2));
}
