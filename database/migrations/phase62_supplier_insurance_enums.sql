-- phase62_supplier_insurance_enums.sql
-- Riconcilia gli enum DB con le opzioni realmente offerte dai form.
--
-- I <select> di suppliers.html e insurance.html offrivano valori NON presenti
-- negli enum di `suppliers.category` e `property_insurance.policy_type`: sotto
-- MySQL strict mode quelle scritture fallivano o venivano azzerate. Nessuna riga
-- esistente usa i valori nuovi (verificato), quindi allarghiamo gli enum all'UNIONE
-- (valori esistenti + opzioni del form): nessuna perdita dati, nessuna modifica ai form.
--
-- MODIFY COLUMN è idempotente: ri-eseguirlo imposta lo stesso tipo colonna.
-- Attributi preservati: NOT NULL DEFAULT 'altro' su entrambe.

USE gestione_immobiliare;

-- suppliers.category — aggiunge ascensore, serrature, giardinaggio
-- (giardinaggio resta accanto a giardiniere per non toccare i dati/form esistenti).
ALTER TABLE suppliers
    MODIFY COLUMN category ENUM(
        'idraulico','elettricista','muratore','falegname','imbianchino',
        'giardiniere','giardinaggio','pulizie','ascensore','serrature','altro'
    ) NOT NULL DEFAULT 'altro';

-- property_insurance.policy_type — aggiunge responsabilita_civile, furto, multirischio, vita.
ALTER TABLE property_insurance
    MODIFY COLUMN policy_type ENUM(
        'incendio','responsabilita','responsabilita_civile','globale_fabbricato',
        'furto','multirischio','vita','altro'
    ) NOT NULL DEFAULT 'altro';
