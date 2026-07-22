-- ============================================================
-- DEMO SEED — Gestionale Immobiliare
-- Run: mysql -u root -proot gestione_immobiliare < database/seeds/seed_demo_full.sql
-- Or via phpMyAdmin / TablePlus: select gestione_immobiliare then import this file.
-- Popola TUTTE le tabelle con dati coerenti tra loro.
-- Le stesse persone/immobili compaiono in ogni sezione dell'app.
--
-- Personaggi principali:
--   Proprietari : Roberto Esposito (MI), Francesca Ricci (FI),
--                 Antonio Mancini (RM), Elena Colombo (TO),
--                 Giovanni De Luca (BO — inattivo)
--   Inquilini   : Alessandro Gatti (app. Milano),
--                 Valentina Moretti (app. Roma),
--                 Carlo Ferretti (negozio Torino),
--                 Maria Pellegrini (Bologna — inattiva)
--   Staff       : admin (super), Giulia Marchetti (admin),
--                 Luca Santoro (agente)
--
-- ATTENZIONE: questo script cancella tutti i dati esistenti.
-- ============================================================

USE gestione_immobiliare;

SET FOREIGN_KEY_CHECKS = 0;

-- ── SVUOTA TUTTE LE TABELLE (ordine inverso FK) ──────────────
TRUNCATE TABLE login_attempts;
TRUNCATE TABLE activity_log;
TRUNCATE TABLE esign_requests;
TRUNCATE TABLE tenant_surveys;
TRUNCATE TABLE buildings;
TRUNCATE TABLE meter_readings;
TRUNCATE TABLE property_insurance;
TRUNCATE TABLE property_appraisals;
TRUNCATE TABLE property_inventory;
TRUNCATE TABLE property_price_history;
TRUNCATE TABLE property_keys;
TRUNCATE TABLE agent_commissions;
TRUNCATE TABLE invoices;
TRUNCATE TABLE expenses;
TRUNCATE TABLE property_applications;
TRUNCATE TABLE lead_property_matches;
TRUNCATE TABLE appointments;
TRUNCATE TABLE leads;
TRUNCATE TABLE whatsapp_messages;
TRUNCATE TABLE whatsapp_templates;
TRUNCATE TABLE email_templates;
TRUNCATE TABLE social_posts;
TRUNCATE TABLE social_settings;
TRUNCATE TABLE payment_reminder_log;
TRUNCATE TABLE stripe_payments;
TRUNCATE TABLE payments;
TRUNCATE TABLE pdf_documents;
TRUNCATE TABLE contracts;
TRUNCATE TABLE documents;
TRUNCATE TABLE communications;
TRUNCATE TABLE reminders;
TRUNCATE TABLE tenant_users;
TRUNCATE TABLE tenants;
TRUNCATE TABLE property_media;
TRUNCATE TABLE properties;
TRUNCATE TABLE clients;
TRUNCATE TABLE suppliers;
TRUNCATE TABLE admin_users;
TRUNCATE TABLE app_settings;

SET FOREIGN_KEY_CHECKS = 1;

-- ════════════════════════════════════════════════════════════
-- 1. ADMIN USERS
--    Hash = bcrypt('changeme123') — matches ADMIN_PASSWORD in .env.docker
-- ════════════════════════════════════════════════════════════
INSERT INTO admin_users (id, username, password_hash, role, email, is_active) VALUES
(1, 'admin',            '$2y$10$zLmkw5b9vri18uHZfPlqUOaBRjD2rNegzCZwchkzF2ookZIbWqqOK', 'super_admin', 'krsiti.komini@gmail.com',          1),
(2, 'giulia.marchetti', '$2y$10$zLmkw5b9vri18uHZfPlqUOaBRjD2rNegzCZwchkzF2ookZIbWqqOK', 'admin',       'giulia.marchetti@gestionale-immobiliare.it', 1),
(3, 'luca.santoro',     '$2y$10$zLmkw5b9vri18uHZfPlqUOaBRjD2rNegzCZwchkzF2ookZIbWqqOK', 'agent',       'luca.santoro@gestionale-immobiliare.it',     1);

-- ════════════════════════════════════════════════════════════
-- 2. APP SETTINGS
-- ════════════════════════════════════════════════════════════
INSERT INTO app_settings (setting_key, setting_value) VALUES
('agency_name',          'Gestionale Immobiliare'),
('agency_email',         'info@gestionale-immobiliare.it'),
('agency_phone',         '+39 02 1234 5678'),
('agency_address',       'Via Montenapoleone 10, 20121 Milano MI'),
('agency_vat',           'IT12345678901'),
('currency',             'EUR'),
('smtp_host',            'smtp.gmail.com'),
('smtp_port',            '587'),
('smtp_encryption',      'tls'),
('smtp_user',            'noreply@gestionale-immobiliare.it'),
('smtp_from_name',       'Gestionale Immobiliare'),
('logo_path',            ''),
('dashboard_quick_links','[]'),
('stripe_mode',          'test'),
('whatsapp_from',        '+39 02 1234 5678');

-- ════════════════════════════════════════════════════════════
-- 3. SUPPLIERS (fornitori/artigiani)
-- ════════════════════════════════════════════════════════════
INSERT INTO suppliers (id, name, category, phone, email, address, notes, rating, is_active) VALUES
(1, 'Mario Fontana Idraulica',   'idraulico',    '+39 02 9876 5432', 'mario.fontana@idraulica.it',      'Via Savona 3, Milano',          'Interviene entro 24h. Ottimo per emergenze.',           5, 1),
(2, 'Elettro Bianchi Srl',       'elettricista', '+39 02 8765 4321', 'info@elettrobianchi.it',           'Via Tortona 60, Milano',         'Certificati IMQ. Disponibili sabato mattina.',          4, 1),
(3, 'Costruzioni Ferrara',        'muratore',     '+39 055 7654 321', 'costruzioni.ferrara@email.it',     'Via Nazionale 22, Firenze',      'Specializzati ristrutturazioni di pregio.',             4, 1),
(4, 'Verde & Giardini Srl',       'giardiniere',  '+39 011 6543 210', 'info@verdegiardini.it',            'Corso Re Umberto 45, Torino',    'Manutenzione spazi verdi condominiali.',               3, 1),
(5, 'Pulizie Express Roma',       'pulizie',      '+39 06 5432 1098', 'info@pulizieroma.it',               'Via Nazionale 88, Roma',         'Pulizie fine locazione e ordinaria.',                   4, 1),
(6, 'Falegnameria Lombarda',      'falegname',    '+39 02 4321 0987', 'info@falegnamelombarda.it',        'Via Vigevano 11, Milano',        'Infissi, porte, parquet. Preventivo gratuito.',         5, 1),
(7, 'Termoidraulica Rossi Roma',  'idraulico',    '+39 06 3210 9876', 'termoidraulica.rossi@roma.it',     'Via Appia Antica 200, Roma',     'Caldaie e impianti termici. Pronto intervento.',        4, 1);

-- ════════════════════════════════════════════════════════════
-- 4. CLIENTS (proprietari)
-- ════════════════════════════════════════════════════════════
INSERT INTO clients (id, name, surname, phone, email, internal_notes, status) VALUES
(1, 'Roberto',   'Esposito',  '+39 333 111 2345', 'roberto.esposito@gmail.com',  'Cliente storico dal 2020. Preferisce comunicazione via email. Possiede due immobili a Milano.', 'active'),
(2, 'Francesca', 'Ricci',     '+39 347 222 3456', 'francesca.ricci@libero.it',    'Vuole vendere la villa a Firenze. Prezzo minimo 620.000€. In trattativa con famiglia straniera.', 'active'),
(3, 'Antonio',   'Mancini',   '+39 339 333 4567', 'antonio.mancini@gmail.com',    'Due immobili a Roma: uno in affitto, uno in vendita. Puntuale e collaborativo.', 'active'),
(4, 'Elena',     'Colombo',   '+39 348 444 5678', 'elena.colombo@hotmail.it',     'Negozio a Torino con inquilino affidabile. Richiede rendiconto mensile dettagliato.', 'active'),
(5, 'Giovanni',  'De Luca',   '+39 331 555 6789', 'giovanni.deluca@gmail.com',    'Immobile Bologna ceduto in gestione, contratto scaduto. Contatto non più attivo.', 'inactive');

-- ════════════════════════════════════════════════════════════
-- 5. PROPERTIES (immobili)
--    Proprietà 1-2: Roberto Esposito, Milano
--    Proprietà 3  : Francesca Ricci, Firenze
--    Proprietà 4-5: Antonio Mancini, Roma
--    Proprietà 6  : Elena Colombo, Torino
--    Proprietà 7  : Giovanni De Luca, Bologna (archived)
-- ════════════════════════════════════════════════════════════
INSERT INTO properties
  (id, client_id, address, city, cap, province, property_type,
   sqm, rooms, bathrooms, floor, description, additional_features,
   internal_notes, status, price, price_type,
   latitude, longitude, geo_confidence)
VALUES
(1, 1, 'Via Tortona 28',            'Milano',  '20144', 'MI', 'appartamento',
 75.00, 3, 1, '2°',
 'Appartamento luminoso in zona Navigli-Tortona. Completamente ristrutturato nel 2021 con materiali di qualità. Cucina separata, soggiorno con affaccio su cortile interno tranquillo.',
 'Balcone, cantina, riscaldamento autonomo, doppi vetri, predisposizione aria condizionata',
 'Immobile in ottimo stato. Inquilino puntuale. Contratto 4+4, scadenza dicembre 2026.',
 'rented', 900.00, 'affitto', 45.4563, 9.1738, 'exact'),

(2, 1, 'Corso Buenos Aires 44',     'Milano',  '20124', 'MI', 'ufficio',
 120.00, NULL, 2, '3°',
 'Ufficio di rappresentanza in zona commerciale primaria. Open space con sala riunioni separata, due bagni, reception. Ideale per studi professionali o agenzie.',
 'Ascensore, climatizzazione centralizzata, fibra ottica, portineria h24, posto auto',
 'Disponibile da subito. Ex locatario trasferito a febbraio. Ristrutturazione parziale eseguita a marzo.',
 'available', 2200.00, 'affitto', 45.4774, 9.2027, 'exact'),

