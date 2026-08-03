# Portale Inquilino — piano di rifacimento

> Deciso il 2026-08-03. Ambito approvato: **fasi 0 → 3 complete**, con la correzione
> del tema estesa anche al **portale proprietario** (stesso identico difetto).
>
> **Stato: fase 0 fatta (346cdde), fase 1 fatta (40182a6), fase 2 fatta.**
> Restano la fase 3 e due code della fase 2 rimandate di proposito, entrambe
> perché aprono un perimetro nuovo e non vanno infilate di corsa:
> l'**allegato foto** sulla richiesta (serve un endpoint di caricamento per
> l'inquilino, cioè una superficie di scrittura nuova da progettare con la sua
> verifica) e la **risposta scritta dell'agenzia** dentro la richiesta (in
> `reminders` non esiste un campo per il testo di risposta: serve una migrazione).
>
> Stato di partenza rilevato leggendo il codice, non i documenti: `tenant/index.php`
> era **un solo file da 516 righe**. Non esisteva `tenant/views/`, non esisteva un
> modulo JS del portale, non esisteva un layer CSS suo. Quattro schede (Immobile,
> Pagamenti, Documenti, Assistenza) rese inline dal PHP. Di sola lettura tranne un
> form, che spediva nel vuoto.

---

## 1. Perché "il design non è buono" — la causa, non il sintomo

`tenant/index.php:151` carica `style.css` + `branding.css.php` e **non carica mai
`theme-orlandi.css`**.

| Superficie | Tema | Font |
|---|---|---|
| Admin `index.php:40` | ✅ `theme-orlandi.css` | ✅ Inter + Playfair |
| Admin `login.php:57` | ✅ | ✅ |
| **`tenant/index.php:151`** | ❌ | ❌ |
| **`tenant/login.php:42`** | ❌ | ❌ |
| **`owner/index.php:170`** | ❌ | ❌ |
| **`owner/login.php:43`** | ❌ | ❌ |

Il tema è dove vive il marchio: barra laterale blu notte `#06224F`, azzurro
`#3186d5`, `--radius:14px`, la scala delle ombre, Playfair per i titoli. Senza
quel file i due portali rendono **il layer base non tematizzato**. Non è
un'opinione di stile: è un `<link>` mancante.

A contorno, sempre sulla stessa pagina:

- carica `style.css` (nove `@import` in catena) invece di `assets/dist/app.min.css`
  → primo disegno lento e nessuna cache-bust su `filemtime`;
- ~21 attributi `style="…"` inline più un blocco `<style>` da 20 righe: decisioni di
  layout che appartengono a un file di layer;
- emoji come iconografia (🏢 💶 📄 🛠️ 📕 ⬇️) mentre l'app admin usa Lucide;
- riusa la shell desktop dell'admin (sidebar + topbar) per un pubblico che apre
  questa pagina **dal telefono**.

---

## 2. Perché "non c'è niente" — i vuoti di contenuto

In ordine di valore per l'inquilino.

| # | Vuoto | Evidenza |
|---|---|---|
| 1 | **Il contratto non c'è.** Quattro date e un canone. Nessun PDF firmato scaricabile, nessuna cauzione, nessun adeguamento ISTAT, nessun termine di disdetta. | `index.php:43-54` |
| 2 | **Le richieste spariscono.** Il form INSERT in `reminders` e l'inquilino non le rivede mai: né numero pratica, né stato, né risposta, né foto allegata. È l'unica cosa che il portale gli lascia fare. | `api_maintenance.php:66` |
| 3 | **Nessun "Il mio account".** Non può cambiare password né aggiornare telefono/email. E `tenant/login.php` non ha "Password dimenticata?": `api/password_reset.php` è a innesco **admin** (lo dice la sua intestazione), quindi chi resta fuori deve telefonare all'agenzia. | `api/password_reset.php:3` |
| 4 | **Nessun modo di pagare.** La scheda Pagamenti dice quanto deve e non offre IBAN né causale. (Aver tolto il bottone Stripe morto era giusto — ma non è stato sostituito.) | `index.php:495-500` |
| 5 | **Appuntamenti** assenti: la tabella esiste ed è passata dall'overhaul phase64. `appointment_requests` ha forma da sito pubblico (name/surname/phone), non è legata all'inquilino. | schema |
| 6 | **Sondaggi**: `tenant/survey.php` esiste ma vive solo su token, non compare mai nel menu del portale. | `config/surveys.php:25` |
| 7 | **Verbale di consegna**: `inventory_snapshots` è congelato per contratto. L'inquilino l'ha firmato e non può rileggerlo. | schema |
| 8 | **Contatori**: `meter_readings` è per immobile. L'autolettura chiuderebbe il giro ma serve una colonna di provenienza. | schema |
| 9 | **Firma digitale**: `esign_requests` non ha alcun riferimento a `tenant`. Un inquilino non può firmare dal portale. | grep: 0 occorrenze |
| 10 | **Messaggi**: `communications` è agganciata al solo `client_id`, non ha `tenant_id`. Un filo diretto inquilino↔agenzia richiede migrazione. | schema |
| 11 | **GDPR**: consensi, esportazione ed erasure esistono lato admin, nulla lato inquilino. Per CLAUDE.md §9 è voce di vendita/legale, non un di più. | schema |

