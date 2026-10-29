-- ILT Research System: initial schema (DDD v1.6 §9).
-- PostgreSQL 16 + TimescaleDB 2. Applied by infra/db (pnpm db:migrate) as the owner role.

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ===== Roles =====
-- Passwords and LOGIN are set by the migrate script from the environment.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ilt_app') THEN
    CREATE ROLE ilt_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ilt_analyst') THEN
    CREATE ROLE ilt_analyst NOLOGIN;
  END IF;
END $$;

-- ===== Organisation, languages, users, devices =====
-- Domain = category grouping students for ILT testing (not geographic).
-- Region = geographic area. The two are independent (DDD §6.1).
CREATE TABLE domains (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(30)  UNIQUE NOT NULL,
  name_he         VARCHAR(100) NOT NULL,
  name_en         VARCHAR(100) NOT NULL,
  description_he  TEXT NULL,
  description_en  TEXT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE regions (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(30)  UNIQUE NOT NULL,
  name_he     VARCHAR(100) NOT NULL,
  name_en     VARCHAR(100) NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE languages (
  code         VARCHAR(8) PRIMARY KEY,
  name_native  VARCHAR(50) NOT NULL,
  name_en      VARCHAR(50) NOT NULL,
  direction    VARCHAR(3)  NOT NULL CHECK (direction IN ('rtl', 'ltr')),
  is_enabled   BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              VARCHAR(255) UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,
  full_name          VARCHAR(100) NOT NULL,
  role               VARCHAR(20)  NOT NULL CHECK (role IN ('ADMIN', 'RESEARCHER', 'EVALUATOR', 'ANALYST')),
  director_pin_hash  TEXT NULL,
  ui_language        VARCHAR(8)   NOT NULL DEFAULT 'he' REFERENCES languages(code),
  domain_id          INT NULL REFERENCES domains(id),
  region_id          INT NULL REFERENCES regions(id),
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  failed_logins      SMALLINT     NOT NULL DEFAULT 0,
  locked_until       TIMESTAMPTZ  NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (director_pin_hash IS NULL OR role = 'RESEARCHER')
);

CREATE TABLE devices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label               VARCHAR(50)  UNIQUE NOT NULL,
  model               VARCHAR(50)  NOT NULL DEFAULT 'DTH-A116',
  css_px_per_mm       NUMERIC(6,3) NOT NULL DEFAULT 5.195,
  device_pixel_ratio  NUMERIC(4,2) NULL,
  screen_w_mm         REAL NULL,
  screen_h_mm         REAL NULL,
  calibrated_at       TIMESTAMPTZ  NULL,
  calibrated_by       UUID NULL REFERENCES users(id),
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE
);

-- ===== Settings =====
CREATE TABLE setting_definitions (
  key                         VARCHAR(100) PRIMARY KEY,
  category                    VARCHAR(20)  NOT NULL CHECK (category IN ('SCORING', 'ILT_PROCESS', 'LANGUAGE', 'GOVERNANCE', 'PRIVACY', 'DEVICE', 'LOG')),
  value_type                  VARCHAR(10)  NOT NULL CHECK (value_type IN ('integer', 'decimal', 'boolean', 'string', 'enum', 'json', 'uuid')),
  default_value               JSONB NULL,
  min_value                   NUMERIC NULL,
  max_value                   NUMERIC NULL,
  enum_values                 JSONB NULL,
  unit                        VARCHAR(20) NULL,
  override_scope              VARCHAR(10) NOT NULL CHECK (override_scope IN ('NONE', 'DOMAIN', 'REGION')),
  requires_director_approval  BOOLEAN NOT NULL DEFAULT FALSE,
  description_he              TEXT NOT NULL,
  description_en              TEXT NOT NULL
);

CREATE TABLE setting_values (
  id           BIGSERIAL PRIMARY KEY,
  key          VARCHAR(100) NOT NULL REFERENCES setting_definitions(key),
  scope        VARCHAR(10)  NOT NULL CHECK (scope IN ('SYSTEM', 'DOMAIN', 'REGION')),
  domain_id    INT NULL REFERENCES domains(id),
  region_id    INT NULL REFERENCES regions(id),
  value        JSONB NOT NULL,
  set_by       UUID NOT NULL REFERENCES users(id),
  approved_by  UUID NULL REFERENCES users(id),
  set_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((scope = 'SYSTEM' AND domain_id IS NULL AND region_id IS NULL)
      OR (scope = 'DOMAIN' AND domain_id IS NOT NULL AND region_id IS NULL)
      OR (scope = 'REGION' AND domain_id IS NULL AND region_id IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (key, scope, domain_id, region_id)
);

-- A DOMAIN or REGION value is allowed only when it matches the definition's override_scope.
CREATE FUNCTION check_setting_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed VARCHAR(10);
BEGIN
  SELECT override_scope INTO allowed FROM setting_definitions WHERE key = NEW.key;
  IF NEW.scope <> 'SYSTEM' AND NEW.scope <> allowed THEN
    RAISE EXCEPTION 'Setting % can be overridden only at scope %, not %', NEW.key, allowed, NEW.scope
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER setting_values_scope
  BEFORE INSERT OR UPDATE ON setting_values
  FOR EACH ROW EXECUTE FUNCTION check_setting_scope();

CREATE TABLE setting_value_history (
  id           BIGSERIAL PRIMARY KEY,
  key          VARCHAR(100) NOT NULL,
  scope        VARCHAR(10)  NOT NULL,
  domain_id    INT NULL,
  region_id    INT NULL,
  old_value    JSONB NULL,
  new_value    JSONB NULL,
  changed_by   UUID NOT NULL REFERENCES users(id),
  approved_by  UUID NULL REFERENCES users(id),
  reason       TEXT NULL,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Canvas library =====
CREATE TABLE canvas_sets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  language_code  VARCHAR(8)  NOT NULL REFERENCES languages(code),
  set_type       VARCHAR(25) NOT NULL CHECK (set_type IN ('ILT', 'NOTEBOOK', 'INTERVENTION_LETTERS')),
  name_he        VARCHAR(100) NOT NULL,
  name_en        VARCHAR(100) NOT NULL,
  sort_order     SMALLINT NOT NULL DEFAULT 0,
  is_active      BOOLEAN  NOT NULL DEFAULT TRUE,
  created_by     UUID NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (language_code, set_type, name_en)
);

CREATE TABLE canvases (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_set_id            UUID NOT NULL REFERENCES canvas_sets(id),
  code                     VARCHAR(60) NOT NULL,
  version                  SMALLINT NOT NULL DEFAULT 1,
  status                   VARCHAR(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  canvas_type              VARCHAR(20) NOT NULL CHECK (canvas_type IN ('ILT_GRID', 'NOTEBOOK', 'INTERVENTION_SHEET')),
  name_he                  VARCHAR(100) NOT NULL,
  name_en                  VARCHAR(100) NOT NULL,
  geometry                 JSONB NOT NULL,
  default_scoring_profile  JSONB NULL,
  sort_order               SMALLINT NOT NULL DEFAULT 0,
  created_by               UUID NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at             TIMESTAMPTZ NULL,
  UNIQUE (code, version)
);
CREATE UNIQUE INDEX one_active_version ON canvases (code) WHERE status = 'ACTIVE';

CREATE TABLE canvas_scoring_overrides (
  canvas_id      UUID NOT NULL REFERENCES canvases(id),
  domain_id      INT  NOT NULL REFERENCES domains(id),
  profile_patch  JSONB NOT NULL,
  set_by         UUID NOT NULL REFERENCES users(id),
  approved_by    UUID NULL REFERENCES users(id),
  set_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canvas_id, domain_id)
);

CREATE TABLE reference_recordings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id     UUID NOT NULL REFERENCES canvases(id),
  kind          VARCHAR(20) NOT NULL CHECK (kind IN ('SAMPLE_BLOCK_FILL', 'NORMAL_SPEED')),
  domain_id     INT  NULL REFERENCES domains(id),
  device_id     UUID NULL REFERENCES devices(id),
  recorded_by   UUID NOT NULL REFERENCES users(id),
  writer_label  VARCHAR(100) NULL,
  samples       BYTEA NOT NULL,
  derived       JSONB NOT NULL,
  status        VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'CLEARED')),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ NULL
);

