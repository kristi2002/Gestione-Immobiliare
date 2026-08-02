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

## 3. Perché nessuno dei due ha pulsanti

I pulsanti di risposta rapida ("Confermo" / "Riprogramma") sarebbero l'aggiunta naturale sulla
conferma appuntamento. **Oggi non vanno usati:** il tocco su un pulsante arriva al webhook come
`type: "button"`, con l'etichetta sotto `button.text`, mentre `parseMetaWebhook()`
(`config/whatsapp.php:540`) legge solo `body` e `caption`. Il messaggio risulta quindi con corpo
vuoto e senza allegati, e viene scartato dal filtro di `api/whatsapp_webhook.php:116`.

Effetto pratico: il cliente tocca "Confermo", vede la spunta di consegna, e in agenzia **non arriva
nulla** — lo stesso identico modo di fallire che quel filtro era stato scritto per evitare sulle foto
senza didascalia.

L'invito a rispondere a voce/testo, usato in entrambi i template, non ha questo problema e in più
riapre la finestra di 24 ore, permettendo all'agente di proseguire in testo libero dall'Inbox.

Sono circa sei righe di parser per sistemarlo (`button.text` e `interactive.*_reply.title`); vanno
scritte **prima** di sottoporre versioni con pulsanti.

---

## 4. Cosa manca ancora lato codice

L'approvazione dei template da sola non li rende utilizzabili. Ad oggi:

| Pezzo | Stato |
|---|---|
| `sendWhatsAppTemplate()` | Scritta e corretta, **mai chiamata da nessuno** |
| Invii da Comunicazioni / Inbox | Passano da `sendWhatsAppMessage()`, testo libero |
| Guardia sulla finestra di 24 ore | **Assente** — fuori finestra Meta risponde 131047 e l'invio fallisce |
| `whatsapp_templates` (tabella locale) | Testo pronto per l'agente, **nessun collegamento** al nome Meta (`meta_template_name` mai migrata) |

Finché questo non viene colmato, i template approvati esistono solo nel pannello Meta. Il percorso
minimo: collegare la tabella locale al nome Meta, e far scegliere a `api/whatsapp_send.php` fra testo
libero e template in base all'ultimo messaggio in entrata del numero.
