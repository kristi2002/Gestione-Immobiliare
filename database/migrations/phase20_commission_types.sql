-- Phase 20: Extend commission_type ENUM with affitto and altro

ALTER TABLE agent_commissions
    MODIFY commission_type ENUM('vendita','locazione','affitto','gestione','altro') NOT NULL DEFAULT 'locazione';
