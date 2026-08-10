# Scope aperto — due decisioni da prendere con Orlandi

> **Stato: in attesa di risposta dall'agenzia.** Nessuno dei due pezzi è in
> costruzione. Questo documento esiste perché non vengano dimenticati: sono le
> ultime due mancanze di dominio note, e non sono difetti da correggere — sono
> funzioni che ha senso costruire solo se l'agenzia fa quel tipo di lavoro.
>
> Ultimo controllo sullo stato del codice: **10/08/2026** (verificato sul
> database, non sui documenti — vedi «Come è stato verificato» in fondo).

Tutto il resto della lista di mancanze è stato chiuso o non è codice nostro
(vedi §4).

---

## 1. La trattativa di vendita

### Cosa manca

Il percorso che porta da un interessato a un atto notarile:

```
proposta d'acquisto → controproposta → accettazione → compromesso → rogito
```

Nel database **non esiste nessuna tabella** per questo: nessuna proposta,
nessuna caparra, nessuna data di compromesso, nessun notaio.

### Cosa si può fare oggi, e cosa no

| Oggi si può | Oggi NON si può |
|---|---|
| Registrare una **compravendita già conclusa** come contratto (`contract_type` accetta `compravendita` e `preliminare`) | Registrare un'**offerta**: quanto è stato offerto, quando, con quale caparra, entro quando è valida |
| Raccogliere una **richiesta dal sito** (`property_applications`: nome, email, telefono, messaggio) | Tracciare **accettazione, rifiuto o controproposta**, e da chi |
| Generare il PDF di una compravendita | Sapere a che punto è una trattativa, o quante ne sono aperte su un immobile |
| | Fissare **data del compromesso, data del rogito, notaio** |

`property_applications` va letta per quello che è: un **modulo di contatto** dal
sito vetrina. Non è un'offerta, non ha un importo, e non ha stati oltre
new/contacted/approved/rejected.

Conseguenza pratica: se Orlandi vende, oggi la fase più delicata del lavoro —
quella in cui girano caparre e scadenze legali — vive **fuori** dal gestionale,
su carta o in un foglio. Ed è anche la fase in cui una data dimenticata costa di
più.

### Cosa servirebbe

Ordine di grandezza, non un preventivo: una tabella delle proposte con i suoi
stati, il collegamento a immobile/lead/proprietario, la generazione del PDF
della proposta, e i due passaggi finali (compromesso, rogito) con le loro date e
i promemoria — sulla stessa meccanica già usata per il preavviso di disdetta.
**Alcuni giorni di lavoro**, non ore.

### La domanda per Orlandi

> **Orlandi vende immobili, o si occupa solo di affitti e gestione?**
>
> Se vendete: quante trattative avete aperte in media, e come le seguite oggi
> (foglio, agenda, carta)? Vi serve che il gestionale tenga la proposta
> d'acquisto con importo, caparra e scadenza di validità, o vi basta registrare
> la compravendita quando è già fatta?

---

## 2. Gli affitti stagionali / brevi

### Cosa manca

Nessun **calendario di disponibilità**, nessuna **prenotazione**, nessun
**prezzo per notte**. Nel database non c'è nessuna tabella di prenotazioni.

Il modello dell'applicazione è la locazione a lungo termine: un contratto ha una
decorrenza, una scadenza e un canone **mensile**, e l'immobile è «affittato» o
«disponibile». Un appartamento affittato tre settimane ad agosto e due a
settembre non è esprimibile: non esiste il concetto di «occupato dal 3 al 24».

### Perché la domanda è sensata

Civitanova Marche è una città di mare, e per un'agenzia della costa gli affitti
estivi possono essere una fetta importante del lavoro. Ma se Orlandi non li fa,
costruire un motore di prenotazioni è lavoro buttato — ed è la più grossa delle
due voci.

### Cosa servirebbe

Una tabella prenotazioni con periodo e stato, un calendario di disponibilità per
immobile, tariffe per periodo (alta/bassa stagione), e la guardia sulla doppia
prenotazione — quella esiste già in forma di controllo sulle locazioni
sovrapposte (`lib/contract_lifecycle.php`) e andrebbe estesa. Più grande della
prima voce.

### La domanda per Orlandi

> **Vi occupate di affitti stagionali o brevi (settimane, mesi estivi), o solo
> di locazioni annuali?**
>
> Se sì: quanti immobili in stagione, e come gestite oggi il calendario delle
> disponibilità? Le tariffe cambiano fra alta e bassa stagione?

---

## 3. Come usare le risposte

- **Entrambe no** → il gestionale è completo per come lavorano, e queste due
  voci si chiudono per sempre. Da mettere per iscritto.
- **Una sì** → si costruisce quella, e questo documento diventa il punto di
  partenza per il piano.
- **Entrambe sì** → si costruisce **prima la trattativa di vendita**: è più
  piccola, ed è quella dove una scadenza dimenticata ha conseguenze legali.

---

## 4. Cosa NON è in questo documento (e perché)

Le altre mancanze note sono chiuse o non dipendono da noi:

| Voce | Stato |
|---|---|
| Rinnovo, disdetta, preavviso | ✅ fatto (phase99) |
| Adeguamento ISTAT applicato, non solo calcolato | ✅ fatto |
| Isolamento fra portali provato (48/48) | ✅ fatto, script rieseguibile |
| Cancello CI prima del deploy | ✅ fatto — ma **non blocca** il deploy Coolify |
| Note legali, cookie policy, terzi sul sito pubblico | ✅ fatto |
| Le sei colonne del portale inquilino senza chi le scrive | ✅ fatto (phase98) |
| P.IVA, codice fiscale e REA in Note legali | ⏳ **l'agenzia** deve compilarli in Impostazioni (il REA non ha ancora un campo) |
| Numero WhatsApp Business, App Review Meta | ⏳ pratiche con i fornitori, tempi loro |
| Contratto col portale (immobiliare.it) per il feed | ⏳ decisione commerciale |
| Stripe: dentro o fuori | ⏳ decisione dell'agenzia |
| DPA con Google/Meta/hosting, registro dei trattamenti | ⏳ pratiche legali, non codice |
| `DB_USER` non-root in produzione, regole Apache sull'host | ⏳ da verificare sul server vero |
| Sottodominio per il sito vetrina | ⏳ configurazione DNS |

---

## Come è stato verificato

Non rileggendo i documenti (che su questo progetto hanno già mentito), ma
interrogando il database e il codice il 10/08/2026:

- ricerca di tabelle con nomi contenenti `offer`, `propost`, `compromess`,
  `rogit`, `prenotaz`, `booking`, `disponibil`, `availab` → **nessuna**;
- `contracts.contract_type` → `enum('locazione','compravendita','preliminare','mandato','altro')`,
  quindi l'**esito** di una vendita si registra, il percorso no;
- colonne di `property_applications` → nome, email, telefono, messaggio, stato:
  un modulo di contatto, senza importi.
