-- ============================================================
-- seed_extra.sql — Dati demo aggiuntivi (zona Civitanova Marche)
-- Idempotente: usa ID fissi >= 101 con INSERT IGNORE
-- ============================================================

-- ── Proprietari (clients) ────────────────────────────────────
INSERT IGNORE INTO clients (id, name, surname, codice_fiscale, phone, email, status, privacy_consent_at) VALUES
(101,'Marco','Ferretti','FRRMRC72A15C770X','+39 333 4561201','marco.ferretti@example.it','active',NOW()),
(102,'Lucia','Baldassarri','BLDLCU80B45F205Y','+39 340 8812302','lucia.baldassarri@example.it','active',NOW()),
(103,'Giorgio','Marinelli','MRNGRG65C22C770Z','+39 347 2233403','giorgio.marinelli@example.it','active',NOW()),
(104,'Elena','Properzi','PRPLNE85D60E783W','+39 328 9944504','elena.properzi@example.it','active',NOW()),
(105,'Andrea','Squadroni','SQDNDR78E11C770K','+39 331 5566605','andrea.squadroni@example.it','active',NOW()),
(106,'Federica','Cingolani','CNGFRC90F52D542J','+39 339 7788906','federica.cingolani@example.it','active',NOW()),
(107,'Paolo','Torresi','TRRPLA69G03C770H','+39 335 1122707','paolo.torresi@example.it','active',NOW()),
(108,'Silvia','Recchioni','RCCSLV83H48F205G','+39 342 3344808','silvia.recchioni@example.it','active',NOW()),
(109,'Massimo','Verdicchio','VRDMSM58I19C770F','+39 348 5566909','massimo.verdicchio@example.it','active',NOW()),
(110,'Chiara','Domizi','DMZCHR95L41E783D','+39 366 6677010','chiara.domizi@example.it','active',NOW());

-- ── Immobili (properties) ────────────────────────────────────
INSERT IGNORE INTO properties (id, client_id, address, city, cap, province, property_type, price, price_type, sqm, rooms, bathrooms, floor, energy_class, heating, elevator, furnished, condo_fees, status, description) VALUES
(101,101,'Via Duca degli Abruzzi 14','Civitanova Marche','62012','MC','appartamento',650.00,'affitto',85,3,1,'2','C','autonomo',1,'parzialmente',60,'rented','Trilocale luminoso a due passi dal lungomare sud.'),
(102,101,'Corso Umberto I 88','Civitanova Marche','62012','MC','negozio',1200.00,'affitto',110,2,1,'T','D','autonomo',0,'no',0,'rented','Locale commerciale con doppia vetrina sul corso principale.'),
(103,102,'Via Regina Elena 45','Civitanova Marche','62012','MC','appartamento',580.00,'affitto',70,2,1,'3','D','centralizzato',1,'arredato',45,'rented','Bilocale arredato vista mare, ideale per coppie.'),
(104,102,'Via San Costantino 7','Civitanova Alta','62012','MC','villa',285000.00,'vendita',180,6,2,'T-1','B','autonomo',0,'no',0,'available','Villetta a schiera con giardino privato e garage doppio.'),
(105,103,'Via Einaudi 120','Civitanova Marche','62012','MC','ufficio',850.00,'affitto',95,4,1,'1','C','autonomo',1,'no',80,'available','Ufficio open space zona industriale A, ampio parcheggio.'),
(106,103,'Via Carducci 23','Porto Sant''Elpidio','63821','FM','appartamento',520.00,'affitto',65,2,1,'4','E','centralizzato',1,'parzialmente',50,'rented','Bilocale ristrutturato al quarto piano con ascensore.'),
(107,104,'Lungomare Piermanni 3','Civitanova Marche','62012','MC','appartamento',195000.00,'vendita',75,3,1,'5','C','autonomo',1,'no',90,'available','Fronte mare, terrazzo abitabile, da rivedere internamente.'),
(108,105,'Via Ginocchi 11','Montecosaro','62010','MC','appartamento',480.00,'affitto',72,3,1,'1','D','autonomo',0,'no',30,'rented','Trilocale in borgo storico, travi a vista.'),
(109,105,'Contrada Cavallino 6','Montecosaro','62010','MC','terreno',65000.00,'vendita',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'available','Terreno edificabile 1.200 mq con progetto approvato.'),
(110,106,'Via Trento 56','Civitanova Marche','62012','MC','appartamento',700.00,'affitto',98,4,2,'2','B','autonomo',1,'no',70,'rented','Quadrilocale recente con doppi servizi e posto auto.'),
(111,107,'Via De Amicis 9','Porto San Giorgio','63822','FM','appartamento',560.00,'affitto',68,2,1,'3','D','centralizzato',1,'arredato',55,'rented','Bilocale arredato a 300 m dalla spiaggia.'),
(112,108,'Via Aldo Moro 31','Civitanova Marche','62012','MC','box',95.00,'affitto',18,NULL,NULL,'S1',NULL,NULL,NULL,NULL,NULL,'available','Box auto in autorimessa condominiale, serranda motorizzata.'),
(113,109,'Piazza XX Settembre 2','Civitanova Marche','62012','MC','appartamento',890.00,'affitto',120,5,2,'2','C','autonomo',1,'no',110,'available','Signorile piano nobile su piazza centrale.'),
(114,109,'Via Buozzi 77','Civitanova Marche','62012','MC','negozio',145000.00,'vendita',85,2,1,'T','E','autonomo',0,'no',0,'available','Fondo commerciale angolare, ottima visibilità.'),
(115,110,'Via Saragat 18','Montegranaro','63812','FM','appartamento',450.00,'affitto',60,2,1,'1','E','autonomo',0,'parzialmente',25,'rented','Bilocale economico, ideale lavoratori distretto calzaturiero.');

