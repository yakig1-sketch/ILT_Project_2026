-- Phase 5f: session video capture (FR-PRIV-2, FR-REP-3, FR-VID-1…6).
-- Cameras on the site network are found by ONVIF discovery, paired to one session at a time by a
-- one-time QR code shown on the tablet, and record one clip per writing step.

-- The site camera account: every camera at the site is set up with it (one row). The password is
-- encrypted by the gateway (AES-256-GCM, key CAMERA_SECRET_KEY) and never returned to a client.
CREATE TABLE camera_account (
  id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  username      VARCHAR(64) NOT NULL,
  password_enc  TEXT NOT NULL,
  updated_by    UUID NULL REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cameras found on the network (ONVIF WS-Discovery). A camera keeps its row when it moves to another
-- address; `device_urn` is its ONVIF endpoint reference.
CREATE TABLE cameras (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_urn       VARCHAR(200) NOT NULL UNIQUE,
  model            VARCHAR(100) NOT NULL,
  label            VARCHAR(50) NULL,                       -- set by the administrator, e.g. "Camera 2"
  host             VARCHAR(100) NOT NULL,
  device_url       VARCHAR(300) NOT NULL,                  -- ONVIF device service
  username         VARCHAR(64) NULL,                       -- its own account, when it differs from the site's
  password_enc     TEXT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
                     CHECK (status IN ('UNKNOWN', 'OK', 'NO_ACCOUNT', 'AUTH_FAILED', 'UNREACHABLE', 'NOT_SUPPORTED')),
  rtsp_url         VARCHAR(500) NULL,                      -- main stream (clips, QR pairing), without credentials
  rtsp_sub_url     VARCHAR(500) NULL,                      -- second, smaller stream (live view), when the camera has one
  profile_token    VARCHAR(100) NULL,
  ptz              BOOLEAN NOT NULL DEFAULT false,
  retired          BOOLEAN NOT NULL DEFAULT false,         -- hidden from pairing by the administrator
  last_seen_at     TIMESTAMPTZ NULL,
  last_checked_at  TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A camera paired to a session. PENDING: the tablet shows the QR code and the gateway looks for it in
-- the cameras' pictures. PAIRED: that camera serves the session. ENDED / EXPIRED: history.
CREATE TABLE camera_pairings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  camera_id    UUID NULL REFERENCES cameras(id),
  code         VARCHAR(40) NOT NULL UNIQUE,                 -- one-time random code in the QR
  status       VARCHAR(10) NOT NULL CHECK (status IN ('PENDING', 'PAIRED', 'ENDED', 'EXPIRED')),
  created_by   UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  paired_at    TIMESTAMPTZ NULL,
  ended_at     TIMESTAMPTZ NULL,
  end_reason   VARCHAR(30) NULL
);
CREATE UNIQUE INDEX camera_pairings_one_open_per_session ON camera_pairings (session_id) WHERE status IN ('PENDING', 'PAIRED');
CREATE UNIQUE INDEX camera_pairings_one_session_per_camera ON camera_pairings (camera_id) WHERE status = 'PAIRED';

-- One clip per writing-step attempt (decision 2026-11-14), linked to its attempt and camera.
-- sync_offset_ms: when the clip starts, in ms after the attempt's start (negative: before it).
ALTER TABLE session_video_records
  ADD COLUMN block_attempt_id UUID NULL REFERENCES block_attempts(id) ON DELETE CASCADE,
  ADD COLUMN camera_id        UUID NULL REFERENCES cameras(id),
  ADD COLUMN size_bytes       BIGINT NULL,
  ADD COLUMN content_type     VARCHAR(50) NOT NULL DEFAULT 'video/mp4';
CREATE INDEX session_video_records_attempt ON session_video_records (block_attempt_id);

GRANT SELECT, INSERT, UPDATE ON camera_account TO ilt_app;
GRANT SELECT, INSERT, UPDATE ON cameras TO ilt_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON camera_pairings TO ilt_app;