(3, 2, 'Via dei Servi 15',          'Firenze', '50122', 'FI', 'villa',
 200.00, 6, 3, 'T',
 'Splendida villa storica nel cuore di Firenze a pochi passi dal Duomo. Piano terra con salone d\'ingresso, salotto, cucina attrezzata, studio. Primo piano con 4 camere da letto, 2 bagni. Giardino privato sul retro.',
 'Giardino privato 80mq, garage doppio, cantina, soffitti affrescati originali, riscaldamento centralizzato, impianto domotica',
 'Proprietaria tratta solo sopra 620k. Tre visite già effettuate. Trattativa in corso con famiglia Romano.',
 'available', 650000.00, 'vendita', 43.7731, 11.2561, 'exact'),

(4, 3, 'Via Appia Nuova 334',       'Roma',    '00181', 'RM', 'appartamento',
 65.00, 2, 1, '1°',
 'Appartamento funzionale in zona Appio Latino. Ingresso, soggiorno con angolo cottura, camera da letto matrimoniale, bagno. Completamente arredato e in buono stato.',
 'Arredato, cantina, posto auto condominiale scoperto, citofono',
 'Inquilina molto affidabile, ha rinnovato il contratto. Contratto scade agosto 2025.',
 'rented', 750.00, 'affitto', 41.8734, 12.5326, 'exact'),

(5, 3, 'Viale Parioli 22',          'Roma',    '00197', 'RM', 'appartamento',
 90.00, 4, 2, '4°',
 'Elegante appartamento nel prestigioso quartiere Parioli. Ingresso con guardaroba, ampio soggiorno, cucina abitabile, 3 camere da letto, 2 bagni. Vista sui pini romani. Ottima esposizione.',
 'Ascensore, portineria, posto auto coperto, cantina, terrazzino, riscaldamento centralizzato',
 'Prezzo trattabile sotto i 420k. Necessaria sostituzione infissi prima della vendita. Visite su appuntamento.',
 'available', 420000.00, 'vendita', 41.9197, 12.5028, 'exact'),

(6, 4, 'Corso Vittorio Emanuele 18','Torino',  '10128', 'TO', 'negozio',
 55.00, NULL, 1, 'T',
 'Negozio su strada principale con ottima visibilità. Ampia vetrina doppia, zona vendita open space, retro-bottega con accesso secondario, bagno con antibagno.',
 'Vetrina doppia, cella frigorifera, impianto antifurto, serranda motorizzata, scarico fognario',
 'Inquilino affidabile (negozio abbigliamento Moda Ferretti). Contratto commerciale 6+6, scadenza febbraio 2026.',
 'rented', 1200.00, 'affitto', 45.0678, 7.6825, 'exact'),

(7, 5, 'Via Rizzoli 10',            'Bologna', '40125', 'BO', 'appartamento',
 80.00, 3, 1, '2°',
 'Appartamento in posizione centralissima vicino alle Due Torri. Tre camere, salone, cucina, bagno. Da ristrutturare, impianti da aggiornare.',
 'Cantina, ascensore condominiale',
 'Contratto scaduto dicembre 2023. Proprietario ha ceduto la gestione. Da decidere se vendere o rimettere in locazione.',
 'archived', 850.00, 'affitto', 44.4938, 11.3430, 'street');

-- APE energy classes for the demo properties. Legally the class must appear in
-- every listing/contract (D.Lgs 192/2005); populated here so the demo is compliant.
UPDATE properties SET energy_class = CASE id
    WHEN 1 THEN 'C'  WHEN 2 THEN 'B'  WHEN 3 THEN 'G'  WHEN 4 THEN 'D'
    WHEN 5 THEN 'A2' WHEN 6 THEN 'E'  WHEN 7 THEN 'F'  ELSE energy_class END
WHERE id BETWEEN 1 AND 7;

-- ════════════════════════════════════════════════════════════
-- 6. PROPERTY MEDIA
-- ════════════════════════════════════════════════════════════
INSERT INTO property_media
  (id, property_id, media_type, file_path, original_name, mime_type, file_size, sort_order)
VALUES
-- Proprietà 1: Via Tortona Milano
(1,  1, 'photo',      'uploads/properties/1/foto_ingresso.jpg',     'foto_ingresso.jpg',     'image/jpeg', 245760, 0),
(2,  1, 'photo',      'uploads/properties/1/foto_soggiorno.jpg',    'foto_soggiorno.jpg',    'image/jpeg', 312400, 1),
(3,  1, 'photo',      'uploads/properties/1/foto_cucina.jpg',       'foto_cucina.jpg',       'image/jpeg', 198500, 2),
(4,  1, 'floor_plan', 'uploads/properties/1/planimetria.pdf',       'planimetria.pdf',       'application/pdf', 102400, 3),
-- Proprietà 2: Corso Buenos Aires Milano
(5,  2, 'photo',      'uploads/properties/2/foto_openspace.jpg',    'foto_openspace.jpg',    'image/jpeg', 389200, 0),
(6,  2, 'photo',      'uploads/properties/2/foto_sala_riunioni.jpg','foto_sala_riunioni.jpg','image/jpeg', 278300, 1),
(7,  2, 'floor_plan', 'uploads/properties/2/planimetria_ufficio.pdf','planimetria_ufficio.pdf','application/pdf', 134200, 2),
-- Proprietà 3: Villa Firenze
(8,  3, 'photo',      'uploads/properties/3/foto_facciata.jpg',     'foto_facciata.jpg',     'image/jpeg', 512000, 0),
(9,  3, 'photo',      'uploads/properties/3/foto_giardino.jpg',     'foto_giardino.jpg',     'image/jpeg', 487300, 1),
(10, 3, 'photo',      'uploads/properties/3/foto_salone.jpg',       'foto_salone.jpg',       'image/jpeg', 423100, 2),
(11, 3, 'photo',      'uploads/properties/3/foto_cucina.jpg',       'foto_cucina.jpg',       'image/jpeg', 356700, 3),
(12, 3, 'floor_plan', 'uploads/properties/3/planimetria_villa.pdf', 'planimetria_villa.pdf', 'application/pdf', 245800, 4),
-- Proprietà 4: Via Appia Roma
(13, 4, 'photo',      'uploads/properties/4/foto_principale.jpg',   'foto_principale.jpg',   'image/jpeg', 198400, 0),
(14, 4, 'photo',      'uploads/properties/4/foto_camera.jpg',       'foto_camera.jpg',       'image/jpeg', 167300, 1),
-- Proprietà 5: Viale Parioli Roma
(15, 5, 'photo',      'uploads/properties/5/foto_terrazzo.jpg',     'foto_terrazzo.jpg',     'image/jpeg', 356700, 0),
(16, 5, 'photo',      'uploads/properties/5/foto_soggiorno.jpg',    'foto_soggiorno.jpg',    'image/jpeg', 298500, 1),
(17, 5, 'photo',      'uploads/properties/5/foto_vista.jpg',        'foto_vista.jpg',        'image/jpeg', 412800, 2),
-- Proprietà 6: Negozio Torino
(18, 6, 'photo',      'uploads/properties/6/foto_vetrina.jpg',      'foto_vetrina.jpg',      'image/jpeg', 267800, 0),
(19, 6, 'photo',      'uploads/properties/6/foto_interno.jpg',      'foto_interno.jpg',      'image/jpeg', 234600, 1),
-- Proprietà 7: Bologna
(20, 7, 'photo',      'uploads/properties/7/foto_esterno.jpg',      'foto_esterno.jpg',      'image/jpeg', 188600, 0);

-- Imposta immagini di copertina
UPDATE properties SET cover_media_id = 1  WHERE id = 1;
UPDATE properties SET cover_media_id = 5  WHERE id = 2;
UPDATE properties SET cover_media_id = 8  WHERE id = 3;
UPDATE properties SET cover_media_id = 13 WHERE id = 4;
UPDATE properties SET cover_media_id = 15 WHERE id = 5;
UPDATE properties SET cover_media_id = 18 WHERE id = 6;
UPDATE properties SET cover_media_id = 20 WHERE id = 7;

-- ════════════════════════════════════════════════════════════
-- 7. TENANTS (inquilini)
-- ════════════════════════════════════════════════════════════
-- NOTE: tenants no longer carry property/lease columns — that relationship lives
-- in `contracts` (property_id, tenant_id, start_date, end_date, monthly_rent), see
-- getTenantCurrentContract(). The leases for tenants 1-3 are in the contracts
-- INSERT below; tenant 4 is a historical inactive tenant (lease expired 2023).
INSERT INTO tenants (id, name, surname, email, phone, notes, status) VALUES
(1, 'Alessandro', 'Gatti',      'alessandro.gatti@gmail.com',    '+39 333 901 2345',
 'Impiegato stabile in azienda multinazionale. Referenze ottime. Pagamenti quasi sempre in anticipo. Ha segnalato problema caldaia a giugno 2024.', 'active'),
(2, 'Valentina',  'Moretti',    'valentina.moretti@gmail.com',   '+39 347 802 3456',
 'Insegnante scuola media. Inquilina silenziosa, mantiene l\'immobile in buone condizioni. Lieve ritardo a marzo per problema bancario.', 'active'),
(3, 'Carlo',      'Ferretti',   'carlo.ferretti@modaferretti.it','+39 011 703 4567',
 'Titolare negozio abbigliamento "Moda Ferretti". Puntuale nei pagamenti. Chiede ampliamento spazi nel 2025.', 'active'),
(4, 'Maria',      'Pellegrini', 'maria.pellegrini@libero.it',    '+39 051 604 5678',
 'Contratto scaduto (locazione 2022-2023, Via Larga 7). Ha rilasciato l\'immobile in buone condizioni. Deposito restituito integralmente.', 'inactive');

-- ════════════════════════════════════════════════════════════
-- 8. TENANT PORTAL USERS
--    Hash = bcrypt('password') — demo soltanto
-- ════════════════════════════════════════════════════════════
INSERT INTO tenant_users (tenant_id, password_hash) VALUES
(1, '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uHV1i7m..'),
(2, '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uHV1i7m..'),
(3, '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uHV1i7m..');

