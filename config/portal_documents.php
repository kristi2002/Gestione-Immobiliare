<?php
/**
 * Che cosa un inquilino può vedere dei documenti del SUO immobile.
 *
 * Il perimetro del portale inquilino era "tutti i documenti di questo immobile,
 * più tutti quelli del mio contratto", senza alcun filtro sul tipo. Su un
 * immobile già locato in passato questo significava consegnare all'inquilino
 * attuale la carta d'identità del precedente, il suo contratto scansionato e i
 * verbali di consegna della sua tenancy: dati personali di un terzo, per di più
 * documenti di riconoscimento.
 *
 * La regola è quindi asimmetrica, ed è voluta:
 *
 *   - dal proprio CONTRATTO l'inquilino vede tutto: sono i suoi documenti;
 *   - dall'IMMOBILE vede solo ciò che descrive l'immobile e non una persona.
 *
 * Un documento che riguarda una specifica locazione (verbale, inventario,
 * contratto firmato, documenti d'identità) deve essere agganciato al contratto,
 * non all'immobile: così arriva a chi è di diritto e a nessun altro. Se una
 * planimetria non compare in portale è perché è stata caricata con il tipo
 * sbagliato — si corregge il tipo, non si allarga questa lista.
 *
 * I tipi sono quelli di DOC_TYPES in api/documents.php.
 */

/** Tipi visibili all'inquilino quando il documento è agganciato all'IMMOBILE. */
const TENANT_PROPERTY_DOC_TYPES = [
    'planimetria',        // la pianta dell'unità
    'regolamento',        // regolamento condominiale
    'lettura_contatore',  // foto del quadrante dei contatori dell'unità
];

/**
 * Frammento SQL da innestare nel ramo "documento agganciato all'immobile".
 * Volutamente costruito da una costante e non da input utente.
 */
function tenantPropertyDocTypesSql(): string
{
    $list = implode(',', array_map(
        static fn (string $t): string => "'" . $t . "'",
        TENANT_PROPERTY_DOC_TYPES
    ));

    return 'doc_type IN (' . $list . ')';
}
