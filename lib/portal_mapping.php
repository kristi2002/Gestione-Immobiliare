<?php
/**
 * Dizionario di mappatura tassonomie verso i portali (`portal_field_map`).
 *
 * Traduce un valore interno nel codice atteso dal portale
 * (appartamento -> flat su Idealista). Il perche' della tabella e non di
 * costanti PHP e' in config/portal_specs.php.
 *
 * ⚠️ Trappola gia' pagata una volta in questo repo (vedi
 * docs/reports/APP_AUDIT_2026-07-26.md): una migrazione allarga un enum, la
 * whitelist PHP resta indietro e per mesi il form rifiuta in silenzio le sue
 * stesse opzioni. `portal_field_map` e' una SECONDA copia di ogni enum, quindi
 * ha lo stesso identico rischio: allarghi properties.property_type e ti
 * dimentichi la riga di mappatura. Per questo esiste
 * portalMappingMissing(): il buco si vede prima, non in produzione.
 */

require_once __DIR__ . '/../config/portal_specs.php';

/**
 * Mappature di un portale per un dominio: [valore_interno => codice_portale].
 * Cache di richiesta: la validazione di una lista le rileggerebbe per ogni riga.
 */
function portalMap(PDO $db, string $portal, string $domain): array
{
    static $cache = [];
    $key = $portal . '|' . $domain;

    if (!isset($cache[$key])) {
        $stmt = $db->prepare(
            'SELECT internal_value, external_value
               FROM portal_field_map
              WHERE portal = :portal AND domain = :domain'
        );
        $stmt->execute(['portal' => $portal, 'domain' => $domain]);

        $map = [];
        foreach ($stmt->fetchAll() as $row) {
            $map[$row['internal_value']] = $row['external_value'];
        }
        $cache[$key] = $map;
    }

    return $cache[$key];
}

/**
 * Traduce un valore. Null quando la mappatura manca: chi genera il feed NON
 * deve inventare un fallback: spedire il valore interno grezzo significa farsi
 * scartare la riga dal portale con un errore che non dice niente.
 */
function portalMapValue(PDO $db, string $portal, string $domain, ?string $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    return portalMap($db, $portal, $domain)[$value] ?? null;
}

/**
 * Valori interni realmente presenti nella colonna, letti dall'enum del DB:
 * e' l'unica fonte che non va allineata a mano (ed e' proprio quello che nel
 * precedente incidente non era stato allineato).
 */
function portalDomainValues(PDO $db, string $domain): array
{
    static $cache = [];
    if (isset($cache[$domain])) {
        return $cache[$domain];
    }

    $stmt = $db->prepare(
        "SELECT COLUMN_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'properties' AND COLUMN_NAME = :col"
    );
    $stmt->execute(['col' => $domain]);
    $type = (string) $stmt->fetchColumn();

    $values = [];
    if (preg_match("/^enum\((.*)\)$/i", $type, $m)) {
        foreach (explode(',', $m[1]) as $piece) {
            $values[] = str_replace("''", "'", trim($piece, " '"));
        }
    }

    return $cache[$domain] = $values;
}

/**
 * Valori interni senza riga di mappatura per quel portale — la deriva.
 * Usata dalla validazione (blocca l'immobile che usa un valore non mappato) e
 * da api/readiness.php (segnala il buco anche quando nessuno pubblica ancora).
 */
function portalMappingMissing(PDO $db, string $portal, string $domain): array
{
    $mapped = portalMap($db, $portal, $domain);
    $all    = portalDomainValues($db, $domain);

    return array_values(array_filter($all, static fn($v) => !isset($mapped[$v])));
}

/**
 * Deriva su tutti i portali che dichiarano di usare un dominio.
 * Ritorna [] quando e' tutto mappato.
 */
function portalMappingDrift(PDO $db): array
{
    $drift = [];
    foreach (PORTAL_SPECS as $portal => $spec) {
        foreach ($spec['map_domains'] as $domain) {
            $missing = portalMappingMissing($db, $portal, $domain);
            if ($missing) {
                $drift[] = [
                    'portal'  => $portal,
                    'domain'  => $domain,
                    'missing' => $missing,
                ];
            }
        }
    }
    return $drift;
}