-- ── Inquilini (tenants) ──────────────────────────────────────
INSERT IGNORE INTO tenants (id, name, surname, email, phone, status) VALUES
(101,'Davide','Rossetti','davide.rossetti@example.it','+39 320 1010101','active'),
(102,'Martina','Copponi','martina.copponi@example.it','+39 327 2020202','active'),
(103,'Alessio','Bruni','alessio.bruni@example.it','+39 329 3030303','active'),
(104,'Giulia','Santarelli','giulia.santarelli@example.it','+39 334 4040404','active'),
(105,'Luca','Menghini','luca.menghini@example.it','+39 338 5050505','active'),
(106,'Sara','Piergentili','sara.piergentili@example.it','+39 345 6060606','active'),
(107,'Matteo','Girotti','matteo.girotti@example.it','+39 349 7070707','active'),
(108,'Valentina','Ombrosi','valentina.ombrosi@example.it','+39 351 8080808','active');

-- ── Contratti (contracts) ────────────────────────────────────
INSERT IGNORE INTO contracts (id, property_id, tenant_id, client_id, title, contract_type, status, start_date, end_date, monthly_rent, deposit, cedolare_secca) VALUES
(101,101,101,101,'Locazione 2025 - Via Duca degli Abruzzi 14','locazione','signed','2025-09-01','2029-08-31',650.00,1300.00,1),
(102,102,102,101,'Locazione commerciale - Corso Umberto I 88','locazione','signed','2025-03-01','2031-02-28',1200.00,3600.00,0),
(103,103,103,102,'Locazione 2026 - Via Regina Elena 45','locazione','signed','2026-01-01','2029-12-31',580.00,1160.00,1),
(104,106,104,103,'Locazione 2025 - Via Carducci 23','locazione','signed','2025-11-01','2029-10-31',520.00,1040.00,1),
(105,108,105,105,'Locazione 2026 - Via Ginocchi 11','locazione','signed','2026-02-01','2030-01-31',480.00,960.00,1),
(106,110,106,106,'Locazione 2025 - Via Trento 56','locazione','signed','2025-07-01','2029-06-30',700.00,1400.00,0),
(107,111,107,107,'Locazione 2026 - Via De Amicis 9','locazione','signed','2026-04-01','2030-03-31',560.00,1120.00,1),
(108,115,108,110,'Locazione 2026 - Via Saragat 18','locazione','signed','2026-03-01','2030-02-28',450.00,900.00,1),
(109,104,NULL,102,'Mandato di vendita - Via San Costantino 7','mandato','signed','2026-05-01','2026-11-01',NULL,NULL,0),
(110,107,NULL,104,'Preliminare - Lungomare Piermanni 3','preliminare','draft','2026-07-01',NULL,NULL,NULL,0);