-- ════════════════════════════════════════════════════════════
-- 9. PAYMENTS (scadenzario affitti)
--    Inquilino 1 — Alessandro Gatti, prop. 1, €900
--    Inquilino 2 — Valentina Moretti, prop. 4, €750
--    Inquilino 3 — Carlo Ferretti,   prop. 6, €1200
-- ════════════════════════════════════════════════════════════
INSERT INTO payments (id, tenant_id, property_id, amount, due_date, paid_date, status, notes) VALUES
-- Gatti
( 1, 1, 1,  900.00, '2024-01-05', '2024-01-03', 'paid',    'Bonifico anticipato'),
( 2, 1, 1,  900.00, '2024-02-05', '2024-02-04', 'paid',    NULL),
( 3, 1, 1,  900.00, '2024-03-05', '2024-03-05', 'paid',    NULL),
( 4, 1, 1,  900.00, '2024-04-05', '2024-04-07', 'paid',    'Leggero ritardo, poi regolarizzato'),
( 5, 1, 1,  900.00, '2024-05-05', '2024-05-05', 'paid',    NULL),
( 6, 1, 1,  900.00, '2024-06-05', NULL,          'late',    'In ritardo — inviato promemoria WhatsApp il 12/06 e email il 17/06'),
( 7, 1, 1,  900.00, '2024-07-05', NULL,          'pending', NULL),
-- Moretti
( 8, 2, 4,  750.00, '2024-01-05', '2024-01-07', 'paid',    NULL),
( 9, 2, 4,  750.00, '2024-02-05', '2024-02-08', 'paid',    NULL),
(10, 2, 4,  750.00, '2024-03-05', NULL,          'late',    'Ritardo per problema internet banking — contatto telefonico avuto il 10/03'),
(11, 2, 4,  750.00, '2024-04-05', NULL,          'pending', NULL),
-- Ferretti
(12, 3, 6, 1200.00, '2024-03-05', '2024-03-03', 'paid',    'Pagamento anticipato, puntualissimo'),
(13, 3, 6, 1200.00, '2024-04-05', '2024-04-04', 'paid',    NULL),
(14, 3, 6, 1200.00, '2024-05-05', '2024-05-03', 'paid',    'Pagato in anticipo come di consueto'),
(15, 3, 6, 1200.00, '2024-06-05', NULL,          'pending', NULL);

-- ════════════════════════════════════════════════════════════
-- 10. STRIPE PAYMENTS
-- ════════════════════════════════════════════════════════════
INSERT INTO stripe_payments (payment_id, tenant_id, stripe_session_id, stripe_payment_intent, amount, currency, status, paid_at) VALUES
(1, 1, 'cs_test_a1b2c3d4e5f6g7h8i9j0', 'pi_test_a1B2c3D4e5F6g7H8', 900.00, 'eur', 'paid', '2024-01-03 10:23:11'),
(8, 2, 'cs_test_b2c3d4e5f6g7h8i9j0k1', 'pi_test_b2C3d4E5f6G7h8I9', 750.00, 'eur', 'paid', '2024-01-07 14:47:32');

-- ════════════════════════════════════════════════════════════
-- 11. PAYMENT REMINDER LOG
-- ════════════════════════════════════════════════════════════
INSERT INTO payment_reminder_log (payment_id, tenant_id, client_id, channel, days_overdue, status) VALUES
( 6, 1, 1, 'whatsapp',  7, 'sent'),
( 6, 1, 1, 'email',    12, 'sent'),
(10, 2, 3, 'email',     5, 'sent'),
(10, 2, 3, 'whatsapp',  8, 'sent');

-- ════════════════════════════════════════════════════════════
-- 12. DOCUMENTS
-- ════════════════════════════════════════════════════════════
INSERT INTO documents (id, doc_type, title, client_id, property_id, file_path, original_name, mime_type, file_size, notes) VALUES
(1, 'contract',  'Contratto locazione Via Tortona 28 — Gatti 2024',        1, 1, 'uploads/documents/contratto_tortona_gatti_2024.pdf',  'contratto_tortona_gatti_2024.pdf',  'application/pdf', 412800, 'Registrato AdE il 15/01/2024. Cedolare secca 21%.'),
(2, 'id',        'C.I. Roberto Esposito',                                   1, NULL,'uploads/documents/ci_esposito_roberto.pdf',           'ci_esposito_roberto.pdf',           'application/pdf', 184320, 'Scadenza 15/03/2028'),
(3, 'id',        'C.I. Francesca Ricci',                                    2, NULL,'uploads/documents/ci_ricci_francesca.pdf',            'ci_ricci_francesca.pdf',            'application/pdf', 176128, 'Scadenza 22/07/2027'),
(4, 'contract',  'Contratto locazione Via Appia Nuova — Moretti 2023',     3, 4, 'uploads/documents/contratto_appia_moretti_2023.pdf',  'contratto_appia_moretti_2023.pdf',  'application/pdf', 398400, 'Registrato 01/09/2023. Prima casa inquilina.'),
(5, 'other',     'Planimetria catastale Corso V.E. 18 Torino',             4, 6, 'uploads/documents/planimetria_torino_corso.pdf',       'planimetria_torino_corso.pdf',      'application/pdf', 892400, 'Aggiornata aprile 2023. Conforme.'),
(6, 'invoice',   'Fattura agenzia n. FAT-2024-001',                        1, 1, 'uploads/documents/fattura_agenzia_001_2024.pdf',       'fattura_agenzia_001_2024.pdf',      'application/pdf', 102400, NULL),
(7, 'id',        'C.I. Antonio Mancini',                                    3, NULL,'uploads/documents/ci_mancini_antonio.pdf',            'ci_mancini_antonio.pdf',            'application/pdf', 192512, 'Scadenza 10/11/2029'),
(8, 'contract',  'Mandato di vendita esclusivo — Villa dei Servi Firenze', 2, 3, 'uploads/documents/mandato_vendita_firenze.pdf',        'mandato_vendita_firenze.pdf',       'application/pdf', 287744, 'Mandato in esclusiva 6 mesi. In attesa firma digitale.'),
(9, 'id',        'C.I. Elena Colombo',                                      4, NULL,'uploads/documents/ci_colombo_elena.pdf',              'ci_colombo_elena.pdf',              'application/pdf', 168960, 'Scadenza 30/06/2026'),
(10,'contract',  'Contratto locazione Corso V.E. 18 Torino — Ferretti 2024',4, 6, 'uploads/documents/contratto_torino_ferretti_2024.pdf','contratto_torino_ferretti_2024.pdf','application/pdf', 421200, 'Uso commerciale. Adeguamento ISTAT annuale.');

-- ════════════════════════════════════════════════════════════
-- 13. CONTRACTS (contratti)
-- ════════════════════════════════════════════════════════════
-- NOTE: contracts has no `document_id` column (generated PDFs live in
-- pdf_documents / documents, linked the other way). Column removed to match schema.
INSERT INTO contracts (id, property_id, tenant_id, client_id, title, contract_type, status, start_date, end_date, monthly_rent, deposit, notes, created_by) VALUES
(1, 1, 1, 1, 'Locazione Via Tortona 28 — Gatti 2024-2026',         'locazione',    'signed', '2024-01-01', '2026-12-31', 900.00,   1800.00, 'Contratto 4+4. Prima registrazione. Cedolare secca 21%. Deposito versato.',    1),
(2, 4, 2, 3, 'Locazione Via Appia Nuova 334 — Moretti 2023-2025',  'locazione',    'signed', '2023-09-01', '2025-08-31', 750.00,   1500.00, 'Contratto transitorio 18 mesi. Rinnovo automatico salvo disdetta 60gg.',       2),
(3, 6, 3, 4, 'Locazione C.so V. Emanuele 18 — Ferretti 2024-2026', 'locazione',    'signed', '2024-03-01', '2026-02-28', 1200.00,  2400.00, 'Uso commerciale 6+6. Adeguamento ISTAT ogni anno a marzo.',                   1),
(4, 3, NULL,2,'Mandato esclusiva vendita Villa dei Servi — Ricci',  'mandato',      'sent',   '2024-02-01', '2024-08-01', NULL,     NULL,    'Mandato in esclusiva 6 mesi. Prezzo minimo €620.000. Provvigione 3%+IVA.',    2),
(5, 5, NULL,3,'Mandato vendita Viale Parioli 22 — Mancini',         'mandato',      'draft',  '2024-04-01', NULL,         NULL,     NULL,    'Da formalizzare. Cliente vuole aspettare settembre per migliore offerta.',    1);

-- ════════════════════════════════════════════════════════════
-- 14. PDF DOCUMENTS (documenti generati)
-- ════════════════════════════════════════════════════════════
INSERT INTO pdf_documents (doc_type, title, client_id, property_id, tenant_id, file_path, created_by) VALUES
('contract', 'Contratto Locazione Gatti — Via Tortona 2024',     1, 1, 1, 'uploads/pdf/contratto_gatti_tortona_2024.pdf',  1),
('report',   'Rendiconto Esposito — Gennaio 2024',               1, 1, NULL,'uploads/pdf/rendiconto_esposito_gen2024.pdf',  1),
('contract', 'Contratto Locazione Moretti — Via Appia 2023',     3, 4, 2, 'uploads/pdf/contratto_moretti_appia_2023.pdf',  2),
('contract', 'Contratto Locazione Ferretti — Torino 2024',       4, 6, 3, 'uploads/pdf/contratto_ferretti_torino_2024.pdf',1),
('invoice',  'Fattura FAT-2024-001 — Esposito',                  1, NULL,NULL,'uploads/pdf/fattura_001_2024_esposito.pdf', 1),
('report',   'Rendiconto Colombo — Aprile 2024',                 4, 6, NULL,'uploads/pdf/rendiconto_colombo_apr2024.pdf',  2),
('mandato',  'Mandato Vendita Firenze — Ricci',                  2, 3, NULL,'uploads/pdf/mandato_vendita_firenze.pdf',      2);

-- ════════════════════════════════════════════════════════════
-- 15. COMMUNICATIONS (email scambiate)
-- ════════════════════════════════════════════════════════════
INSERT INTO communications (client_id, direction, channel, subject, body, from_email, to_email, status, created_at) VALUES
-- Roberto Esposito — thread manutenzione
(1,'received','email','Segnalazione guasto caldaia',
 'Buongiorno, l\'inquilino mi ha contattato lamentando un problema alla caldaia in Via Tortona 28. Potete intervenire al più presto? Grazie.',
 'roberto.esposito@gmail.com','info@gestionale-immobiliare.it','received', DATE_SUB(NOW(), INTERVAL 14 DAY)),
(1,'sent','email','Re: Segnalazione guasto caldaia',
 'Gentile Roberto, abbiamo già contattato il nostro idraulico di fiducia Mario Fontana. Interverrà martedì mattina. La aggiorneremo sull\'esito.',
 'info@gestionale-immobiliare.it','roberto.esposito@gmail.com','delivered', DATE_SUB(NOW(), INTERVAL 13 DAY)),
