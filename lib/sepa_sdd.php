<?php
/**
 * SEPA Direct Debit (SDD) file generator — pain.008.001.02.
 *
 * Builds a CORE B2C direct-debit initiation file from the agency creditor
 * (IBAN + SEPA Creditor Identifier) and a set of tenant mandates + amounts.
 * The bank/PSP imports this file to collect rent by addebito diretto.
 *
 * This produces the standard XML; the agency uploads it to home-banking / CBI.
 */

/** The two sequence types this file can emit (SeqTp). */
const SEPA_SEQ_TYPES = ['FRST', 'RCUR'];

/**
 * Normalise a transaction's sequence type.
 *
 * Anything that isn't literally FRST is treated as RCUR: a wrong RCUR on a first
 * collection is rejected by the bank, but a wrong FRST on a recurring one is
 * rejected too — and only one of the two can be reached by a caller that simply
 * forgot the key. sepaSddValidate() is where a missing value is actually
 * reported; this keeps the builder from emitting an empty SeqTp element.
 */
function sepaSeqType(array $tx): string
{
    return (($tx['seq_type'] ?? '') === 'FRST') ? 'FRST' : 'RCUR';
}

/**
 * @param array{name:string,iban:string,creditor_id:string} $creditor
 * @param array<int,array{end_to_end_id:string,amount:float,mandate_id:string,
 *   mandate_date:string,debtor_name:string,debtor_iban:string,remittance:string,
 *   seq_type:string}> $txs
 * @param string $collectionDate  Y-m-d requested collection date
 * @param string $msgId           unique message id
 * @param string $createdAt       ISO 8601 creation datetime (pass in — no clock here)
 */
function sepaSddBuildXml(array $creditor, array $txs, string $collectionDate, string $msgId, string $createdAt): string
{
    $dom = new DOMDocument('1.0', 'UTF-8');
    $dom->formatOutput = true;

    $doc = $dom->createElementNS('urn:iso:std:iso:20022:tech:xsd:pain.008.001.02', 'Document');
    $dom->appendChild($doc);
    $root = $dom->createElement('CstmrDrctDbtInitn');
    $doc->appendChild($root);

    $ctrlSum = 0.0;
    foreach ($txs as $t) $ctrlSum += (float) $t['amount'];
    $nb = count($txs);

    // Group header — totals are for the whole message, across every PmtInf block.
    $grpHdr = $dom->createElement('GrpHdr');
    $root->appendChild($grpHdr);
    $grpHdr->appendChild($dom->createElement('MsgId', sepaClean($msgId, 35)));
    $grpHdr->appendChild($dom->createElement('CreDtTm', $createdAt));
    $grpHdr->appendChild($dom->createElement('NbOfTxs', (string) $nb));
    $grpHdr->appendChild($dom->createElement('CtrlSum', sepaAmt($ctrlSum)));
    $initg = $dom->createElement('InitgPty');
    $initg->appendChild($dom->createElement('Nm', sepaClean($creditor['name'], 70)));
    $grpHdr->appendChild($initg);

    // SeqTp lives in PmtTpInf, which is a property of the PAYMENT INFORMATION
    // block — not of the single transaction. A batch that mixes a new tenant's
    // first collection with everyone else's recurring ones therefore cannot be
    // one block: it is split into one PmtInf per sequence type. FRST first, so
    // the block needing the longer bank lead time is at the top of the file.
    foreach (SEPA_SEQ_TYPES as $seq) {
        $group = array_values(array_filter($txs, fn($t) => sepaSeqType($t) === $seq));
        if (!$group) {
            continue;   // no empty PmtInf: NbOfTxs = 0 is a schema violation
        }
        sepaSddAppendPmtInf($dom, $root, $creditor, $group, $seq, $collectionDate, $msgId);
    }

    return $dom->saveXML();
}

/**
 * One <PmtInf> block: the creditor side, the sequence type, and its transactions.
 */