-- ── Rate (payments) — ultimi mesi per ogni contratto attivo ──
INSERT IGNORE INTO payments (id, tenant_id, property_id, contract_id, amount, due_date, paid_date, status, method) VALUES
(101,101,101,101,650.00,'2026-04-01','2026-04-02','paid','bonifico'),
(102,101,101,101,650.00,'2026-05-01','2026-05-05','paid','bonifico'),
(103,101,101,101,650.00,'2026-06-01','2026-06-01','paid','bonifico'),
(104,101,101,101,650.00,'2026-07-01',NULL,'pending','bonifico'),
(105,102,102,102,1200.00,'2026-05-01','2026-04-28','paid','sdd'),
(106,102,102,102,1200.00,'2026-06-01','2026-05-30','paid','sdd'),
(107,102,102,102,1200.00,'2026-07-01',NULL,'pending','sdd'),
(108,103,103,103,580.00,'2026-05-01','2026-05-12','paid','bonifico'),
(109,103,103,103,580.00,'2026-06-01',NULL,'late','bonifico'),
(110,103,103,103,580.00,'2026-07-01',NULL,'pending','bonifico'),
(111,104,106,104,520.00,'2026-06-01','2026-06-03','paid','contanti'),
(112,104,106,104,520.00,'2026-07-01',NULL,'pending','contanti'),
(113,105,108,105,480.00,'2026-06-01','2026-06-01','paid','bonifico'),
(114,105,108,105,480.00,'2026-07-01','2026-07-02','paid','bonifico'),
(115,106,110,106,700.00,'2026-05-01','2026-05-04','paid','sdd'),
(116,106,110,106,700.00,'2026-06-01','2026-06-02','paid','sdd'),
(117,106,110,106,700.00,'2026-07-01',NULL,'pending','sdd'),
(118,107,111,107,560.00,'2026-06-01',NULL,'late','bonifico'),
(119,107,111,107,560.00,'2026-07-01',NULL,'pending','bonifico'),
(120,108,115,108,450.00,'2026-06-01','2026-06-08','paid','bonifico'),
(121,108,115,108,450.00,'2026-07-01',NULL,'pending','bonifico');

-- ── Fornitori (suppliers) ────────────────────────────────────
INSERT IGNORE INTO suppliers (id, name, category, phone, email, rating) VALUES
(101,'Idraulica Marinozzi snc','idraulico','+39 0733 811223','info@idraulicamarinozzi.it',5),
(102,'Elettroimpianti Civitanova','elettricista','+39 0733 774455','preventivi@elettrocivitanova.it',4),
(103,'Edil Costruzioni Adriatica','muratore','+39 0733 668899','edilcostradriatica@example.it',4),
(104,'Verde Mare Giardinaggio','giardiniere','+39 339 1231234','verdemare@example.it',5),
(105,'CleanCasa Servizi','pulizie','+39 340 4564567','cleancasa@example.it',3);

