-- Phase 3d: reference mode (FR-CAN-6/9/10/11, FR-TAB-8). A System Administrator opens a reference
-- station, pairs a tablet to it with a 6-digit PIN, shows canvases at true size and records samples.
-- The station is the pairing (like a session's tablet_token_id): closing it turns the tablet away.
CREATE TABLE reference_stations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by          UUID NOT NULL REFERENCES users(id),
  language_code       VARCHAR(8) NOT NULL REFERENCES languages(code),
  pairing_pin_hash    TEXT NULL,
  pairing_expires_at  TIMESTAMPTZ NULL,
  tablet_token_id     UUID NULL,
  css_px_per_mm       NUMERIC(8,4) NULL,
  device_pixel_ratio  NUMERIC(6,3) NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paired_at           TIMESTAMPTZ NULL,
  closed_at           TIMESTAMPTZ NULL
);

ALTER TABLE reference_recordings
  ADD COLUMN station_id      UUID NULL REFERENCES reference_stations(id),
  ADD COLUMN rows_recorded   SMALLINT NULL,
  ADD COLUMN sample_count    INT NOT NULL DEFAULT 0,
  ADD COLUMN css_px_per_mm   NUMERIC(8,4) NULL,
  ADD COLUMN decided_by      UUID NULL REFERENCES users(id),
  ADD COLUMN approved_by     UUID NULL REFERENCES users(id);

CREATE INDEX reference_recordings_canvas ON reference_recordings (canvas_id, recorded_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON reference_stations TO ilt_app;
-- Reference recordings keep their raw pen data (FR-CAN-11): [Clear] marks them CLEARED, never deletes.
REVOKE DELETE, TRUNCATE ON reference_recordings FROM ilt_app;