In più: tetti fissi di 36 pagamenti e 30 documenti con la nota "contatta l'agenzia".
Una locazione 4+4 ha **96** rate. Non c'è impaginatore.

---

## 3. Il piano

### Fase 0 — farlo somigliare al prodotto (½ giornata, rischio ~zero)

Aggiungere `theme-orlandi.css` + il link ai font a `tenant/index.php`,
`tenant/login.php`, `owner/index.php`, `owner/login.php`. Passare a
`assets/dist/app.min.css` con cache-bust su `filemtime`, con ricaduta su
`style.css` come fa l'admin. Screenshot prima/dopo come prova.

### Fase 1 — ristrutturare (2-3 giorni)

Spezzare il monolite:

- `tenant/views/*.php` — parziali per scheda;
- `assets/js/tenant_portal/` — modulo ES (cache-bust solo sull'entry: i
  sotto-moduli restano senza stato);
- `assets/css/style/17-tenant-portal.css` — layer nuovo, **non** dentro i
  contenitori-calderone `04`/`07` (regola 5 del README CSS), da aggiungere a
  `bundle.css`.

Via gli stili inline, emoji → Lucide, e shell **prima il telefono**: barra schede
in basso sotto i 1024px, sidebar solo da lì in su. Ricordare `npm run build:assets`
o si verifica il bundle di ieri.

### Fase 2 — il contenuto che conta (4-5 giorni)

1. Scheda **Contratto**: estremi, cauzione, ISTAT, termine di disdetta, PDF firmato.
2. **Storico richieste con stato**: rileggere le righe `reminders` create
   dall'inquilino filtrando su `tenant_id`. È ciò che rende finalmente utile il
   form che già esiste. Allegato foto sulla richiesta.
3. **Il mio account**: cambio password, recapiti.
4. **Password dimenticata** sul login inquilino (variante self-service di
   `lib/password_reset.php`, che già emette token a uso singolo e conserva l'SHA-256).
5. **IBAN + causale** nella scheda Pagamenti.
6. **Sondaggi** nel menu.
7. **Impaginazione** per superare i tetti 36/30.

### Fase 3 — il resto dell'ambito approvato

| Voce | Serve migrazione | Note |
|---|---|---|
| Appuntamenti (vedi + richiedi) | forse, per legare la richiesta all'inquilino | riusa il motore phase64 |
| Autolettura contatori | sì — colonna provenienza/verificato su `meter_readings` | l'admin conferma prima di usarla |
| Verbale di consegna | no | sola lettura da `inventory_snapshots` |
| Firma digitale inquilino | sì — soggetto tipizzato su `esign_requests` | oggi non conosce i tenant |
| Filo diretto messaggi | sì — `tenant_id` su `communications` | il pezzo più grosso |
| GDPR self-service | no | riusa export/erasure esistenti |

Prossimo numero libero: **phase98**. Ogni migrazione deve essere rieseguibile e
allargare gli enum **per append** su `information_schema`, mai riscrivendo la lista.

---

## 4. Cancello di verifica — non negoziabile

Per CLAUDE.md §4.1: **ogni nuova lettura esposta all'inquilino è una nuova
superficie IDOR.** Ogni endpoint nuovo passa il test di sostituzione A/B prima di
essere dichiarato fatto.

Il perimetro dei documenti in `index.php:87` è scritto con cura — i suoi commenti
registrano **due fughe reali già avvenute** (i documenti del proprietario, e la
carta d'identità dell'inquilino precedente agganciata allo stesso immobile). Le
query nuove seguono quello stesso confine immobile/contratto, **mai `client_id`**.

Da provare eseguendo, non affermando:

- inquilino A non legge contratto/richieste/documenti/pagamenti di B;
- una sessione inquilino non raggiunge alcun endpoint admin;
- i totali vengono dal DB, non dall'array già tagliato (errore già corretto due
  volte, in questo stesso file e nel portale proprietario);
- lo scadenzario non duplica se rigenerato.