function sepaSddAppendPmtInf(
    DOMDocument $dom,
    DOMElement $root,
    array $creditor,
    array $txs,
    string $seqType,
    string $collectionDate,
    string $msgId
): void {
    $ctrlSum = 0.0;
    foreach ($txs as $t) $ctrlSum += (float) $t['amount'];
    $nb = count($txs);

    $pmtInf = $dom->createElement('PmtInf');
    $root->appendChild($pmtInf);
    // PmtInfId must be unique within the message: suffix it with the sequence
    // type, which is exactly what distinguishes the blocks.
    $pmtInf->appendChild($dom->createElement('PmtInfId', sepaClean($msgId . '-' . $seqType, 35)));
    $pmtInf->appendChild($dom->createElement('PmtMtd', 'DD'));
    $pmtInf->appendChild($dom->createElement('NbOfTxs', (string) $nb));
    $pmtInf->appendChild($dom->createElement('CtrlSum', sepaAmt($ctrlSum)));

    $pmtTpInf = $dom->createElement('PmtTpInf');
    $pmtInf->appendChild($pmtTpInf);
    $svcLvl = $dom->createElement('SvcLvl'); $svcLvl->appendChild($dom->createElement('Cd', 'SEPA')); $pmtTpInf->appendChild($svcLvl);
    $lclInstrm = $dom->createElement('LclInstrm'); $lclInstrm->appendChild($dom->createElement('Cd', 'CORE')); $pmtTpInf->appendChild($lclInstrm);
    $pmtTpInf->appendChild($dom->createElement('SeqTp', $seqType));

    $pmtInf->appendChild($dom->createElement('ReqdColltnDt', substr($collectionDate, 0, 10)));

    $cdtr = $dom->createElement('Cdtr'); $cdtr->appendChild($dom->createElement('Nm', sepaClean($creditor['name'], 70))); $pmtInf->appendChild($cdtr);
    $cdtrAcct = $dom->createElement('CdtrAcct');
    $cdtrAcctId = $dom->createElement('Id'); $cdtrAcctId->appendChild($dom->createElement('IBAN', sepaIban($creditor['iban']))); $cdtrAcct->appendChild($cdtrAcctId);
    $pmtInf->appendChild($cdtrAcct);

    $cdtrAgt = $dom->createElement('CdtrAgt');
    $finInstn = $dom->createElement('FinInstnId'); $othr = $dom->createElement('Othr'); $othr->appendChild($dom->createElement('Id', 'NOTPROVIDED'));
    $finInstn->appendChild($othr); $cdtrAgt->appendChild($finInstn); $pmtInf->appendChild($cdtrAgt);

    // Creditor scheme identifier
    $cdtrSchme = $dom->createElement('CdtrSchmeId');
    $csId = $dom->createElement('Id'); $prvt = $dom->createElement('PrvtId'); $csOthr = $dom->createElement('Othr');
    $csOthr->appendChild($dom->createElement('Id', sepaClean($creditor['creditor_id'], 35)));
    $schmeNm = $dom->createElement('SchmeNm'); $schmeNm->appendChild($dom->createElement('Prtry', 'SEPA')); $csOthr->appendChild($schmeNm);
    $prvt->appendChild($csOthr); $csId->appendChild($prvt); $cdtrSchme->appendChild($csId); $pmtInf->appendChild($cdtrSchme);

    // Transactions
    foreach ($txs as $t) {
        $tx = $dom->createElement('DrctDbtTxInf');
        $pmtInf->appendChild($tx);

        $pmtId = $dom->createElement('PmtId');
        $pmtId->appendChild($dom->createElement('EndToEndId', sepaClean($t['end_to_end_id'], 35)));
        $tx->appendChild($pmtId);

        $amt = $dom->createElement('InstdAmt', sepaAmt((float) $t['amount']));
        $amt->setAttribute('Ccy', 'EUR');
        $tx->appendChild($amt);

        $ddTx = $dom->createElement('DrctDbtTx');
        $mndt = $dom->createElement('MndtRltdInf');
        $mndt->appendChild($dom->createElement('MndtId', sepaClean($t['mandate_id'], 35)));
        $mndt->appendChild($dom->createElement('DtOfSgntr', substr($t['mandate_date'], 0, 10)));
        $ddTx->appendChild($mndt);
        $tx->appendChild($ddTx);

        $dbtrAgt = $dom->createElement('DbtrAgt');
        $dfi = $dom->createElement('FinInstnId'); $dothr = $dom->createElement('Othr'); $dothr->appendChild($dom->createElement('Id', 'NOTPROVIDED'));
        $dfi->appendChild($dothr); $dbtrAgt->appendChild($dfi); $tx->appendChild($dbtrAgt);

        $dbtr = $dom->createElement('Dbtr'); $dbtr->appendChild($dom->createElement('Nm', sepaClean($t['debtor_name'], 70))); $tx->appendChild($dbtr);

        $dbtrAcct = $dom->createElement('DbtrAcct');
        $dbtrAcctId = $dom->createElement('Id'); $dbtrAcctId->appendChild($dom->createElement('IBAN', sepaIban($t['debtor_iban']))); $dbtrAcct->appendChild($dbtrAcctId);
        $tx->appendChild($dbtrAcct);

        $rmt = $dom->createElement('RmtInf'); $rmt->appendChild($dom->createElement('Ustrd', sepaClean($t['remittance'], 140))); $tx->appendChild($rmt);
    }
}