(1,'received','email','Re: Segnalazione guasto caldaia',
 'Perfetto, grazie per la rapidità. Resto in attesa dell\'esito.',
 'roberto.esposito@gmail.com','info@gestionale-immobiliare.it','received', DATE_SUB(NOW(), INTERVAL 12 DAY)),
-- Roberto Esposito — thread pagamento giugno
(1,'sent','email','Pagamento affitto giugno 2024 in ritardo',
 'Gentile Roberto, la informiamo che il pagamento del canone di giugno da parte di Alessandro Gatti risulta ancora non pervenuto. Abbiamo già inviato promemoria all\'inquilino via WhatsApp e email.',
 'info@gestionale-immobiliare.it','roberto.esposito@gmail.com','delivered', DATE_SUB(NOW(), INTERVAL 5 DAY)),
(1,'received','email','Re: Pagamento affitto giugno 2024 in ritardo',
 'Capisco, tenetemi aggiornato. Se non arriva entro fine settimana provvederò ad avvisarlo direttamente.',
 'roberto.esposito@gmail.com','info@gestionale-immobiliare.it','received', DATE_SUB(NOW(), INTERVAL 4 DAY)),
-- Francesca Ricci — thread mandato vendita
(2,'sent','email','Mandato vendita Villa dei Servi — conferma invio',
 'Gentile Francesca, le inviamo il mandato di vendita in esclusiva per la villa in Via dei Servi 15. Abbiamo già ricevuto 3 richieste di visita per marzo. La preghiamo di firmare e restituire.',
 'info@gestionale-immobiliare.it','francesca.ricci@libero.it','delivered', DATE_SUB(NOW(), INTERVAL 20 DAY)),
(2,'received','email','Re: Mandato vendita Villa dei Servi',
 'Grazie. Ho firmato il mandato e lo rispedisco domani. Ricordate però che non scendo sotto i 620.000€, non i 600k che avevamo discusso.',
 'francesca.ricci@libero.it','info@gestionale-immobiliare.it','received', DATE_SUB(NOW(), INTERVAL 19 DAY)),
(2,'sent','email','Re: Mandato vendita Villa dei Servi — prezzo confermato',
 'Gentile Francesca, abbiamo aggiornato il mandato con prezzo minimo €620.000 come richiesto. La famiglia Romano (potenziali acquirenti) ha espresso forte interesse. Visita fissata per la prossima settimana.',
 'info@gestionale-immobiliare.it','francesca.ricci@libero.it','delivered', DATE_SUB(NOW(), INTERVAL 17 DAY)),
-- Antonio Mancini — thread scadenza contratto
(3,'sent','email','Scadenza contratto Moretti — Via Appia — agosto 2025',
 'Gentile Antonio, la informiamo che il contratto con la sig.ra Moretti in Via Appia Nuova scadrà il 31 agosto 2025. La invitiamo a comunicarci entro 60 giorni le sue intenzioni (rinnovo o disdetta).',
 'info@gestionale-immobiliare.it','antonio.mancini@gmail.com','delivered', DATE_SUB(NOW(), INTERVAL 30 DAY)),
(3,'received','email','Re: Scadenza contratto Moretti',
 'Buongiorno, preferirei rinnovare se la sig.ra Moretti è disponibile. Magari con un adeguamento ISTAT del 3%. Può sondare lei?',
 'antonio.mancini@gmail.com','info@gestionale-immobiliare.it','received', DATE_SUB(NOW(), INTERVAL 28 DAY)),
-- Elena Colombo — rendiconto mensile
(4,'sent','email','Rendiconto mensile maggio 2024 — Corso V.E. 18 Torino',
 'Gentile Elena, in allegato il rendiconto di maggio 2024. Affitto incassato: €1.200. Commissione gestione 8%: €96. Netto a suo favore: €1.104. Accredito entro 3 gg lavorativi.',
 'info@gestionale-immobiliare.it','elena.colombo@hotmail.it','delivered', DATE_SUB(NOW(), INTERVAL 7 DAY)),
(4,'received','email','Re: Rendiconto mensile maggio 2024',
 'Ricevuto, grazie. Ho notato che il pagamento di giugno non è ancora visibile — potete aggiornare quando arriva? E c\'è notizia della polizza assicurativa?',
 'elena.colombo@hotmail.it','info@gestionale-immobiliare.it','received', DATE_SUB(NOW(), INTERVAL 6 DAY)),
(4,'sent','email','Re: Rendiconto maggio — polizza e pagamento giugno',
 'Gentile Elena, il pagamento di giugno è atteso entro il 5 del mese. Per la polizza assicurativa abbiamo creato un promemoria di rinnovo: la contatteremo appena ricevuta la proposta dalla compagnia.',
 'info@gestionale-immobiliare.it','elena.colombo@hotmail.it','delivered', DATE_SUB(NOW(), INTERVAL 5 DAY));

-- ════════════════════════════════════════════════════════════
-- 16. WHATSAPP MESSAGES
-- ════════════════════════════════════════════════════════════
INSERT INTO whatsapp_messages (direction, from_number, to_number, body, client_id, tenant_id, is_read, received_at) VALUES
('outbound','+390212345678','+393339012345',
 'Gentile Alessandro, le ricordiamo che il canone di giugno 2024 (€900) risulta ancora non pervenuto. Può effettuare il bonifico al più presto? Grazie — Gestionale Immobiliare.',
 1, 1, 1, DATE_SUB(NOW(), INTERVAL 8 DAY)),
('inbound', '+393339012345','+390212345678',
 'Salve, sono spiacente per il ritardo. Effettuerò il pagamento entro venerdì prossimo. Grazie per la comprensione.',
 1, 1, 1, DATE_SUB(NOW(), INTERVAL 7 DAY)),
('outbound','+390212345678','+393478023456',
 'Sig.ra Moretti, buongiorno. Il canone di marzo 2024 (€750) non risulta ancora accreditato. La preghiamo di verificare e regolarizzare al più presto.',
 3, 2, 1, DATE_SUB(NOW(), INTERVAL 10 DAY)),
('inbound', '+393478023456','+390212345678',
 'Buongiorno, ho avuto problemi con l\'internet banking. Ho disposto il bonifico ieri sera, dovrebbe arrivare in giornata. Mi scuso per il disagio.',
 3, 2, 1, DATE_SUB(NOW(), INTERVAL 9 DAY)),
('outbound','+390212345678','+393339012345',
 'Promemoria: visita immobile Via Tortona 28 fissata giovedì 20 giugno alle 10:00. L\'agente Luca Santoro sarà presente. Conferma ricezione?',
 1, 1, 0, DATE_SUB(NOW(), INTERVAL 2 DAY)),
('outbound','+390212345678','+390117034567',
 'Gentile Carlo, la informiamo che la polizza assicurativa del negozio è in scadenza a luglio. La ricontatteremo a breve per il rinnovo. Buona giornata — Gestionale Immobiliare.',
 4, 3, 1, DATE_SUB(NOW(), INTERVAL 15 DAY));

-- ════════════════════════════════════════════════════════════
-- 17. REMINDERS (promemoria e manutenzioni)
-- ════════════════════════════════════════════════════════════
INSERT INTO reminders
  (id, title, description, reminder_date, end_date, frequency, status,
   client_id, property_id, notify_admin, notify_client,
   email_subject, email_body,
   supplier_id, supplier_name, maintenance_status,
   priority, request_type, category, tenant_name)
VALUES
(1, 'Guasto caldaia Via Tortona 28',
 'Alessandro Gatti ha segnalato malfunzionamento caldaia il 10/06/2024. Contattare Mario Fontana per intervento urgente.',
 DATE_ADD(NOW(), INTERVAL 1 DAY), NULL, 'once', 'pending',
 1, 1, 1, 0,
 'Intervento urgente caldaia — Via Tortona 28',
 'È necessario un intervento urgente alla caldaia di Via Tortona 28, Milano. Contattare il tecnico appena possibile.',
 1, 'Mario Fontana Idraulica', 'aperta', 'urgente', 'Manutenzione caldaia', 'Urgente', 'Alessandro Gatti'),

(2, 'Scadenza contratto Gatti — dicembre 2026',
 'Contattare proprietario e inquilino almeno 6 mesi prima della scadenza per definire rinnovo o disdetta.',
 '2026-06-01 09:00:00', NULL, 'once', 'pending',
 1, 1, 1, 1,
 'Contratto in scadenza — Via Tortona 28',
 'Il contratto di locazione in Via Tortona 28 scade a dicembre 2026. Contattare le parti per definire il rinnovo.',
 NULL, NULL, 'aperta', 'alta', 'Altro', 'Ordinaria', 'Alessandro Gatti'),

(3, 'Rinnovo contratto Moretti — scadenza agosto 2025',
 'Verificare intenzioni proprietario e inquilina per rinnovo con adeguamento ISTAT 3%.',
 '2025-02-01 09:00:00', NULL, 'once', 'pending',
 3, 4, 1, 1,
 'Contratto in scadenza agosto 2025 — Via Appia Nuova',
 'Il contratto con Valentina Moretti scade il 31/08/2025. Contattare entrambe le parti per valutare rinnovo.',
 NULL, NULL, 'in_lavorazione', 'alta', 'Altro', 'Ordinaria', 'Valentina Moretti'),

(4, 'Report mensile proprietari',
 'Inviare rendiconto mensile a tutti i proprietari con affitti attivi (Esposito, Mancini, Colombo).',
 DATE_ADD(NOW(), INTERVAL 5 DAY), NULL, 'monthly', 'pending',
 NULL, NULL, 1, 0,
 'Rendiconto mensile — Gestionale Immobiliare',
 'In allegato il rendiconto mensile relativo agli immobili in gestione.',
 NULL, NULL, 'completata', 'normale', 'Altro', 'Ordinaria', NULL),

(5, 'Ispezione impianto elettrico Villa Firenze',
 'Verifica quadro elettrico e messa a norma per immobile in vendita. Necessaria prima di eventuali offerte d\'acquisto.',
 DATE_ADD(NOW(), INTERVAL 15 DAY), NULL, 'yearly', 'pending',
 2, 3, 1, 0,
 'Ispezione elettrica — Villa dei Servi Firenze',
 'Ricordiamo l\'ispezione annuale all\'impianto elettrico della villa. Contattare Elettro Bianchi Srl.',
 2, 'Elettro Bianchi Srl', 'in_lavorazione', 'normale', 'Problema elettrico', 'Preventiva', NULL),

