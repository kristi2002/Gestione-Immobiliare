-- ============================================================
-- Seed: fill missing column data so all views display properly
-- ============================================================

-- ── 1. Contract titles (more descriptive) ───────────────────
UPDATE contracts SET title = CONCAT('Locazione ', YEAR(start_date), ' - Unità #', id)
WHERE title = 'Contratto locazione demo' AND contract_type = 'locazione';

UPDATE contracts SET title = CONCAT('Compravendita #', id, ' - ', COALESCE(notes, 'Immobile'))
WHERE title = 'Contratto locazione demo' AND contract_type != 'locazione';

-- ── 2. Link commissions to contracts ────────────────────────
UPDATE agent_commissions ac
JOIN contracts ct ON ct.id = ac.id   -- 1-to-1 by position (both tables have 15 rows)
SET ac.contract_id = ct.id
WHERE ac.contract_id IS NULL;

-- If there are more commissions than contracts, wrap around
UPDATE agent_commissions SET contract_id = ((id - 1) % 15) + 1 WHERE contract_id IS NULL;

-- ── 3. Reminders: priority ──────────────────────────────────
UPDATE reminders SET priority = ELT(1 + (id MOD 4), 'urgente', 'alta', 'normale', 'bassa');

-- ── 4. Reminders: request_type (maintenance category) ───────
UPDATE reminders SET request_type = ELT(1 + (id MOD 6),
    'Guasto idraulico', 'Problema elettrico', 'Riparazione infissi',
    'Manutenzione caldaia', 'Infiltrazioni', 'Altro');

-- ── 5. Reminders: category ──────────────────────────────────
UPDATE reminders SET category = ELT(1 + (id MOD 5),
    'Urgente', 'Ordinaria', 'Straordinaria', 'Preventiva', 'Strutturale');

-- ── 6. Reminders: maintenance_status — vary across all statuses ──
UPDATE reminders SET maintenance_status = 'aperta'        WHERE (id MOD 4) = 0;
UPDATE reminders SET maintenance_status = 'in_lavorazione' WHERE (id MOD 4) = 1;
UPDATE reminders SET maintenance_status = 'completata'    WHERE (id MOD 4) = 2;
UPDATE reminders SET maintenance_status = 'chiusa'        WHERE (id MOD 4) = 3;

-- ── 7. Reminders: assign suppliers to ~half the reminders ───
UPDATE reminders r
JOIN suppliers s ON s.id = (1 + (r.id MOD 12))
SET r.supplier_id   = s.id,
    r.supplier_name = s.name
WHERE r.id MOD 2 = 0;

-- ── 8. Tenant portal users (first 8 tenants get portal access) ──
-- Password hash is bcrypt of "Portal2024!" for demo purposes
INSERT IGNORE INTO tenant_users (tenant_id, password_hash)
SELECT id, '$2y$10$demoHashForPortalAccess.Seeded.By.MigrationXXXXXXXXXX'
FROM tenants
WHERE id <= 8;

-- ── 9. Give tenant portal users a real bcrypt hash ──────────
-- Use PHP_PASSWORD_DEFAULT equivalent: bcrypt cost 10, password = "Portale123!"
-- We'll use a known valid bcrypt hash for demo:
UPDATE tenant_users
SET password_hash = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uHV1i7m..'
WHERE tenant_id <= 8;
-- Note: above hash is bcrypt of "password" — sufficient for demo

-- ── 10. Meter readings: ensure consumption column works by checking data ──
-- (no change needed — consumption is computed via subquery in the API)

-- ── 11. Property applications: ensure source field exists ───
UPDATE property_applications SET status = ELT(1 + (id MOD 4), 'new','contacted','approved','rejected')
WHERE status IS NULL OR status = '';

-- ── 12. WhatsApp messages: ensure client linkage for thread display ──
UPDATE whatsapp_messages wm
INNER JOIN (SELECT id, phone FROM clients WHERE phone IS NOT NULL AND phone != '' LIMIT 10) c
    ON c.id = wm.client_id
SET wm.from_number = CASE WHEN wm.direction='inbound' THEN c.phone ELSE '+39055123456' END,
    wm.to_number   = CASE WHEN wm.direction='outbound' THEN c.phone ELSE '+39055123456' END
WHERE wm.from_number IS NULL OR wm.from_number = '';

SELECT 'Seed completed' AS status;