-- ===== Protocol templates =====
CREATE TABLE protocol_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(40) NOT NULL,
  version       SMALLINT NOT NULL DEFAULT 1,
  session_type  VARCHAR(15) NOT NULL CHECK (session_type IN ('DAY_1', 'DAY_2', 'DAY_14', 'INTERVENTION', 'CUSTOM')),
  name_he       VARCHAR(100) NOT NULL,
  name_en       VARCHAR(100) NOT NULL,
  steps         JSONB NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

-- ===== Instruction video library (per key and language) =====
CREATE TABLE instruction_videos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_key      VARCHAR(50) NOT NULL,
  language_code  VARCHAR(8)  NOT NULL REFERENCES languages(code),
  version        SMALLINT    NOT NULL DEFAULT 1,
  status         VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  title_he       VARCHAR(100) NOT NULL,
  title_en       VARCHAR(100) NOT NULL,
  object_key     VARCHAR(512) NOT NULL,
  source_name    VARCHAR(255) NULL,
  duration_ms    INT NULL,
  sha256         CHAR(64) NOT NULL,
  uploaded_by    UUID NULL REFERENCES users(id),
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_key, language_code, version)
);
CREATE UNIQUE INDEX one_active_video ON instruction_videos (video_key, language_code) WHERE status = 'ACTIVE';