-- ── Lead ─────────────────────────────────────────────────────
INSERT IGNORE INTO leads (id, name, surname, phone, email, interest_type, budget_min, budget_max, preferred_city, preferred_type, min_rooms, status, source, notes) VALUES
(101,'Roberto','Angeletti','+39 320 9090901','roberto.angeletti@example.it','affitto',400,600,'Civitanova Marche','appartamento',2,'new','web','Cerca bilocale zona sud, disponibile da settembre.'),
(102,'Francesca','Mochi','+39 327 9090902','francesca.mochi@example.it','acquisto',150000,220000,'Civitanova Marche','appartamento',3,'contacted','telefono','Prima casa, preferisce vista mare.'),
(103,'Stefano','Latini','+39 329 9090903','stefano.latini@example.it','affitto',800,1300,'Civitanova Marche','negozio',NULL,'interested','passaparola','Vuole aprire attività di ristorazione sul corso.'),
(104,'Anna','Perugini','+39 334 9090904','anna.perugini@example.it','acquisto',250000,320000,'Civitanova Alta','villa',5,'negotiating','web','In trattativa su villetta Via San Costantino.'),
(105,'Simone','Grandoni','+39 338 9090905','simone.grandoni@example.it','affitto',700,950,'Civitanova Marche','ufficio',3,'new','email','Studio legale, cerca ufficio zona centro/tribunale.'),
(106,'Ilaria','Foglia','+39 345 9090906','ilaria.foglia@example.it','affitto',400,550,'Montegranaro','appartamento',2,'contacted','social','Trasferimento per lavoro, urgenza entro il mese.'),
(107,'Gianni','Staffolani','+39 349 9090907','gianni.staffolani@example.it','acquisto',50000,80000,'Montecosaro','terreno',NULL,'interested','passaparola','Interessato al terreno edificabile in Contrada Cavallino.'),
(108,'Paola','Vissani','+39 351 9090908','paola.vissani@example.it','entrambi',500,700,'Porto San Giorgio','appartamento',2,'new','web','Valuta sia affitto che acquisto piccolo taglio.'),
(109,'Enrico','Malaccari','+39 366 9090909','enrico.malaccari@example.it','affitto',80,120,'Civitanova Marche','box',NULL,'converted','telefono','Convertito: box Via Aldo Moro.'),
(110,'Beatrice','Sputore','+39 371 9090910','beatrice.sputore@example.it','acquisto',120000,160000,'Civitanova Marche','negozio',NULL,'lost','email','Ha comprato da altra agenzia.');

-- ── Promemoria / manutenzioni (reminders) ────────────────────
INSERT IGNORE INTO reminders (id, title, description, reminder_date, frequency, status, client_id, tenant_id, property_id, priority, request_type, category, maintenance_status) VALUES
(101,'Caldaia in blocco - Via Duca degli Abruzzi','Inquilino segnala caldaia in blocco, no acqua calda.','2026-07-20 09:00:00','once','pending',101,101,101,'urgente','Manutenzione caldaia','Urgente','aperta'),
(102,'Infiltrazione terrazzo - Lungomare Piermanni','Macchia di umidità soffitto ultimo piano.','2026-07-22 10:00:00','once','pending',104,NULL,107,'alta','Infiltrazioni','Straordinaria','in_lavorazione'),
(103,'Revisione annuale caldaie','Programmare revisioni caldaia su tutti gli immobili locati.','2026-09-15 09:00:00','yearly','pending',NULL,NULL,NULL,'normale','Manutenzione caldaia','Preventiva','aperta'),
(104,'Rinnovo APE - Via Regina Elena 45','APE in scadenza, incaricare tecnico.','2026-08-10 12:00:00','once','pending',102,NULL,103,'normale','Altro','Ordinaria','aperta'),
(105,'Perdita rubinetto bagno - Via Trento 56','Segnalazione dal portale inquilini.','2026-07-19 15:00:00','once','pending',106,106,110,'alta','Guasto idraulico','Urgente','in_lavorazione'),
(106,'Tinteggiatura vano scale - Corso Umberto I','Richiesta condominio, chiedere preventivi.','2026-09-01 09:00:00','once','pending',101,NULL,102,'bassa','Riparazione infissi','Ordinaria','aperta'),
(107,'Scadenza registrazione contratto 103','Versare imposta di registro annualità 2027.','2026-12-15 09:00:00','yearly','pending',102,103,103,'alta','Altro','Ordinaria','aperta'),
(108,'Sfalcio giardino - Via San Costantino 7','Manutenzione giardino prima delle visite di vendita.','2026-07-25 08:00:00','monthly','pending',102,NULL,104,'normale','Altro','Ordinaria','completata'),
(109,'Serranda box non funzionante','Motore serranda da sostituire, box Via Aldo Moro.','2026-07-21 11:00:00','once','pending',108,NULL,112,'normale','Problema elettrico','Straordinaria','aperta'),
(110,'Solleciti canoni scaduti','Sollecitare pagamenti in ritardo contratti 103 e 107.','2026-07-19 09:00:00','weekly','pending',NULL,NULL,NULL,'urgente','Altro','Ordinaria','aperta');