(6, 'Pulizie fine locazione Bologna',
 'Immobile liberato. Organizzare pulizie approfondite e sopralluogo prima di decisione sulla destinazione futura.',
 DATE_SUB(NOW(), INTERVAL 3 DAY), NULL, 'once', 'completed',
 5, 7, 1, 0,
 'Pulizie fine locazione — Via Rizzoli Bologna',
 'Organizzare pulizie dopo rilascio immobile e sopralluogo con proprietario.',
 5, 'Pulizie Express Roma', 'completata', 'bassa', 'Altro', 'Straordinaria', 'Maria Pellegrini'),

(7, 'Rinnovo polizza assicurativa negozio Torino',
 'Polizza scade a luglio 2024. Richiedere preventivo rinnovo con clausola responsabilità civile per uso commerciale.',
 DATE_ADD(NOW(), INTERVAL 20 DAY), NULL, 'yearly', 'pending',
 4, 6, 1, 0,
 'Rinnovo polizza — Corso V.E. 18 Torino',
 'La polizza assicurativa per il negozio di Torino scade il prossimo luglio. Richiedere preventivo rinnovo.',
 NULL, NULL, 'aperta', 'alta', 'Altro', 'Ordinaria', 'Carlo Ferretti'),

(8, 'Sostituzione infissi Parioli prima della vendita',
 'Sopralluogo tecnico per valutare sostituzione finestre prima di mettere in vendita. Preventivo Falegnameria Lombarda richiesto.',
 DATE_ADD(NOW(), INTERVAL 10 DAY), NULL, 'once', 'pending',
 3, 5, 1, 0,
 'Riparazione infissi — Viale Parioli 22 Roma',
 'Prima della messa in vendita è necessaria la sostituzione degli infissi. Preventivo in fase di valutazione.',
 6, 'Falegnameria Lombarda', 'in_lavorazione', 'normale', 'Riparazione infissi', 'Straordinaria', NULL),

(9, 'Potatura giardino villa Firenze — primavera',
 'Manutenzione ordinaria giardino 80mq prima delle visite di primavera. Comprende potatura, pulizia grondaie e tinteggiatura cancello.',
 DATE_SUB(NOW(), INTERVAL 10 DAY), NULL, 'yearly', 'completed',
 2, 3, 1, 0,
 'Manutenzione giardino Villa Firenze',
 'Programmata manutenzione ordinaria del giardino prima dell\'inizio delle visite primaverili.',
 3, 'Costruzioni Ferrara', 'chiusa', 'bassa', 'Altro', 'Ordinaria', NULL),

(10, 'Lettura contatori immobili in affitto — semestrale',
 'Raccogliere letture gas, luce e acqua per gli immobili Via Tortona 28, Via Appia Nuova 334 e Corso V.E. 18 Torino.',
 DATE_ADD(NOW(), INTERVAL 8 DAY), NULL, 'biweekly', 'pending',
 NULL, NULL, 1, 0,
 'Lettura contatori semestrale',
 'Ricordiamo la raccolta delle letture contatori semestrali per gli immobili in affitto.',
 NULL, NULL, 'aperta', 'normale', 'Altro', 'Preventiva', NULL);

-- ════════════════════════════════════════════════════════════
-- 18. LEADS (potenziali clienti)
-- ════════════════════════════════════════════════════════════
INSERT INTO leads
  (id, name, surname, phone, email, interest_type, budget_min, budget_max,
   preferred_city, preferred_type, min_rooms, min_sqm, status, source, assigned_to, notes)
VALUES
(1, 'Marco',  'Ferrari',   '+39 333 211 4567', 'marco.ferrari@gmail.com',
 'affitto',  700.00,   1000.00, 'Milano',  'appartamento', 2, 50.00,
 'interested', 'web', 3,
 'Cerca bilocale o trilocale zona Navigli/Tortona. Visto annuncio Via Tortona. Disponibile da settembre 2024.'),
(2, 'Sara',   'Conti',     '+39 347 322 5678', 'sara.conti@hotmail.it',
 'acquisto', 350000, 450000, 'Roma',    'appartamento', 3, 70.00,
 'negotiating', 'passaparola', 2,
 'Molto interessata appartamento Parioli. Offerta informale 390k. Vuole seconda visita con marito e geometra.'),
(3, 'Luca',   'Romano',    '+39 339 433 6789', 'luca.romano@libero.it',
 'acquisto', 500000, 700000, 'Firenze', 'villa',        5, 150.00,
 'contacted', 'telefono', 3,
 'Famiglia con tre bambini. Fortemente interessata alla villa Firenze. Ha già visto le foto, vuole visita con geometra.'),
(4, 'Chiara', 'Vitale',    '+39 348 544 7890', 'chiara.vitale@gmail.com',
 'affitto',  800.00,  1500.00, 'Milano',  'ufficio',     NULL, 80.00,
 'new', 'web', NULL,
 'Studio di architettura con 3 collaboratori. Cerca ufficio zona centrale Milano. Candidatura online ricevuta.'),
(5, 'Paolo',  'Greco',     '+39 331 655 8901', 'paolo.greco@yahoo.it',
 'acquisto', 380000, 430000, 'Roma',    'appartamento', 3, 80.00,
 'converted', 'email', 2,
 'Convertito in cliente attivo. Ha acquistato immobile tramite agenzia nel 2023. Lead chiuso positivamente.');

-- ════════════════════════════════════════════════════════════
-- 19. LEAD-PROPERTY MATCHES
-- ════════════════════════════════════════════════════════════
INSERT INTO lead_property_matches (lead_id, property_id) VALUES
(1, 1),
(1, 2),
(2, 5),
(3, 3),
(4, 2);

-- ════════════════════════════════════════════════════════════
-- 20. APPOINTMENTS (visite)
-- ════════════════════════════════════════════════════════════
INSERT INTO appointments (property_id, lead_id, client_id, agent_id, appointment_date, duration_minutes, status, notes) VALUES
(3, 3, 2, 3, DATE_ADD(NOW(), INTERVAL 4 DAY),   90, 'scheduled',
 'Prima visita famiglia Romano alla villa. Vogliono vedere giardino, cucina e dispendibilità del garage. Portare documentazione catastale.'),
(5, 2, 3, 2, DATE_ADD(NOW(), INTERVAL 8 DAY),   60, 'scheduled',
 'Seconda visita Conti con marito e geometra. Portare planimetria aggiornata. Eventuale pre-accordo possibile.'),
(2, 4, 1, 3, DATE_SUB(NOW(), INTERVAL 5 DAY),   60, 'completed',
 'Visita ufficio Buenos Aires. Lead molto interessata. Chiede preventivo lavori piccola partizione. Follow-up previsto.'),
(1, 1, 1, 3, DATE_SUB(NOW(), INTERVAL 10 DAY),  45, 'completed',
 'Visita immobile occupato (inquilino presente e disponibile). Lead vuole valutare anche ufficio Buenos Aires.');

-- ════════════════════════════════════════════════════════════
-- 21. PROPERTY APPLICATIONS (candidature online)
-- ════════════════════════════════════════════════════════════
INSERT INTO property_applications (property_id, applicant_name, applicant_email, applicant_phone, application_type, message, status, converted_to_lead_id, ip_address) VALUES
(2, 'Chiara Vitale',   'chiara.vitale@gmail.com',  '+39 348 544 7890', 'affitto',
 'Buongiorno, sono interessata all\'ufficio in Corso Buenos Aires. Gestisco uno studio di architettura con 3 collaboratori. Disponibile da luglio 2024. Posso visitare?',
 'contacted', 4, '192.168.1.101'),
(3, 'Luca Romano',     'luca.romano@libero.it',     '+39 339 433 6789', 'acquisto',
 'Siamo una famiglia di 5 persone in cerca di casa spaziosa a Firenze. La vostra villa è perfetta per noi. Possiamo organizzare una visita con il nostro geometra?',
 'approved',  3, '192.168.1.102'),
(5, 'Sara Conti',      'sara.conti@hotmail.it',     '+39 347 322 5678', 'acquisto',
 'Ho visto l\'appartamento Parioli sul vostro sito. Posso fare una seconda visita questa settimana con mio marito e un geometra? Siamo seriamente interessati.',
 'contacted', 2, '192.168.1.103');

-- ════════════════════════════════════════════════════════════
-- 22. EXPENSES (spese)
-- ════════════════════════════════════════════════════════════
INSERT INTO expenses (property_id, client_id, category, description, amount, expense_date, notes, created_by) VALUES
(1, 1, 'manutenzione', 'Intervento idraulico — sostituzione rubinetteria bagno Via Tortona 28',               180.00, DATE_SUB(NOW(), INTERVAL 45 DAY), 'Fornitore: Mario Fontana Idraulica. Fattura n.22/2024.', 1),
(1, 1, 'utenze',       'Conguaglio gas 2023 — quota proprietà Via Tortona 28',                                 95.00, DATE_SUB(NOW(), INTERVAL 30 DAY), 'Bolletta Eni, riferimento periodo gen-dic 2023.',         1),
(3, 2, 'manutenzione', 'Manutenzione giardino villa Firenze — potatura e grondaie',                           350.00, DATE_SUB(NOW(), INTERVAL 15 DAY), 'Fornitore: Verde & Giardini Srl. Lavori durata 1 giorno.',2),
(4, 3, 'assicurazione','Polizza incendio Via Appia Nuova 334 — rata semestrale',                              230.00, DATE_SUB(NOW(), INTERVAL 60 DAY), 'Compagnia: Allianz. Fattura polizza semestrale.',         2),
(5, 3, 'manutenzione', 'Sopralluogo e preventivo sostituzione infissi Viale Parioli 22',                       80.00, DATE_SUB(NOW(), INTERVAL 10 DAY), 'Solo preventivo. Lavori da programmare post-decisione.',  1),
(6, 4, 'utenze',       'TARI 2024 negozio Corso V.E. 18 Torino — quota annuale',                             420.00, DATE_SUB(NOW(), INTERVAL 90 DAY), 'Comune di Torino. Scadenza 30 giugno 2024.',              2),
(6, 4, 'manutenzione', 'Riparazione impianto antifurto negozio Torino — sostituzione sensore',                145.00, DATE_SUB(NOW(), INTERVAL 15 DAY), 'Tecnico Sicurezza Italia Srl. Intervento 2 ore.',         1),
(6, 4, 'assicurazione','Polizza responsabilità civile uso commerciale — Corso V.E. 18 Torino',                520.00, DATE_SUB(NOW(), INTERVAL 100 DAY),'Compagnia: UnipolSai. Annuale, scadenza luglio 2024.',    1),
(NULL,NULL,'agenzia',  'Abbonamento portale Casa.it — canone mensile maggio 2024',                            199.00, DATE_SUB(NOW(), INTERVAL 3 DAY),  'Spesa operativa agenzia. Piano Professional.',             1),
(NULL,NULL,'agenzia',  'Rinnovo dominio gestionale-immobiliare.it + hosting annuale',                                  148.00, DATE_SUB(NOW(), INTERVAL 120 DAY),'Hosting SiteGround, piano Business. Rinnovo annuale.',   1);