-- ===== Participants, consent, ethics =====
CREATE TABLE participants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_code        VARCHAR(40) UNIQUE NOT NULL,
  domain_id         INT NOT NULL REFERENCES domains(id),
  region_id         INT NULL REFERENCES regions(id),
  school_code_hmac  CHAR(64) NULL,
  grade_level       VARCHAR(15) NOT NULL CHECK (grade_level IN ('KINDERGARTEN', 'GRADE_1', 'GRADE_2', 'GRADE_3', 'GRADE_4', 'GRADE_5', 'GRADE_6')),
  gender            VARCHAR(10) NOT NULL CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
  ses_group         VARCHAR(10) NULL CHECK (ses_group IN ('LOW', 'MID', 'HIGH')),
  dominant_hand     VARCHAR(15) NOT NULL CHECK (dominant_hand IN ('RIGHT', 'LEFT', 'AMBIDEXTROUS')),
  birth_year_month  DATE NULL CHECK (birth_year_month IS NULL OR EXTRACT(DAY FROM birth_year_month) = 1),
  cohort            VARCHAR(10) NOT NULL DEFAULT 'TABLET' CHECK (cohort IN ('TABLET', 'PAPER', 'LEGACY')),
  legacy_ref        VARCHAR(100) NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        UUID NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consent_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id       UUID NOT NULL REFERENCES participants(id),
  consent_version      VARCHAR(20) NOT NULL,
  signed_on            DATE NOT NULL,
  allows_hand_video    BOOLEAN NOT NULL DEFAULT FALSE,
  allows_research_use  BOOLEAN NOT NULL DEFAULT FALSE,
  allows_open_science  BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by          UUID NOT NULL REFERENCES users(id),
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  superseded_at        TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX one_current_consent ON consent_records (participant_id) WHERE superseded_at IS NULL;

CREATE TABLE ethics_approvals (
  id             SERIAL PRIMARY KEY,
  approval_type  VARCHAR(25) NOT NULL CHECK (approval_type IN ('INTERVENTION_PROGRAM', 'RESEARCH', 'PREVIOUS_IRB')),
  authority      VARCHAR(100) NOT NULL,
  reference      VARCHAR(100) NULL,
  valid_from     DATE NULL,
  valid_to       DATE NULL,
  notes          TEXT NULL
);

