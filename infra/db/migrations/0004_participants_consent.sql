-- Phase 3f: participants and consent (FRS FR-PART-1…4, FR-PLAN-1, FR-PRIV-1/2; DDD §14).
-- Consent records are a history: a new record supersedes the current one (superseded_at), and the
-- application can never delete one. Ethics approvals record who entered them and can be withdrawn
-- (kept, not deleted), so a session's research_approval_id always points at a real record.

ALTER TABLE ethics_approvals
  ADD COLUMN created_by   UUID NULL REFERENCES users(id),
  ADD COLUMN created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN withdrawn_at TIMESTAMPTZ NULL,
  ADD CONSTRAINT ethics_valid_range CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to);

ALTER TABLE consent_records
  ADD CONSTRAINT consent_version_not_blank CHECK (length(trim(consent_version)) > 0);

ALTER TABLE participants
  ADD COLUMN updated_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS consent_records_participant ON consent_records (participant_id, recorded_at DESC);

REVOKE DELETE, TRUNCATE ON consent_records, ethics_approvals FROM ilt_app;
