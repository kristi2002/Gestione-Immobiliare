-- phase80_istat_foi_index.sql
-- Gli indici ISTAT FOI escono dal codice ed entrano in tabella.
--
-- Stato precedente: `lib/istat.php` conteneva un array PHP di MEDIE ANNUE, con
-- l'anno corrente segnato «provvisorio — aggiornare con dato ISTAT». Due
-- conseguenze concrete:
--
-- 1) Aggiornare un indice richiedeva una modifica al codice e un deploy. Fra un
--    deploy e l'altro l'adeguamento veniva calcolato su un numero segnaposto,
--    e nulla nell'interfaccia lo diceva.
-- 2) Il form del contratto chiede «Mese indice base (AAAA-MM)» e lo salva in
--    `contracts.istat_baseline_month`, ma il calcolo lavorava per ANNI e quel
--    campo non veniva mai letto: l'agente compilava un dato che non entrava in
--    nessuna formula. L'ISTAT pubblica il FOI ogni mese, e i contratti di
--    locazione indicizzano sul mese, non sulla media annua.
--
-- `ref_month` = 0 significa «media annua». Non e' NULL di proposito: in MySQL
-- due NULL non si considerano uguali, quindi con `ref_month NULL` la chiave
-- unica (anno, mese) avrebbe lasciato inserire dieci medie annue per lo stesso
-- anno e l'upsert dell'import non avrebbe mai agganciato la riga esistente.
--
-- `source` replica la convenzione dell'import OMI (phase73): 'manuale' e' un
-- override dell'agente e l'import NON lo sovrascrive. 'seed' sono i valori che
-- fino a ieri stavano nel codice — restano come rete di sicurezza finche' non
-- si importa il dato ufficiale, e vengono sostituiti al primo import.

CREATE TABLE IF NOT EXISTS `istat_foi_index` (
    `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `ref_year`    SMALLINT UNSIGNED NOT NULL,
    `ref_month`   TINYINT UNSIGNED NOT NULL DEFAULT 0
                  COMMENT '1-12 = mese di riferimento; 0 = media annua',
    `index_value` DECIMAL(8,3) NOT NULL
                  COMMENT 'Indice FOI al netto dei tabacchi, base 2015=100',
    `source`      ENUM('seed','import','manuale') NOT NULL DEFAULT 'manuale'
                  COMMENT 'seed = valore storico del codice, import = file ufficiale, manuale = inserito a mano (protetto dall import)',
    `notes`       VARCHAR(255) DEFAULT NULL,
    `created_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_istat_period` (`ref_year`, `ref_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Travaso dei valori che fino a phase79 stavano in lib/istat.php. Sono le
-- stesse medie annue gia' in uso: qui non si inventa nessun dato nuovo, si
-- sposta soltanto dove puo' essere corretto senza un deploy. INSERT IGNORE
-- perche' la migrazione deve poter girare due volte senza toccare cio' che nel
-- frattempo e' stato importato o corretto a mano.
INSERT IGNORE INTO `istat_foi_index` (`ref_year`, `ref_month`, `index_value`, `source`, `notes`) VALUES
    (2015, 0, 100.000, 'seed', 'Base 2015 = 100'),
    (2016, 0,  99.900, 'seed', NULL),
    (2017, 0, 101.000, 'seed', NULL),
    (2018, 0, 102.100, 'seed', NULL),
    (2019, 0, 102.700, 'seed', NULL),
    (2020, 0, 102.500, 'seed', NULL),
    (2021, 0, 104.400, 'seed', NULL),
    (2022, 0, 112.000, 'seed', NULL),
    (2023, 0, 118.200, 'seed', NULL),
    (2024, 0, 119.600, 'seed', NULL),
    (2025, 0, 121.500, 'seed', NULL),
    (2026, 0, 123.000, 'seed', 'Valore provvisorio ereditato dal codice: sostituire con il dato ISTAT ufficiale');
