-- Phase 6b′: beta access. Beta testers write with the DTH-A116 or with a touch-screen tablet (beta touch
-- build only). A touch session has no hover, pressure or tilt and a lower, less regular sample rate, so its
-- measures are not comparable with pen sessions: every session records how it was written, and the
-- research views (and so the analyst portal and the exports, which read only them) leave TOUCH sessions out.
ALTER TABLE sessions
  ADD COLUMN input_kind VARCHAR(5) NOT NULL DEFAULT 'PEN' CHECK (input_kind IN ('PEN', 'TOUCH'));

-- As in 0005, with input_kind appended and TOUCH sessions left out. Every other research view reads
-- from this one.
CREATE OR REPLACE VIEW v_research_sessions AS
SELECT s.id AS session_id, p.study_code, p.domain_id, p.region_id, p.school_code_hmac,
       p.grade_level, p.gender, p.ses_group, p.dominant_hand, p.cohort,
       s.session_type, s.language_code, s.age_months, s.device_model, s.css_px_per_mm,
       s.settings_snapshot, s.started_at, s.completed_at,
       s.session_code,
       s.input_kind
FROM sessions s
JOIN participants p ON p.id = s.participant_id
JOIN consent_records c ON c.participant_id = p.id AND c.superseded_at IS NULL
WHERE s.purpose = 'RESEARCH' AND c.allows_research_use AND s.status = 'COMPLETED' AND s.input_kind = 'PEN';
