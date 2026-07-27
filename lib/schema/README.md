# Schemi XSD ISO 20022

Questa cartella ospita gli schemi XML ufficiali usati per validare i file
generati dall'app prima che vengano consegnati alla banca.

## pain.008.001.02 (addebito diretto SEPA — SDD)

**File atteso:** `lib/schema/pain.008.001.02.xsd`

Non è incluso nel repository: va scaricato dal sito ISO 20022
(<https://www.iso20022.org/iso-20022-message-definitions>, sezione *Payments →
Customer Direct Debit Initiation V02*) oppure dal portale CBI / dalla propria
banca, che a volte distribuisce una variante con vincoli aggiuntivi.

**Comportamento senza il file:** `api/generate_sdd.php` continua a funzionare.
La validazione semantica (`sepaSddValidate()` — IBAN mod-97, identificativo
creditore, mandati, importi, data di addebito) viene sempre eseguita; la
validazione strutturale contro lo schema viene semplicemente saltata e il
risultato del controllo riporta `schema_validation: "non disponibile"`.

**Comportamento con il file:** appena l'`.xsd` è presente,
`sepaSddSchemaValidate()` lo rileva automaticamente e ogni file generato viene
validato contro lo schema. Nessuna modifica al codice è necessaria.

> Se la banca fornisce uno schema proprietario, salvarlo con questo stesso nome:
> il percorso è definito in `sepaSddSchemaPath()` in `lib/sepa_sdd.php`.
