# Template WhatsApp da sottoporre a Meta

> Testi pronti da incollare in **Meta Business Manager → WhatsApp Manager → Modelli di messaggio
> → Crea modello**. Servono per scrivere per primi: fuori dalle 24 ore dall'ultimo messaggio del
> cliente, la Cloud API accetta **solo** template già approvati.
>
> Stato: **redatti, non ancora sottoposti.** Vedi §4 per cosa manca lato codice.

---

## 0. Regole di Meta che decidono l'approvazione

Rispettate in tutti i testi qui sotto — se li si modifica, vanno rispettate di nuovo:

- **Nome:** solo minuscole, cifre e `_`. È l'identificativo usato dal codice, non cambia con la lingua.
- **Categoria:** `UTILITY` per messaggi transazionali attesi dal destinatario. Scrivere in `UTILITY`
  un testo promozionale è la causa di rifiuto più comune, e comporta il declassamento a `MARKETING`
  (che costa di più e richiede opt-in esplicito).
- **Variabili:** `{{1}}`, `{{2}}`… numerate in sequenza da 1. Meta **rifiuta** una variabile
  a inizio o fine corpo, e due variabili adiacenti (`{{1}} {{2}}`).
- **Esempi obbligatori:** ogni variabile richiede un valore campione al momento della richiesta.
- **Footer:** massimo 60 caratteri, nessuna variabile.
- **Lingua:** `it`. Deve coincidere con il parametro `$lang` di `sendWhatsAppTemplate()`,
  il cui default è già `'it'`.

Tempi tipici di approvazione: da pochi minuti a 24 ore.

---

## 1. `sollecito_pagamento`

| Campo | Valore |
|---|---|
| Nome | `sollecito_pagamento` |
| Categoria | `UTILITY` |
| Lingua | Italiano (`it`) |

**Intestazione** — Testo (nessuna variabile):

```
Promemoria pagamento
```

**Corpo:**

```
Gentile {{1}}, le ricordiamo che il pagamento di {{2}} relativo a {{3}} è in scadenza il {{4}}. Se ha già provveduto, consideri questo messaggio come non inviato. Per qualsiasi chiarimento può rispondere direttamente a questo messaggio.
```

**Piè di pagina:**

```
Orlandi Immobiliare — Civitanova Marche
```

**Valori campione da inserire nella richiesta:**

| Variabile | Campione | Contenuto reale |
|---|---|---|
| `{{1}}` | `Mario Rossi` | nominativo del destinatario |
| `{{2}}` | `€ 650,00` | importo, formato italiano |
| `{{3}}` | `canone di locazione di agosto 2026` | causale della rata |
| `{{4}}` | `05/08/2026` | data di scadenza, `gg/mm/aaaa` |

**Chiamata corrispondente:**

```php
sendWhatsAppTemplate($phone, 'sollecito_pagamento', [
    $nome, $importoFormattato, $causale, $scadenzaFormattata,
]);
```

> Nota sul tono: è deliberatamente un *promemoria*, non una diffida. "Se ha già provveduto,
> consideri questo messaggio come non inviato" evita di accusare chi ha pagato ieri, ed è anche
> la formula che tiene il testo dentro `UTILITY`.

---

## 2. `conferma_appuntamento`

| Campo | Valore |
|---|---|
| Nome | `conferma_appuntamento` |
| Categoria | `UTILITY` |
| Lingua | Italiano (`it`) |

**Intestazione** — Testo (nessuna variabile):

```
Conferma appuntamento
```

**Corpo:**

```
Gentile {{1}}, confermiamo il nostro appuntamento di {{2}} alle ore {{3}}, presso {{4}}. Se ha un impedimento può rispondere a questo messaggio e concordiamo insieme una nuova data. A presto.
```

**Piè di pagina:**

```
Orlandi Immobiliare — Civitanova Marche
```

**Valori campione:**

| Variabile | Campione | Contenuto reale |
|---|---|---|
| `{{1}}` | `Mario Rossi` | nominativo del destinatario |
| `{{2}}` | `giovedì 7 agosto` | data in forma discorsiva |
| `{{3}}` | `16:30` | orario, `HH:MM` |
| `{{4}}` | `Via Trento 12, Civitanova Marche` | luogo dell'appuntamento |

**Chiamata corrispondente:**

```php
sendWhatsAppTemplate($phone, 'conferma_appuntamento', [
    $nome, $dataDiscorsiva, $ora, $luogo,
]);
```

---

## 3. Sui pulsanti di risposta rapida

I pulsanti ("Confermo" / "Riprogramma") sarebbero l'aggiunta naturale sulla conferma appuntamento.
Il webhook **ora li riceve correttamente** (`type: "button"` → `button.text`, risposte interattive →
`*_reply.title`): fino al 03/08/2026 `parseMetaWebhook()` leggeva solo `body` e `caption`, quindi il
messaggio arrivava vuoto e veniva scartato dal filtro di `api/whatsapp_webhook.php` — il cliente
toccava "Confermo", vedeva la spunta di consegna, e in agenzia non arrivava niente.

I due template qui sopra restano comunque **senza pulsanti**, per una ragione diversa: l'invito a
rispondere in testo riapre la finestra di 24 ore, e permette all'agente di proseguire la
conversazione dall'Inbox. Un pulsante registra la risposta ma non apre nulla di piu'.

Volendo aggiungerli in un secondo momento, il codice e' pronto: la scelta resta di prodotto.

---

## 4. Come sono collegati al gestionale

Costruito il 03/08/2026. Un template approvato da Meta diventa utilizzabile cosi':

1. **Impostazioni → Template WhatsApp → Nuovo/Modifica.** Scrivi il testo con i segnaposto
   `{{nome}}`, `{{importo}}`… **nello stesso ordine** con cui li hai registrati su Meta: il primo
   diventa `{{1}}`, il secondo `{{2}}`.
2. Nel riquadro **Collegamento a Meta**, inserisci il nome registrato (`sollecito_pagamento`), la
   lingua (`it`) e lo stato di approvazione.
3. Appena lo stato passa ad **Approvato**, il template compare nell'Inbox WhatsApp.

Cosa fa il gestionale di conseguenza:

| Comportamento | Dove |
|---|---|
| Legge l'ultimo messaggio in entrata e calcola se la finestra e' aperta | `waWindowState()` in `config/whatsapp.php` |
| Fuori finestra rifiuta il testo libero e chiede un template | `api/whatsapp_send.php`, `api/communications.php` |
| Mostra lo stato della finestra, disabilita la casella, offre i template con anteprima | Inbox WhatsApp |
| Spedisce con parametri posizionali e testo reso in archivio | `sendWhatsAppTemplate()` |

A integrazione **spenta** l'invio in testo libero passa comunque (resta simulato), ma la risposta e
la schermata lo dichiarano: serve a poter provare l'Inbox prima di avere i template approvati, non a
far credere che funzionerebbe anche in produzione.

Solo un template **approvato e collegato** e' spedibile: uno in bozza non compare nell'elenco, e
marcarlo "approvato" senza il nome Meta viene rifiutato al salvataggio.