-- ===== Sessions, steps, blocks =====
CREATE TABLE sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_code          VARCHAR(20) UNIQUE NOT NULL,
  participant_id        UUID NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  evaluator_id          UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  domain_id             INT  NOT NULL REFERENCES domains(id),
  region_id             INT  NULL REFERENCES regions(id),
  language_code         VARCHAR(8) NOT NULL REFERENCES languages(code),
  purpose               VARCHAR(12) NOT NULL DEFAULT 'INTERVENTION' CHECK (purpose IN ('INTERVENTION', 'RESEARCH')),
  research_approval_id  INT NULL REFERENCES ethics_approvals(id),
  session_type          VARCHAR(15) NOT NULL CHECK (session_type IN ('DAY_1', 'DAY_2', 'DAY_14', 'INTERVENTION', 'CUSTOM')),
  protocol_template_id  UUID NOT NULL REFERENCES protocol_templates(id),
  status                VARCHAR(12) NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'PAIRED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'ABORTED')),
  age_months            SMALLINT NULL,
  device_id             UUID NULL REFERENCES devices(id),
  css_px_per_mm         NUMERIC(6,3) NULL,
  device_pixel_ratio    NUMERIC(4,2) NULL,
  device_model          VARCHAR(50) NULL,
  settings_snapshot     JSONB NOT NULL,
  video_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  pairing_pin_hash      TEXT NULL,
  pairing_expires_at    TIMESTAMPTZ NULL,
  abort_reason          VARCHAR(50) NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ NULL,
  completed_at          TIMESTAMPTZ NULL,
  CHECK (purpose <> 'RESEARCH' OR research_approval_id IS NOT NULL)
);
CREATE INDEX ON sessions (participant_id, session_type);
CREATE INDEX ON sessions (domain_id, region_id, created_at);

CREATE TABLE session_steps (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  step_index               SMALLINT NOT NULL,
  step_type                VARCHAR(20) NOT NULL CHECK (step_type IN ('VIDEO', 'WARMUP_BLOCK', 'ILT_BLOCK', 'NOTEBOOK_PAGE', 'PAPER_NOTEBOOK_PAGE', 'INTERVENTION_SHEET')),
  label_key                VARCHAR(50) NOT NULL,
  block_number             SMALLINT NULL,
  is_scored                BOOLEAN NOT NULL DEFAULT FALSE,
  canvas_id                UUID NULL REFERENCES canvases(id),
  mirrored                 BOOLEAN NOT NULL DEFAULT FALSE,
  fill_order               JSONB NULL,
  canvas_profile_snapshot  JSONB NULL,
  video_key                VARCHAR(50) NULL,
  status                   VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'DONE', 'SKIPPED')),
  paper_duration_ms        INT NULL,
  notes                    TEXT NULL,
  started_at               TIMESTAMPTZ NULL,
  completed_at             TIMESTAMPTZ NULL,
  UNIQUE (session_id, step_index)
);

CREATE TABLE block_attempts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_step_id         UUID NOT NULL REFERENCES session_steps(id) ON DELETE CASCADE,
  attempt_number          SMALLINT NOT NULL DEFAULT 1,
  status                  VARCHAR(15) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'MANUAL_FINISH', 'TIMED_OUT', 'REPEATED', 'ABORTED')),
  started_at              TIMESTAMPTZ NOT NULL,
  ended_at                TIMESTAMPTZ NULL,
  repeat_reason           VARCHAR(100) NULL,
  sample_count            INT NULL,
  raw_stroke_count        SMALLINT NULL,
  total_time_ms           INT NULL,
  active_writing_time_ms  INT NULL,
  air_time_ms             INT NULL,
  last_box_completed      BOOLEAN NULL,
  skipped_boxes           SMALLINT NULL,
  sha256                  CHAR(64) NULL,
  integrity_ok            BOOLEAN NULL,
  UNIQUE (session_step_id, attempt_number)
);