function sepaAmt(float $n): string
{
    return number_format($n, 2, '.', '');
}

function sepaIban(?string $iban): string
{
    return strtoupper(preg_replace('/\s+/', '', (string) $iban));
}

/** Registered IBAN length per country (SEPA area + the common non-SEPA ones). */
const SEPA_IBAN_LENGTHS = [
    'AD' => 24, 'AT' => 20, 'BE' => 16, 'BG' => 22, 'CH' => 21, 'CY' => 28,
    'CZ' => 24, 'DE' => 22, 'DK' => 18, 'EE' => 20, 'ES' => 24, 'FI' => 18,
    'FR' => 27, 'GB' => 22, 'GI' => 23, 'GR' => 27, 'HR' => 21, 'HU' => 28,
    'IE' => 22, 'IS' => 26, 'IT' => 27, 'LI' => 21, 'LT' => 20, 'LU' => 20,
    'LV' => 21, 'MC' => 27, 'MT' => 31, 'NL' => 18, 'NO' => 15, 'PL' => 28,
    'PT' => 25, 'RO' => 24, 'SE' => 24, 'SI' => 19, 'SK' => 24, 'SM' => 27,
    'VA' => 22,
];

/**
 * ISO 13616 IBAN check — structure, registered country length, and the mod-97
 * checksum.
 *
 * Without this a typo'd IBAN produces a perfectly well-formed file that the bank
 * rejects on upload, after the agent has already believed the rent was collected.
 * Catching it at export time is the difference between a form error and a missed
 * collection cycle.
 */
function sepaIbanIsValid(?string $iban): bool
{
    $iban = sepaIban($iban);

    if (!preg_match('/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/', $iban)) {
        return false;
    }
    $country = substr($iban, 0, 2);
    if (isset(SEPA_IBAN_LENGTHS[$country]) && strlen($iban) !== SEPA_IBAN_LENGTHS[$country]) {
        return false;
    }

    // Move the first 4 chars to the end, then map letters to digits (A=10 … Z=35).
    $rearranged = substr($iban, 4) . substr($iban, 0, 4);
    $numeric    = '';
    for ($i = 0, $len = strlen($rearranged); $i < $len; $i++) {
        $c = $rearranged[$i];
        $numeric .= ctype_alpha($c) ? (string) (ord($c) - 55) : $c;
    }

    // mod 97 on a number far wider than PHP_INT_MAX — fold it in small chunks
    // so no intermediate value can overflow (avoids needing bcmath/gmp).
    $remainder = 0;
    foreach (str_split($numeric, 7) as $chunk) {
        $remainder = (int) ((string) $remainder . $chunk) % 97;
    }

    return $remainder === 1;
}

/**
 * Pre-flight check run BEFORE the XML is handed to the agent.
 *
 * These are the conditions that make a bank reject an otherwise well-formed
 * pain.008 file. Returns a list of human-readable Italian problems; empty means
 * the batch is safe to submit.
 *
 * @param array{name:string,iban:string,creditor_id:string} $creditor
 * @param array<int,array<string,mixed>> $txs
 * @param string $collectionDate Y-m-d
 * @param string $today          Y-m-d (passed in — no clock in this lib)
 * @return string[]
 */