-- ════════════════════════════════════════════════════════════
-- 23. INVOICES (fatture agenzia)
-- ════════════════════════════════════════════════════════════
INSERT INTO invoices
  (id, invoice_number, client_id, property_id, description, amount, vat_rate,
   status, issue_date, due_date, paid_date, notes, created_by)
VALUES
(1, 'FAT-2024-001', 1, 1,
 'Commissione gestione locazione Via Tortona 28 — Gennaio-Giugno 2024 (10% × €900 × 6 mesi)',
 540.00, 22.00, 'paid', '2024-01-15', '2024-02-15', '2024-02-10',
 'Pagata con bonifico il 10/02/2024. Fattura quietanzata.', 1),
(2, 'FAT-2024-002', 3, 4,
 'Commissione intermediazione trovare inquilina — Via Appia Nuova 334 (1 mensilità)',
 750.00, 22.00, 'paid', '2024-01-20', '2024-02-20', '2024-02-18',
 'Una mensilità a carico del proprietario per ricerca inquilino.', 1),
(3, 'FAT-2024-003', 2, 3,
 'Acconto commissione mandato vendita Villa dei Servi — esclusiva 6 mesi (2% su 620k)',
 1200.00, 22.00, 'sent', '2024-02-01', '2024-03-01', NULL,
 'Da incassare. Saldo al rogito definitivo.', 2),
(4, 'FAT-2024-004', 4, 6,
 'Commissione gestione locazione Corso V.E. 18 Torino — Q1 2024 (12% × €1.200 × 3 mesi)',
 432.00, 22.00, 'draft', '2024-04-01', '2024-05-01', NULL,
 'Da inviare. Corrispettivo gestione trimestrale commerciale.', 1);

-- ════════════════════════════════════════════════════════════
-- 24. AGENT COMMISSIONS (commissioni agenti)
-- ════════════════════════════════════════════════════════════
INSERT INTO agent_commissions
  (admin_user_id, contract_id, property_id, client_id, amount, percentage,
   commission_type, status, notes, due_date)
VALUES
(3, 1, 1, 1, 450.00, 5.00, 'locazione', 'paid',
 'Provvigione Luca Santoro — locazione Via Tortona 28. Pagato con bonifico 10/02/2024.', '2024-02-10'),
(3, 2, 4, 3, 375.00, 5.00, 'locazione', 'paid',
 'Provvigione Luca Santoro — locazione Via Appia Nuova 334. Saldato 18/02/2024.', '2024-02-18'),
(2, 3, 6, 4, 360.00, 5.00, 'locazione', 'pending',
 'Provvigione Giulia Marchetti — locazione Torino. In attesa liquidazione entro maggio.', '2024-05-01'),
(3, 4, 3, 2, 1800.00, 3.00, 'vendita', 'pending',
 'Provvigione Luca Santoro — mandato vendita Firenze (3% su 600k). Liquidabile a rogito.', '2024-12-31');

-- ════════════════════════════════════════════════════════════
-- 25. PROPERTY KEYS (gestione chiavi)
-- ════════════════════════════════════════════════════════════
INSERT INTO property_keys (property_id, holder_id, holder_name, location, notes, handed_at, status) VALUES
(1, 1, 'Admin Agenzia',    'Cassettina chiavi sede — gancio A1', 'Copia di sicurezza. Originali con inquilino Alessandro Gatti.',             '2024-01-01', 'in_office'),
(2, 3, 'Luca Santoro',     'Portachiavi agente — mazzo blu',     'Copia per visite. Immobile libero, accesso su appuntamento.',                '2024-03-15', 'out'),
(3, 3, 'Luca Santoro',     'Portachiavi agente — mazzo verde',   'Copia per visite villa Firenze. Proprietaria informata e d\'accordo.',       '2024-02-01', 'out'),
(4, 1, 'Admin Agenzia',    'Cassettina chiavi sede — gancio B2', 'Copia in agenzia. Inquilina Valentina Moretti ha originali.',                '2023-09-01', 'in_office'),
(5, 2, 'Giulia Marchetti', 'Portachiavi agente — mazzo rosso',   'Copia per seconde visite Parioli. Immobile vuoto.',                          '2024-04-10', 'out'),
(6, 1, 'Admin Agenzia',    'Cassettina chiavi sede — gancio C3', 'Copia sicurezza negozio. Inquilino Carlo Ferretti ha chiavi esercizio.',    '2024-03-01', 'in_office');

-- ════════════════════════════════════════════════════════════
-- 26. PROPERTY PRICE HISTORY
-- ════════════════════════════════════════════════════════════
INSERT INTO property_price_history (property_id, old_price, new_price, old_price_type, new_price_type, changed_by, changed_at) VALUES
(1,  950.00, 900.00,    'affitto', 'affitto', 1, DATE_SUB(NOW(), INTERVAL 180 DAY)),
(3,  700000.00, 650000.00, 'vendita', 'vendita', 2, DATE_SUB(NOW(), INTERVAL 90 DAY)),
(5,  450000.00, 420000.00, 'vendita', 'vendita', 2, DATE_SUB(NOW(), INTERVAL 45 DAY)),
(6,  1100.00, 1200.00,  'affitto', 'affitto', 1, DATE_SUB(NOW(), INTERVAL 365 DAY));

-- ════════════════════════════════════════════════════════════
-- 27. PROPERTY INVENTORY (inventario arredi)
-- ════════════════════════════════════════════════════════════
INSERT INTO property_inventory (property_id, item_name, category, quantity, condition_rating, notes, check_in_date) VALUES
-- Via Tortona 28 (arredato)
(1, 'Divano 3 posti grigio antracite',   'mobile',           1, 4, 'Buono stato, leggera usura seduta centrale.', '2024-01-01'),
(1, 'Letto matrimoniale con rete',       'mobile',           1, 4, 'Con materasso Magniflex, ottime condizioni.', '2024-01-01'),
(1, 'Frigorifero Indesit 300L',          'elettrodomestico', 1, 4, 'Funzionante, piccolo graffio lato sinistro.',  '2024-01-01'),
(1, 'Lavatrice Bosch 7kg',               'elettrodomestico', 1, 5, 'Acquistata 2022, perfette condizioni.',        '2024-01-01'),
(1, 'Lavastoviglie Indesit 12 coperti',  'elettrodomestico', 1, 3, 'Funzionante, cesta superiore con cricca.',     '2024-01-01'),
(1, 'Tavolo cucina 4 posti + sedie',     'mobile',           1, 4, 'Set coordinato, sedie con cuscini rimovibili.','2024-01-01'),
(1, 'Armadio 3 ante scorrevoli specchio','mobile',           1, 5, 'Ottimo stato, specchio integro.',              '2024-01-01'),
(1, 'Scrivania e sedia ufficio',         'mobile',           1, 3, 'Usura moderata, funzionale.',                  '2024-01-01'),
-- Via Appia Nuova 334 (arredato)
(4, 'Cucina attrezzata completa',        'arredamento',      1, 3, 'Funzionale ma datata, ante con segni uso.',    '2023-09-01'),
(4, 'Letto matrimoniale',                'mobile',           1, 3, 'Usato, materasso da sostituire prossimo rinnovo.','2023-09-01'),
(4, 'Frigorifero combinato',             'elettrodomestico', 1, 3, 'Funzionante, anno 2015.',                       '2023-09-01'),
(4, 'Tavolo e 2 sedie sala da pranzo',   'mobile',           1, 4, 'Buone condizioni.',                             '2023-09-01');

-- ════════════════════════════════════════════════════════════
-- 28. PROPERTY APPRAISALS (valutazioni)
-- ════════════════════════════════════════════════════════════
INSERT INTO property_appraisals
  (property_id, appraised_by, estimated_value, estimated_rent, condition_rating, notes,
   comparable_1_address, comparable_1_price, comparable_2_address, comparable_2_price, appraisal_date)
VALUES
(3, 2, 640000.00, 2800.00, 'ottimo',
 'Villa in ottimo stato, soffitti affrescati di pregio, giardino curato. Posizione centrale elevata. Mercato Firenze centro in ripresa dopo 2023. Stima conservativa, trattativa possibile fino a 660k.',
 'Via dei Benci 8, Firenze', 620000.00, 'Borgo San Jacopo 12, Firenze', 680000.00,
 DATE_SUB(NOW(), INTERVAL 60 DAY)),
(5, 2, 415000.00, 1800.00, 'buono',
 'Appartamento ben tenuto in zona Parioli. Vista verde, piano alto, portineria. Necessaria riverniciatura pareti e sostituzione infissi per massimizzare valore di mercato prima della vendita.',
 'Viale Parioli 18, Roma', 398000.00, 'Via Archimede 34, Roma', 435000.00,
 DATE_SUB(NOW(), INTERVAL 30 DAY)),
(1, 1, 185000.00, 950.00, 'buono',
 'Appartamento in zona Tortona, molto richiesta. Ristrutturato 2021, materiali buona qualità. Canone attuale (900€) leggermente sotto mercato: al prossimo rinnovo consigliamo 950-980€.',
 'Via Savona 12, Milano', 178000.00, 'Via Vigevano 8, Milano', 195000.00,
 DATE_SUB(NOW(), INTERVAL 90 DAY));

