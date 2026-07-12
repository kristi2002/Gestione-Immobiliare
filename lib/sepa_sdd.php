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

/**
 * @param array{name:string,iban:string,creditor_id:string} $creditor
 * @param array<int,array{end_to_end_id:string,amount:float,mandate_id:string,
 *   mandate_date:string,debtor_name:string,debtor_iban:string,remittance:string}> $txs
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

    // Group header
    $grpHdr = $dom->createElement('GrpHdr');
    $root->appendChild($grpHdr);
    $grpHdr->appendChild($dom->createElement('MsgId', sepaClean($msgId, 35)));
    $grpHdr->appendChild($dom->createElement('CreDtTm', $createdAt));
    $grpHdr->appendChild($dom->createElement('NbOfTxs', (string) $nb));
    $grpHdr->appendChild($dom->createElement('CtrlSum', sepaAmt($ctrlSum)));
    $initg = $dom->createElement('InitgPty');
    $initg->appendChild($dom->createElement('Nm', sepaClean($creditor['name'], 70)));
    $grpHdr->appendChild($initg);

    // Payment information block
    $pmtInf = $dom->createElement('PmtInf');
    $root->appendChild($pmtInf);
    $pmtInf->appendChild($dom->createElement('PmtInfId', sepaClean($msgId, 35)));
    $pmtInf->appendChild($dom->createElement('PmtMtd', 'DD'));
    $pmtInf->appendChild($dom->createElement('NbOfTxs', (string) $nb));
    $pmtInf->appendChild($dom->createElement('CtrlSum', sepaAmt($ctrlSum)));

    $pmtTpInf = $dom->createElement('PmtTpInf');
    $pmtInf->appendChild($pmtTpInf);
    $svcLvl = $dom->createElement('SvcLvl'); $svcLvl->appendChild($dom->createElement('Cd', 'SEPA')); $pmtTpInf->appendChild($svcLvl);
    $lclInstrm = $dom->createElement('LclInstrm'); $lclInstrm->appendChild($dom->createElement('Cd', 'CORE')); $pmtTpInf->appendChild($lclInstrm);
    $pmtTpInf->appendChild($dom->createElement('SeqTp', 'RCUR'));

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

    return $dom->saveXML();
}

function sepaAmt(float $n): string
{
    return number_format($n, 2, '.', '');
}

function sepaIban(?string $iban): string
{
    return strtoupper(preg_replace('/\s+/', '', (string) $iban));
}

/** SEPA allows a restricted Latin charset; strip anything outside it. */
function sepaClean(?string $s, int $max): string
{
    $s = (string) $s;
    $s = preg_replace('/[^A-Za-z0-9\/\-?:().,\'+ ]/u', ' ', $s);
    $s = trim(preg_replace('/\s+/', ' ', $s));
    return mb_substr($s, 0, $max);
}