-- ── Appuntamenti (appointments) ──────────────────────────────
INSERT IGNORE INTO appointments (id, property_id, lead_id, client_id, appointment_date, duration_minutes, status, notes) VALUES
(101,104,104,102,'2026-07-21 10:00:00',60,'scheduled','Seconda visita con architetto della cliente.'),
(102,105,105,103,'2026-07-22 15:30:00',45,'scheduled','Prima visita ufficio Via Einaudi.'),
(103,113,NULL,109,'2026-07-23 11:00:00',60,'scheduled','Servizio fotografico + valutazione piano nobile.'),
(104,107,102,104,'2026-07-24 17:00:00',45,'scheduled','Visita appartamento fronte mare.'),
(105,109,107,105,'2026-07-18 09:30:00',60,'completed','Sopralluogo terreno, cliente interessato al progetto.'),
(106,101,NULL,101,'2026-07-15 16:00:00',30,'completed','Verifica stato immobile con proprietario.'),
(107,114,110,109,'2026-07-10 12:00:00',45,'no_show','Lead non presentato, non risponde.'),
(108,112,109,108,'2026-07-08 10:30:00',30,'completed','Consegna chiavi box.');

-- ── Comunicazioni (communications) ───────────────────────────
INSERT IGNORE INTO communications (id, client_id, direction, channel, subject, body, to_email, status) VALUES
(101,101,'sent','email','Rendiconto locazioni - Giugno 2026','Gentile Sig. Ferretti, in allegato il rendiconto dei canoni incassati a giugno per i suoi immobili.','marco.ferretti@example.it','sent'),
(102,102,'sent','email','Aggiornamento vendita Via San Costantino','Gentile Sig.ra Baldassarri, abbiamo una trattativa in corso: la cliente ha visitato due volte la villetta.','lucia.baldassarri@example.it','sent'),
(103,102,'received','email','Re: Aggiornamento vendita','Perfetto, sono disponibile a scendere a 275.000 se chiudiamo entro agosto.',NULL,'received'),
(104,104,'sent','email','Preventivo infiltrazione terrazzo','Gentile Sig.ra Properzi, il preventivo di Edil Costruzioni per il terrazzo ammonta a € 2.400 + IVA.','elena.properzi@example.it','sent'),
(105,106,'sent','email','Segnalazione guasto idraulico Via Trento','Gentile Sig.ra Cingolani, l''inquilina ha segnalato una perdita. Interveniamo con Idraulica Marinozzi.','federica.cingolani@example.it','sent'),
(106,109,'sent','email','Proposta incarico Piazza XX Settembre','Gentile Sig. Verdicchio, come da colloquio le invio la proposta di mandato in esclusiva.','massimo.verdicchio@example.it','sent'),
(107,101,'received','email','Re: Rendiconto locazioni','Ricevuto, tutto ok. Procedete pure con il sollecito per il negozio.',NULL,'received'),
(108,110,'sent','email','Contratto firmato Via Saragat','Gentile Sig.ra Domizi, contratto registrato. Prima mensilità incassata regolarmente.','chiara.domizi@example.it','sent');

-- ── Utenze portale inquilini per i nuovi tenants ─────────────
INSERT IGNORE INTO tenant_users (tenant_id, password_hash)
SELECT id, '$2y$10$PLACEHOLDER_WILL_BE_UPDATED_BY_PHP_SCRIPT_XXXXXXXXXXXXX'
FROM tenants WHERE id BETWEEN 101 AND 108;

SELECT 'Seed extra completato' AS status;
