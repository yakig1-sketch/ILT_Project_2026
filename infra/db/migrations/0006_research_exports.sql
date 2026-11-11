-- Phase 4c: research exports (FRS FR-AN-2, FR-AN-3; DDD §9, §14).

-- Every score version of the research block attempts (FR-AN-2 "score versions"). Leaves out who
-- recomputed and the free-text reason, which may name staff; the rest describes the computation.
CREATE VIEW v_research_score_versions AS
SELECT rb.session_id, sv.block_attempt_id, sv.version, sv.is_current, sv.engine_version, sv.computed_at,
       sv.settings_used, sv.profile_used, sv.letters_expected, sv.pen_lifts, sv.internal_pen_lifts,
       sv.accurate_letters, sv.accuracy_score, sv.sum_line_length_mm, sv.sum_line_time_ms, sv.avg_speed_mm_s,
       sv.speed_score, sv.pen_lift_score, sv.composite_score, sv.pass
FROM v_research_blocks rb
JOIN score_versions sv ON sv.block_attempt_id = rb.block_attempt_id;

GRANT SELECT ON v_research_score_versions TO ilt_analyst;

-- One export request: the filter it used and, once built, the file in the private exports bucket.
-- Written by the gateway; the analytics service builds the file from the research views only.
CREATE TABLE research_exports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by  UUID NOT NULL REFERENCES users(id),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        VARCHAR(10) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'READY', 'FAILED')),
  format        VARCHAR(10) NOT NULL CHECK (format IN ('PARQUET', 'CSV')),
  filters       JSONB NOT NULL DEFAULT '{}',
  include_samples    BOOLEAN NOT NULL DEFAULT false,
  include_kinematics BOOLEAN NOT NULL DEFAULT false,
  session_count INTEGER NOT NULL,
  object_key    VARCHAR(200),
  size_bytes    BIGINT,
  row_counts    JSONB,
  error         VARCHAR(500),
  finished_at   TIMESTAMPTZ
);
CREATE INDEX research_exports_requested_by ON research_exports (requested_by, requested_at DESC);

GRANT SELECT, INSERT, UPDATE ON research_exports TO ilt_app;