function sepaSddValidate(array $creditor, array $txs, string $collectionDate, string $today): array
{
    $errors = [];

    if (!sepaIbanIsValid($creditor['iban'] ?? '')) {
        $errors[] = "IBAN dell'agenzia non valido (Impostazioni → Fatturazione): controlla il codice IBAN.";
    }
    // Italian Creditor Identifier: IT + 2 check digits + 3 business code + 22 alnum.
    $cid = strtoupper(preg_replace('/\s+/', '', (string) ($creditor['creditor_id'] ?? '')));
    if (!preg_match('/^[A-Z]{2}[0-9]{2}[A-Z0-9]{3}[A-Z0-9]{1,28}$/', $cid)) {
        $errors[] = 'Identificativo Creditore SEPA non valido (atteso es. IT66ZZZ12345678901).';
    }
    if (trim((string) ($creditor['name'] ?? '')) === '') {
        $errors[] = "Ragione sociale dell'agenzia mancante (Impostazioni).";
    }

    if (empty($txs)) {
        $errors[] = 'Nessun addebito da includere nel file.';
    }

    // CORE direct debits need lead time: the bank must receive the file before the
    // requested collection date. A date already in the past is an instant reject.
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $collectionDate)) {
        $errors[] = 'Data di addebito non valida.';
    } elseif ($collectionDate < $today) {
        $errors[] = "Data di addebito ($collectionDate) nel passato: scegli una data futura.";
    }

    foreach ($txs as $t) {
        $who = trim((string) ($t['debtor_name'] ?? '')) ?: 'inquilino senza nome';

        if (!sepaIbanIsValid($t['debtor_iban'] ?? '')) {
            $errors[] = "IBAN non valido per $who — correggi la scheda inquilino.";
        }
        if ((float) ($t['amount'] ?? 0) <= 0) {
            $errors[] = "Importo non valido per $who.";
        }
        if (trim((string) ($t['mandate_id'] ?? '')) === '') {
            $errors[] = "Riferimento mandato SDD mancante per $who.";
        }
        $mandateDate = substr((string) ($t['mandate_date'] ?? ''), 0, 10);
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $mandateDate)) {
            $errors[] = "Data del mandato SDD mancante o non valida per $who.";
        } elseif ($mandateDate > $today) {
            $errors[] = "Data del mandato SDD nel futuro per $who.";
        }
        if (trim((string) ($t['debtor_name'] ?? '')) === '') {
            $errors[] = 'Un addebito non ha il nome del debitore.';
        }
        // Il chiamante DEVE decidere la sequenza (vedi sddAssignSequenceTypes in
        // api/generate_sdd.php): il builder ripiega su RCUR e un RCUR sbagliato
        // sul primo incasso di un mandato e' proprio il rifiuto che si vuole
        // evitare, quindi l'assenza va segnalata qui e non lasciata passare.
        if (!in_array($t['seq_type'] ?? '', SEPA_SEQ_TYPES, true)) {
            $errors[] = "Sequenza SDD (FRST/RCUR) non determinata per $who.";
        }
    }

    return array_values(array_unique($errors));
}

/** Filesystem location of the optional official ISO 20022 schema. */
function sepaSddSchemaPath(): string
{
    return __DIR__ . '/schema/pain.008.001.02.xsd';
}

/**
 * Validate the generated XML against the official pain.008.001.02 XSD.
 *
 * The schema is NOT vendored in this repo (see lib/schema/README.md for where to
 * download it). When the file is absent this returns ['skipped' => true] and the
 * caller relies on sepaSddValidate() alone; dropping the .xsd in place activates
 * full schema validation with no code change.
 *
 * @return array{skipped:bool,valid:bool,errors:string[]}
 */
function sepaSddSchemaValidate(string $xml): array
{
    $xsd = sepaSddSchemaPath();
    if (!is_readable($xsd)) {
        return ['skipped' => true, 'valid' => true, 'errors' => []];
    }

    $prev = libxml_use_internal_errors(true);
    libxml_clear_errors();

    $dom = new DOMDocument();
    $errors = [];
    if (!$dom->loadXML($xml)) {
        $errors[] = 'XML generato non leggibile.';
    } elseif (!$dom->schemaValidate($xsd)) {
        foreach (libxml_get_errors() as $e) {
            $errors[] = trim($e->message) . (($e->line ?? 0) ? " (riga {$e->line})" : '');
        }
        if (!$errors) $errors[] = 'Il file non rispetta lo schema pain.008.001.02.';
    }

    libxml_clear_errors();
    libxml_use_internal_errors($prev);

    return ['skipped' => false, 'valid' => empty($errors), 'errors' => $errors];
}

/** SEPA allows a restricted Latin charset; strip anything outside it. */
function sepaClean(?string $s, int $max): string
{
    $s = (string) $s;
    $s = preg_replace('/[^A-Za-z0-9\/\-?:().,\'+ ]/u', ' ', $s);
    $s = trim(preg_replace('/\s+/', ' ', $s));
    return mb_substr($s, 0, $max);
}