-- ════════════════════════════════════════════════════════════
-- 29. PROPERTY INSURANCE (polizze assicurative)
-- ════════════════════════════════════════════════════════════
INSERT INTO property_insurance (property_id, client_id, insurer_name, policy_number, policy_type, premium_annual, start_date, end_date, notes) VALUES
(1, 1, 'UnipolSai',   'UP-2024-MI-001234',  'incendio',           380.00, '2024-01-01', '2025-01-01', 'Polizza incendio base. Copertura fabbricato fino a €200.000.'),
(3, 2, 'Generali',    'GEN-2024-FI-009876', 'globale_fabbricato', 920.00, '2024-02-01', '2025-02-01', 'Polizza globale villa. Massimale €800.000. Include RC terzi.'),
(4, 3, 'Allianz',     'ALZ-2023-RM-005432', 'incendio',           290.00, '2023-09-01', '2024-09-01', 'Polizza incendio appartamento Roma. Prima casa inquilina.'),
(5, 3, 'Generali',    'GEN-2024-RM-007654', 'incendio',           340.00, '2024-01-01', '2025-01-01', 'Polizza standard appartamento Parioli vuoto.'),
(6, 4, 'UnipolSai',   'UP-2024-TO-002345',  'responsabilita',     520.00, '2024-03-01', '2025-03-01', 'Polizza RC uso commerciale negozio. Scade luglio 2024 — PROMEMORIA ATTIVO.'),
(6, 4, 'AXA Italia',  'AXA-2024-TO-003456', 'incendio',           310.00, '2024-03-01', '2025-03-01', 'Polizza incendio negozio Torino. Copertura strutturale €150.000.');

-- ════════════════════════════════════════════════════════════
-- 30. METER READINGS (letture contatori)
-- ════════════════════════════════════════════════════════════
INSERT INTO meter_readings (property_id, meter_type, reading_value, reading_date, notes) VALUES
-- Via Tortona 28 (Milano)
(1, 'gas',         1160.30, DATE_SUB(NOW(), INTERVAL 90 DAY),  'Lettura gas — periodo febbraio'),
(1, 'gas',         1240.50, DATE_SUB(NOW(), INTERVAL 60 DAY),  'Lettura gas — periodo aprile'),
(1, 'gas',         1310.20, DATE_SUB(NOW(), INTERVAL 30 DAY),  'Lettura gas — periodo maggio'),
(1, 'electricity',  754.80, DATE_SUB(NOW(), INTERVAL 90 DAY),  'Lettura luce — periodo febbraio'),
(1, 'electricity',  823.10, DATE_SUB(NOW(), INTERVAL 60 DAY),  'Lettura luce — periodo aprile'),
(1, 'electricity',  891.40, DATE_SUB(NOW(), INTERVAL 30 DAY),  'Lettura luce — periodo maggio'),
(1, 'water',        498.00, DATE_SUB(NOW(), INTERVAL 90 DAY),  'Acqua — lettura trimestrale gennaio'),
(1, 'water',        512.00, DATE_SUB(NOW(), INTERVAL 60 DAY),  'Acqua — lettura aprile'),
(1, 'water',        538.50, DATE_SUB(NOW(), INTERVAL 30 DAY),  'Acqua — lettura maggio'),
-- Via Appia Nuova 334 (Roma)
(4, 'gas',          387.20, DATE_SUB(NOW(), INTERVAL 90 DAY),  'Lettura gas Roma — febbraio'),
(4, 'gas',          432.80, DATE_SUB(NOW(), INTERVAL 60 DAY),  'Lettura gas Roma — aprile'),
(4, 'gas',          478.60, DATE_SUB(NOW(), INTERVAL 30 DAY),  'Lettura gas Roma — maggio'),
(4, 'electricity',  571.40, DATE_SUB(NOW(), INTERVAL 60 DAY),  'Lettura luce Roma — aprile'),
(4, 'electricity',  612.30, DATE_SUB(NOW(), INTERVAL 30 DAY),  'Lettura luce Roma — maggio'),
-- Corso V.E. 18 Torino (negozio)
(6, 'electricity',  298.50, DATE_SUB(NOW(), INTERVAL 90 DAY),  'Negozio Torino — lettura luce febbraio'),
(6, 'electricity',  341.20, DATE_SUB(NOW(), INTERVAL 60 DAY),  'Negozio Torino — lettura luce aprile'),
(6, 'electricity',  389.70, DATE_SUB(NOW(), INTERVAL 30 DAY),  'Negozio Torino — lettura luce maggio'),
(6, 'water',        115.20, DATE_SUB(NOW(), INTERVAL 90 DAY),  'Acqua negozio Torino — febbraio'),
(6, 'water',        128.40, DATE_SUB(NOW(), INTERVAL 60 DAY),  'Acqua negozio Torino — aprile'),
(6, 'water',        135.60, DATE_SUB(NOW(), INTERVAL 30 DAY),  'Acqua negozio Torino — maggio');

-- ════════════════════════════════════════════════════════════
-- 31. BUILDINGS (condomini)
-- ════════════════════════════════════════════════════════════
INSERT INTO buildings (id, name, address, city, total_units, notes) VALUES
(1, 'Condominio Tortona Business',  'Via Tortona 28-30',    'Milano', 12,
 'Condominio misto residenziale-commerciale. Amministratore: Dott. Sergio Calvi — 02 5432 1111. Riunione annuale ogni marzo.'),
(2, 'Palazzo dei Parioli',           'Viale Parioli 20-24', 'Roma',   18,
 'Palazzo signorile anni 60. Portineria attiva 8-20. Amministratore: Studio Greco — 06 8765 4321. Ascensore revisionato 2023.');

-- ════════════════════════════════════════════════════════════
-- 32. BUILDING-PROPERTY LINKS (phase26: 1:N via properties.building_id)
-- ════════════════════════════════════════════════════════════
UPDATE properties SET building_id = 1 WHERE id IN (1, 2);
UPDATE properties SET building_id = 2 WHERE id = 5;

-- ════════════════════════════════════════════════════════════
-- 33. TENANT SURVEYS (sondaggi soddisfazione)
-- ════════════════════════════════════════════════════════════
INSERT INTO tenant_surveys
  (tenant_id, property_id, overall_rating, maintenance_rating, communication_rating, comment, token, submitted_at)
VALUES
(1, 1, 5, 4, 5,
 'Sono molto soddisfatto dell\'appartamento e dell\'agenzia. Il problema della caldaia è stato risolto rapidamente. Rinnoverò sicuramente il contratto.',
 MD5('survey_gatti_tortona_2024'), DATE_SUB(NOW(), INTERVAL 30 DAY)),
(2, 4, 4, 3, 5,
 'L\'appartamento è in buono stato e la comunicazione con l\'agenzia è eccellente. Il bagno avrebbe bisogno di un piccolo intervento al silicone, ma non è urgente.',
 MD5('survey_moretti_appia_2024'), DATE_SUB(NOW(), INTERVAL 15 DAY));

-- Sondaggio pendente per Ferretti
INSERT INTO tenant_surveys (tenant_id, property_id, token) VALUES
(3, 6, MD5('survey_ferretti_torino_2024'));

-- ════════════════════════════════════════════════════════════
-- 34. E-SIGN REQUESTS (firme digitali)
-- ════════════════════════════════════════════════════════════
INSERT INTO esign_requests
  (document_id, contract_id, signer_name, signer_email, token, status, signed_at, ip_address, expires_at)
VALUES
(1,  1, 'Alessandro Gatti',  'alessandro.gatti@gmail.com',  MD5('esign_gatti_contratto_1'),  'signed',  DATE_SUB(NOW(), INTERVAL 160 DAY), '93.42.111.200',  DATE_ADD(DATE_SUB(NOW(), INTERVAL 160 DAY), INTERVAL 7 DAY)),
(4,  2, 'Valentina Moretti', 'valentina.moretti@gmail.com', MD5('esign_moretti_contratto_2'),'signed',  DATE_SUB(NOW(), INTERVAL 200 DAY), '79.55.88.130',   DATE_ADD(DATE_SUB(NOW(), INTERVAL 200 DAY), INTERVAL 7 DAY)),
(8,  4, 'Francesca Ricci',   'francesca.ricci@libero.it',   MD5('esign_ricci_mandato_4'),    'pending', NULL,                              NULL,              DATE_ADD(NOW(), INTERVAL 7 DAY)),
(10, 3, 'Carlo Ferretti',    'carlo.ferretti@modaferretti.it', MD5('esign_ferretti_contratto_3'),'signed',DATE_SUB(NOW(), INTERVAL 90 DAY),'88.21.45.67',   DATE_ADD(DATE_SUB(NOW(), INTERVAL 90 DAY), INTERVAL 7 DAY));

-- ════════════════════════════════════════════════════════════
-- 35. SOCIAL SETTINGS (singleton Meta/Facebook)
-- ════════════════════════════════════════════════════════════
INSERT INTO social_settings (id) VALUES (1);

-- ════════════════════════════════════════════════════════════
-- 36. SOCIAL POSTS (post social media)
-- ════════════════════════════════════════════════════════════
INSERT INTO social_posts (property_id, platform, caption, scheduled_at, published_at, status) VALUES
(2, 'both',
 'Ufficio di rappresentanza in Corso Buenos Aires, Milano — 120 mq al 3° piano. Open space + sala riunioni separata. Portineria h24, fibra, posto auto. Libero subito. Canone €2.200/mese. Info: info@gestionale-immobiliare.it',
 DATE_ADD(NOW(), INTERVAL 3 DAY), NULL, 'scheduled'),
(3, 'instagram',
 'Villa esclusiva nel cuore di Firenze — 200 mq, 6 locali, giardino privato 80mq, soffitti affrescati. Un\'opportunità rara nel mercato fiorentino. Visita su appuntamento. #Firenze #VillaFirenzeVendesi #ImmobiliDiPregio',
 DATE_ADD(NOW(), INTERVAL 7 DAY), NULL, 'scheduled'),
(5, 'facebook',
 'Elegante appartamento ai Parioli, Roma — 90 mq al 4° piano con vista verde. 4 locali, 2 bagni, portineria, posto auto. In vendita a €420.000. Contattaci per una visita!',
 DATE_ADD(NOW(), INTERVAL 10 DAY), NULL, 'draft'),
(1, 'both',
 'Appartamento luminoso in zona Navigli-Tortona, Milano — 75 mq, 3 locali, balcone. Ristrutturato 2021. Canone €900/mese. Libero da gennaio 2027. Agente: Luca Santoro.',
 DATE_SUB(NOW(), INTERVAL 30 DAY), DATE_SUB(NOW(), INTERVAL 29 DAY), 'published');

