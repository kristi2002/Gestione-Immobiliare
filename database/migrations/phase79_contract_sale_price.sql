-- phase79_contract_sale_price.sql
-- Un contratto di compravendita non ha un canone mensile.
--
-- Fino a qui `contracts` aveva un solo campo economico ricorrente,
-- `monthly_rent`, e il form lo mostrava per ogni tipo di contratto. Il risultato
-- visibile in elenco era una compravendita con la riga «€ 700,00/mese»: un
-- prezzo di vendita infilato nel campo sbagliato, oppure — peggio — il canone di
-- una vecchia locazione rimasto lì dopo il cambio di tipo. In entrambi i casi la
-- scheda mente, e mente su un importo.
--
-- `sale_price` separa i due mondi. Non e' una duplicazione di `monthly_rent`:
-- sono grandezze diverse (un totale una tantum contro un ricorrente mensile),
-- con scale diverse — da qui DECIMAL(12,2), che regge il milione, mentre
-- DECIMAL(10,2) di monthly_rent si ferma a 99.999.999,99 ed e' giusto cosi' per
-- un canone.
--
-- La CAPARRA non prende una colonna nuova: `deposit` gia' rappresenta «la somma
-- che una parte versa e che non e' corrispettivo ricorrente» — deposito
-- cauzionale in locazione, caparra confirmatoria in compravendita. E' lo stesso
-- dato con due nomi a seconda del contratto, e infatti il form ora cambia solo
-- l'etichetta. Sdoppiarlo avrebbe significato due colonne di cui una sempre
-- vuota, piu' la domanda «quale delle due leggo?» in ogni query sui depositi.

CALL migration_add_column(
    'contracts',
    'sale_price',
    'DECIMAL(12,2) NULL COMMENT ''Prezzo di vendita (compravendita/preliminare/mandato); il canone mensile sta in monthly_rent'' AFTER `monthly_rent`'
);

-- Bonifica dei dati gia' inseriti: su un contratto di vendita il canone mensile
-- non e' un valore da conservare "per sicurezza", e' un numero che l'interfaccia
-- mostrera' come «/mese» a chiunque apra la scheda. Si travasa in `sale_price`
-- SOLO dove quest'ultimo e' ancora vuoto, poi si azzera l'origine.
--
-- Perche' travasare invece di cancellare: l'agente che ha scritto 250000 nel
-- campo canone di una compravendita intendeva il prezzo. Buttarlo via
-- perderebbe l'unico dato economico di quel contratto; spostarlo lo mette dove
-- l'interfaccia sapra' leggerlo. Se invece era davvero un canone residuo di una
-- locazione convertita, finisce comunque in un campo che per quel tipo di
-- contratto e' quello giusto da rivedere.
UPDATE `contracts`
   SET `sale_price`   = `monthly_rent`,
       `monthly_rent` = NULL
 WHERE `contract_type` IN ('compravendita', 'preliminare', 'mandato')
   AND `monthly_rent` IS NOT NULL
   AND `sale_price` IS NULL;

-- Restano i casi in cui sale_price era gia' compilato e monthly_rent pure:
-- lì il prezzo giusto c'e' gia', il canone e' solo rumore ereditato dal tipo
-- precedente e va tolto — non c'e' nulla da salvare che non sia gia' salvato.
UPDATE `contracts`
   SET `monthly_rent` = NULL
 WHERE `contract_type` IN ('compravendita', 'preliminare', 'mandato')
   AND `monthly_rent` IS NOT NULL;