CREATE TABLE letter_measures (
  block_attempt_id   UUID NOT NULL REFERENCES block_attempts(id) ON DELETE CASCADE,
  box_id             SMALLINT NOT NULL,
  fill_position      SMALLINT NOT NULL,
  row_index          SMALLINT NOT NULL,
  status             VARCHAR(8) NOT NULL CHECK (status IN ('WRITTEN', 'SKIPPED', 'EMPTY')),
  t_start_us         INT NULL,
  t_end_us           INT NULL,
  stroke_count_raw   SMALLINT NULL,
  path_length_mm     REAL NULL,
  contact_time_ms    REAL NULL,
  dot_closest        JSONB NULL,
  width_mm           REAL NULL,
  mean_pressure      REAL NULL,
  PRIMARY KEY (block_attempt_id, box_id)
);

CREATE TABLE score_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_attempt_id    UUID NOT NULL REFERENCES block_attempts(id) ON DELETE CASCADE,
  version             SMALLINT NOT NULL,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,
  settings_used       JSONB NOT NULL,
  profile_used        JSONB NOT NULL,
  engine_version      VARCHAR(20) NOT NULL,
  reason              VARCHAR(200) NULL,
  computed_by         UUID NULL REFERENCES users(id),
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  letters_expected    SMALLINT NOT NULL,
  pen_lifts           SMALLINT NULL,
  internal_pen_lifts  SMALLINT NULL,
  accurate_letters    SMALLINT NULL,
  accuracy_score      NUMERIC(5,2) NULL,
  sum_line_length_mm  REAL NULL,
  sum_line_time_ms    REAL NULL,
  avg_speed_mm_s      NUMERIC(8,3) NULL,
  speed_score         NUMERIC(5,2) NULL,
  pen_lift_score      NUMERIC(5,2) NULL,
  composite_score     NUMERIC(5,2) NULL,
  pass                BOOLEAN NULL,
  UNIQUE (block_attempt_id, version)
);
CREATE UNIQUE INDEX one_current_score ON score_versions (block_attempt_id) WHERE is_current;

CREATE TABLE letter_scores (
  score_version_id      UUID NOT NULL REFERENCES score_versions(id) ON DELETE CASCADE,
  box_id                SMALLINT NOT NULL,
  pen_lifts_internal    SMALLINT NULL,
  dots_hit              JSONB NULL,
  dot_order_ok          BOOLEAN NULL,
  width_in_band         BOOLEAN NULL,
  line_length_mm        REAL NULL,
  line_time_ms          REAL NULL,
  speed_mm_s            REAL NULL,
  line_start_fallback   BOOLEAN NULL,
  line_end_fallback     BOOLEAN NULL,
  accuracy_score        NUMERIC(5,2) NULL,
  is_accurate           BOOLEAN NULL,
  PRIMARY KEY (score_version_id, box_id)
);

CREATE TABLE intervention_marks (
  block_attempt_id  UUID NOT NULL REFERENCES block_attempts(id) ON DELETE CASCADE,
  box_id            SMALLINT NOT NULL,
  row_type          VARCHAR(12) NOT NULL CHECK (row_type IN ('TRACE_MODEL', 'START_DOT', 'FREEHAND')),
  letter            VARCHAR(8) NOT NULL,
  auto_error        BOOLEAN NULL,
  start_point_ok    BOOLEAN NULL,
  evaluator_error   BOOLEAN NULL,
  final_error       BOOLEAN NULL,
  decided_by        VARCHAR(10) NULL CHECK (decided_by IN ('SYSTEM', 'EVALUATOR')),
  decided_by_user   UUID NULL REFERENCES users(id),
  decided_at        TIMESTAMPTZ NULL,
  similarity_hint   NUMERIC(5,2) NULL,
  PRIMARY KEY (block_attempt_id, box_id)
);