-- ════════════════════════════════════════════════════════════
-- 37. WHATSAPP TEMPLATES
-- ════════════════════════════════════════════════════════════
INSERT INTO whatsapp_templates (name, category, body, variables) VALUES
('Benvenuto nuovo inquilino',    'benvenuto',
 'Gentile {{nome}}, benvenuto nel suo nuovo immobile in {{indirizzo}}. Il canone mensile di €{{canone}} dovrà essere versato entro il 5 di ogni mese. Per qualsiasi necessità può contattarci al 02 1234 5678. Buona permanenza!',
 '["nome","indirizzo","canone"]'),
('Promemoria scadenza canone',   'scadenza',
 'Gentile {{nome}}, le ricordiamo che il canone di {{mese}} (€{{importo}}) è in scadenza il {{data}}. Può effettuare il bonifico all\'IBAN: IT60 X054 2811 1010 0000 0123 456. Causale: Affitto {{mese}} - {{indirizzo}}.',
 '["nome","mese","importo","data","indirizzo"]'),
('Pagamento in ritardo',         'pagamento',
 'Gentile {{nome}}, risulta ancora non pervenuto il pagamento del canone di {{mese}} (€{{importo}}). La preghiamo di regolarizzare entro {{scadenza}}. Per eventuali difficoltà non esiti a contattarci.',
 '["nome","mese","importo","scadenza"]'),
('Conferma visita immobile',     'visita',
 'Gentile {{nome}}, le confermiamo la visita all\'immobile in {{indirizzo}} per {{data}} alle {{ora}}. L\'agente {{agente}} la accoglierà sul posto. Per info o modifiche ci contatti. A presto!',
 '["nome","indirizzo","data","ora","agente"]'),
('Richiesta documentazione',     'generico',
 'Gentile {{nome}}, per completare la pratica abbiamo bisogno dei seguenti documenti: {{documenti}}. Può inviarli a info@gestionale-immobiliare.it o portarli in sede. Grazie.',
 '["nome","documenti"]');

-- ════════════════════════════════════════════════════════════
-- 38. EMAIL TEMPLATES
-- ════════════════════════════════════════════════════════════
INSERT INTO email_templates (name, category, subject, body, variables, is_active) VALUES
('Benvenuto nuovo inquilino', 'benvenuto',
 'Benvenuto in {{indirizzo}} — Gestionale Immobiliare',
 '<p>Gentile <strong>{{nome}}</strong>,</p><p>siamo lieti di darle il benvenuto nel suo nuovo immobile in <strong>{{indirizzo}}</strong>.</p><p>Il contratto decorre dal <strong>{{data_inizio}}</strong>. Il canone mensile di <strong>€{{canone}}</strong> dovrà essere versato entro il 5 di ogni mese tramite bonifico bancario:<br><strong>IBAN:</strong> IT60 X054 2811 1010 0000 0123 456<br><strong>Causale:</strong> Affitto {{mese}} — {{indirizzo}}</p><p>Per richieste di manutenzione o qualsiasi necessità può contattarci all\'indirizzo <a href="mailto:info@gestionale-immobiliare.it">info@gestionale-immobiliare.it</a> o al numero 02 1234 5678.</p><p>Cordiali saluti,<br><strong>Gestionale Immobiliare</strong></p>',
 '["nome","indirizzo","data_inizio","canone","mese"]', 1),

('Promemoria canone mensile', 'scadenza_affitto',
 'Promemoria: canone {{mese}} in scadenza — {{indirizzo}}',
 '<p>Gentile <strong>{{nome}}</strong>,</p><p>le ricordiamo che il canone di locazione relativo a <strong>{{mese}}</strong> pari a <strong>€{{importo}}</strong> è in scadenza il <strong>{{data_scadenza}}</strong>.</p><p>La preghiamo di effettuare il pagamento tramite bonifico bancario:<br><strong>IBAN:</strong> IT60 X054 2811 1010 0000 0123 456<br><strong>Causale:</strong> Affitto {{mese}} — {{indirizzo}}</p><p>In caso di difficoltà non esiti a contattarci. Cordiali saluti,<br><strong>Gestionale Immobiliare</strong></p>',
 '["nome","mese","importo","data_scadenza","indirizzo"]', 1),

('Avviso scadenza contratto', 'scadenza_contratto',
 'Contratto in scadenza: {{indirizzo}} — {{data_fine}}',
 '<p>Gentile <strong>{{nome}}</strong>,</p><p>le ricordiamo che il contratto di locazione per l\'immobile in <strong>{{indirizzo}}</strong> scadrà il <strong>{{data_fine}}</strong>.</p><p>La invitiamo a comunicarci entro <strong>60 giorni</strong> dalla scadenza la sua intenzione di rinnovare o di non rinnovare il contratto, per permetterci di organizzare le procedure necessarie.</p><p>Siamo a disposizione per qualsiasi chiarimento.<br>Cordiali saluti,<br><strong>Gestionale Immobiliare</strong></p>',
 '["nome","indirizzo","data_fine"]', 1),

('Promemoria generico', 'promemoria',
 'Promemoria: {{titolo}}',
 '<p>Gentile <strong>{{nome}}</strong>,</p><p>le inviamo questo promemoria riguardante: <strong>{{titolo}}</strong>.</p><p>{{messaggio}}</p><p>Per ulteriori informazioni non esiti a contattarci.<br>Cordiali saluti,<br><strong>Gestionale Immobiliare</strong></p>',
 '["nome","titolo","messaggio"]', 1),

('Richiesta documento', 'richiesta_documento',
 'Documenti necessari — {{pratica}}',
 '<p>Gentile <strong>{{nome}}</strong>,</p><p>per completare la pratica relativa a <strong>{{pratica}}</strong> abbiamo necessità dei seguenti documenti:</p><ul>{{lista_documenti}}</ul><p>La preghiamo di inviarli via email a <a href="mailto:info@gestionale-immobiliare.it">info@gestionale-immobiliare.it</a> oppure di consegnarli presso la nostra sede entro il <strong>{{scadenza}}</strong>.</p><p>Cordiali saluti,<br><strong>Gestionale Immobiliare</strong></p>',
 '["nome","pratica","lista_documenti","scadenza"]', 1),

('Conferma appuntamento', 'generico',
 'Conferma visita: {{indirizzo}} — {{data}}',
 '<p>Gentile <strong>{{nome}}</strong>,</p><p>le confermiamo la visita all\'immobile in <strong>{{indirizzo}}</strong> per <strong>{{data}}</strong> alle <strong>{{ora}}</strong>.</p><p>L\'agente <strong>{{agente}}</strong> la accoglierà sul posto.</p><p>In caso di impedimento, la preghiamo di contattarci al più presto al 02 1234 5678 o via email.<br>A presto!<br><strong>Gestionale Immobiliare</strong></p>',
 '["nome","indirizzo","data","ora","agente"]', 1);

-- ════════════════════════════════════════════════════════════
-- 39. ACTIVITY LOG (audit trail)
-- ════════════════════════════════════════════════════════════
INSERT INTO activity_log (admin_user_id, username, action, entity_type, entity_id, description, ip_address, created_at) VALUES
(1, 'admin',            'login',  'admin_users', 1,  'Login super admin effettuato con successo.',                              '127.0.0.1',    DATE_SUB(NOW(), INTERVAL 1 HOUR)),
(1, 'admin',            'create', 'clients',     1,  'Nuovo proprietario inserito: Roberto Esposito.',                          '127.0.0.1',    DATE_SUB(NOW(), INTERVAL 180 DAY)),
(1, 'admin',            'create', 'contracts',   1,  'Contratto locazione creato: Gatti — Via Tortona 28 2024.',               '127.0.0.1',    DATE_SUB(NOW(), INTERVAL 60 DAY)),
(2, 'giulia.marchetti', 'update', 'properties',  3,  'Prezzo villa Firenze aggiornato: €700.000 → €650.000.',                  '192.168.1.10', DATE_SUB(NOW(), INTERVAL 90 DAY)),
(2, 'giulia.marchetti', 'create', 'leads',       4,  'Nuovo lead inserito: Chiara Vitale — ufficio Milano.',                   '192.168.1.10', DATE_SUB(NOW(), INTERVAL 4 DAY)),
(3, 'luca.santoro',     'login',  'admin_users', 3,  'Login agente effettuato.',                                               '192.168.1.11', DATE_SUB(NOW(), INTERVAL 2 HOUR)),
(3, 'luca.santoro',     'create', 'appointments',1,  'Visita programmata: Villa Firenze — famiglia Romano.',                   '192.168.1.11', DATE_SUB(NOW(), INTERVAL 3 DAY)),
(1, 'admin',            'update', 'payments',    6,  'Pagamento #6 (Gatti giugno) marcato "late". Promemoria inviato.',        '127.0.0.1',    DATE_SUB(NOW(), INTERVAL 5 DAY)),
(1, 'admin',            'create', 'reminders',   1,  'Promemoria creato: Guasto caldaia Via Tortona 28.',                      '127.0.0.1',    DATE_SUB(NOW(), INTERVAL 14 DAY)),
(2, 'giulia.marchetti', 'create', 'invoices',    3,  'Fattura FAT-2024-003 creata per Francesca Ricci — mandato Firenze.',     '192.168.1.10', DATE_SUB(NOW(), INTERVAL 50 DAY));

-- ════════════════════════════════════════════════════════════
-- 40. LOGIN ATTEMPTS
-- ════════════════════════════════════════════════════════════
INSERT INTO login_attempts (ip_address, success, attempted_at) VALUES
('127.0.0.1',    1, DATE_SUB(NOW(), INTERVAL 1 HOUR)),
('192.168.1.10', 1, DATE_SUB(NOW(), INTERVAL 2 HOUR)),
('192.168.1.11', 1, DATE_SUB(NOW(), INTERVAL 3 HOUR)),
('203.45.67.89', 0, DATE_SUB(NOW(), INTERVAL 30 MINUTE)),
('203.45.67.89', 0, DATE_SUB(NOW(), INTERVAL 25 MINUTE)),
('203.45.67.89', 0, DATE_SUB(NOW(), INTERVAL 20 MINUTE));

-- ════════════════════════════════════════════════════════════
SELECT CONCAT(
  'Seed completato. Dati coerenti inseriti in tutte le tabelle. ',
  'Proprietari: 5 | Immobili: 7 | Inquilini: 4 | Pagamenti: 15 | ',
  'Contratti: 5 | Comunicazioni: 13 | Lead: 5 | Promemoria: 10'
) AS status;
-- ════════════════════════════════════════════════════════════
