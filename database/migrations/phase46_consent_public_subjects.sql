-- phase46_consent_public_subjects.sql
-- Allow consent_records to reference PRE-conversion data subjects.
--
-- Consent must be captured at the moment of collection on the public forms, but a
-- public submission is not yet a client/tenant — it is a `lead` (contact/appointment
-- request) or an `application` (property_applications row). The original ENUM only
-- allowed 'client','tenant', so there was nowhere to record proof-of-consent for a
-- public intake. Extend the subject_type ENUM to cover both pre-conversion kinds.
--
-- Existing rows keep their values; export/erasure (which filter on 'client'/'tenant')
-- are unaffected. Idempotent — MODIFY to the same definition is a harmless no-op.

USE gestione_immobiliare;

ALTER TABLE consent_records
    MODIFY COLUMN subject_type
        ENUM('client','tenant','lead','application') NOT NULL;