-- ===== Pen telemetry (raw samples) =====
CREATE TABLE pen_samples (
  block_attempt_id  UUID NOT NULL REFERENCES block_attempts(id) ON DELETE CASCADE,
  sample_seq        INT  NOT NULL,
  sample_time       TIMESTAMPTZ NOT NULL,
  t_us              INT  NOT NULL,
  x_mm              REAL NOT NULL,
  y_mm              REAL NOT NULL,
  pressure          REAL NOT NULL,
  tilt_x            SMALLINT NOT NULL DEFAULT 0,
  tilt_y            SMALLINT NOT NULL DEFAULT 0,
  flags             SMALLINT NOT NULL,
  box_id            SMALLINT NOT NULL,
  PRIMARY KEY (block_attempt_id, sample_seq, sample_time)
);
SELECT create_hypertable('pen_samples', 'sample_time', chunk_time_interval => INTERVAL '7 days');
ALTER TABLE pen_samples SET (timescaledb.compress,
  timescaledb.compress_segmentby = 'block_attempt_id', timescaledb.compress_orderby = 'sample_seq');
SELECT add_compression_policy('pen_samples', INTERVAL '30 days');

-- ===== Recorded hand video, paper cohort, legacy =====
CREATE TABLE session_video_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  object_key      VARCHAR(512) NOT NULL,
  camera_label    VARCHAR(50) NOT NULL DEFAULT 'OVERHEAD_HANDS',
  started_at      TIMESTAMPTZ NOT NULL,
  duration_ms     INT NULL,
  sync_offset_ms  INT NOT NULL DEFAULT 0,
  sha256          CHAR(64) NOT NULL
);

CREATE TABLE paper_block_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id    UUID NOT NULL REFERENCES participants(id),
  session_type      VARCHAR(15) NOT NULL CHECK (session_type IN ('DAY_1', 'DAY_2', 'DAY_14')),
  block_number      SMALLINT NOT NULL,
  pen_lifts         SMALLINT NULL,
  accurate_letters  SMALLINT NULL CHECK (accurate_letters BETWEEN 0 AND 15),
  total_time_ms     INT NULL,
  notes             TEXT NULL,
  entered_by        UUID NOT NULL REFERENCES users(id),
  entered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, session_type, block_number)
);

CREATE TABLE legacy_block_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id   UUID NOT NULL REFERENCES participants(id),
  import_batch_id  UUID NOT NULL,
  source_file      VARCHAR(255) NOT NULL,
  session_label    VARCHAR(50) NOT NULL,
  block_number     SMALLINT NOT NULL,
  pen_lifts        SMALLINT NULL,
  width_mm         REAL NULL,
  total_time_ms    INT NULL,
  writing_time_ms  INT NULL,
  air_time_ms      INT NULL,
  raw_row          JSONB NOT NULL,
  imported_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== Application log =====
CREATE TABLE app_events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  severity        VARCHAR(8)  NOT NULL CHECK (severity IN ('DEBUG', 'INFO', 'WARN', 'ERROR', 'SECURITY')),
  event_type      VARCHAR(80) NOT NULL,
  actor_user_id   UUID NULL,
  actor_role      VARCHAR(20) NULL,
  device_id       UUID NULL,
  domain_id       INT NULL,
  region_id       INT NULL,
  session_id      UUID NULL,
  entity_type     VARCHAR(40) NULL,
  entity_id       VARCHAR(64) NULL,
  correlation_id  UUID NULL,
  client_ip       INET NULL,
  message         TEXT NOT NULL,
  details         JSONB NOT NULL DEFAULT '{}',
  search_text     TSVECTOR GENERATED ALWAYS AS
                  (to_tsvector('simple', message || ' ' || event_type || ' ' || details::text)) STORED,
  PRIMARY KEY (id, occurred_at)
);
SELECT create_hypertable('app_events', 'occurred_at', chunk_time_interval => INTERVAL '30 days');
CREATE INDEX ON app_events (event_type, occurred_at DESC);
CREATE INDEX ON app_events (session_id, occurred_at DESC);
CREATE INDEX ON app_events (actor_user_id, occurred_at DESC);
CREATE INDEX ON app_events (domain_id, region_id, occurred_at DESC);
CREATE INDEX ON app_events USING GIN (details jsonb_path_ops);
CREATE INDEX ON app_events USING GIN (search_text);

