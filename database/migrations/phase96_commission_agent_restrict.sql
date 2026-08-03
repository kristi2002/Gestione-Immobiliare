-- phase96 — le provvigioni non se ne vanno con l'agente.
--
-- `agent_commissions.admin_user_id` era in ON DELETE CASCADE: eliminare un
-- collaboratore che ha lasciato l'agenzia cancellava in silenzio TUTTE le sue
-- provvigioni, comprese quelle gia' liquidate. E' un dato contabile: dice
-- quanto e' stato pagato e a chi, e serve al commercialista anni dopo. La
-- colonna e' NOT NULL, quindi SET NULL non e' possibile (e comunque perdere
-- l'attribuzione sarebbe altrettanto sbagliato): si passa a RESTRICT, come gia'
-- fanno payments->contracts e agent_commissions->contracts.
--
-- Conseguenza voluta: un agente con provvigioni a registro non si elimina piu'.
-- Si disattiva (`is_active = 0`), che e' il gesto giusto per chi se ne va e
-- lascia dietro dei numeri. api/admin_users.php lo spiega prima di provarci.

-- Idempotente: si rifa' il vincolo solo se e' ancora quello vecchio.
SET @fk_rule := (
    SELECT DELETE_RULE
      FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = 'agent_commissions'
       AND CONSTRAINT_NAME = 'fk_ac_admin_user'
);

SET @sql := IF(@fk_rule = 'CASCADE',
    'ALTER TABLE agent_commissions DROP FOREIGN KEY fk_ac_admin_user',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(@fk_rule = 'CASCADE',
    'ALTER TABLE agent_commissions
       ADD CONSTRAINT fk_ac_admin_user
       FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
       ON DELETE RESTRICT ON UPDATE CASCADE',
    'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