-- ===== Research views (analysts see only these) =====
CREATE VIEW v_research_sessions AS
SELECT s.id AS session_id, p.study_code, p.domain_id, p.region_id, p.school_code_hmac,
       p.grade_level, p.gender, p.ses_group, p.dominant_hand, p.cohort,
       s.session_type, s.language_code, s.age_months, s.device_model, s.css_px_per_mm,
       s.settings_snapshot, s.started_at, s.completed_at
FROM sessions s
JOIN participants p ON p.id = s.participant_id
JOIN consent_records c ON c.participant_id = p.id AND c.superseded_at IS NULL
WHERE s.purpose = 'RESEARCH' AND c.allows_research_use AND s.status = 'COMPLETED';

CREATE VIEW v_research_blocks AS
SELECT rs.session_id, rs.study_code, st.step_type, st.block_number, c.code AS canvas_code, c.version AS canvas_version,
       st.mirrored, b.id AS block_attempt_id, b.attempt_number, b.status, b.total_time_ms,
       b.active_writing_time_ms, b.air_time_ms, b.last_box_completed, b.skipped_boxes,
       sv.version AS score_version, sv.pen_lifts, sv.internal_pen_lifts, sv.accurate_letters,
       sv.accuracy_score, sv.avg_speed_mm_s, sv.speed_score, sv.pen_lift_score, sv.composite_score, sv.pass
FROM v_research_sessions rs
JOIN session_steps st ON st.session_id = rs.session_id
LEFT JOIN canvases c ON c.id = st.canvas_id
JOIN block_attempts b ON b.session_step_id = st.id
LEFT JOIN score_versions sv ON sv.block_attempt_id = b.id AND sv.is_current;

CREATE VIEW v_research_letters AS
SELECT rb.session_id, rb.block_attempt_id, lm.box_id, lm.fill_position, lm.row_index, lm.status,
       lm.t_start_us, lm.t_end_us, lm.stroke_count_raw, lm.path_length_mm, lm.contact_time_ms,
       lm.dot_closest, lm.width_mm, lm.mean_pressure, ls.dots_hit, ls.dot_order_ok, ls.width_in_band,
       ls.line_length_mm, ls.line_time_ms, ls.speed_mm_s, ls.accuracy_score, ls.is_accurate
FROM v_research_blocks rb
JOIN letter_measures lm ON lm.block_attempt_id = rb.block_attempt_id
LEFT JOIN score_versions sv ON sv.block_attempt_id = rb.block_attempt_id AND sv.is_current
LEFT JOIN letter_scores ls ON ls.score_version_id = sv.id AND ls.box_id = lm.box_id;

CREATE VIEW v_research_samples AS
SELECT ps.* FROM pen_samples ps
WHERE ps.block_attempt_id IN (SELECT block_attempt_id FROM v_research_blocks);

-- ===== Grants =====
GRANT USAGE ON SCHEMA public TO ilt_app, ilt_analyst;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ilt_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ilt_app;
-- Append-only for the application: log, settings history, raw samples.
REVOKE UPDATE, DELETE, TRUNCATE ON app_events, setting_value_history, pen_samples FROM ilt_app;
REVOKE UPDATE, DELETE, TRUNCATE ON app_events, setting_value_history FROM PUBLIC;
-- Analysts read research views only.
GRANT SELECT ON v_research_sessions, v_research_blocks, v_research_letters, v_research_samples TO ilt_analyst;
