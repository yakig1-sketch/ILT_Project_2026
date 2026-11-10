-- Phase 4a: analyst portal (FRS FR-AN-1, FR-AN-3, FR-REP-4; DDD §9 research views, §14).
-- The gateway answers every research route as ilt_analyst (SET LOCAL ROLE inside a transaction), so
-- the database itself limits those routes to the research views and to non-personal reference data.

-- Columns appended at the end (CREATE OR REPLACE VIEW keeps the existing ones in place).
CREATE OR REPLACE VIEW v_research_sessions AS
SELECT s.id AS session_id, p.study_code, p.domain_id, p.region_id, p.school_code_hmac,
       p.grade_level, p.gender, p.ses_group, p.dominant_hand, p.cohort,
       s.session_type, s.language_code, s.age_months, s.device_model, s.css_px_per_mm,
       s.settings_snapshot, s.started_at, s.completed_at,
       s.session_code
FROM sessions s
JOIN participants p ON p.id = s.participant_id
JOIN consent_records c ON c.participant_id = p.id AND c.superseded_at IS NULL
WHERE s.purpose = 'RESEARCH' AND c.allows_research_use AND s.status = 'COMPLETED';

CREATE OR REPLACE VIEW v_research_blocks AS
SELECT rs.session_id, rs.study_code, st.step_type, st.block_number, c.code AS canvas_code, c.version AS canvas_version,
       st.mirrored, b.id AS block_attempt_id, b.attempt_number, b.status, b.total_time_ms,
       b.active_writing_time_ms, b.air_time_ms, b.last_box_completed, b.skipped_boxes,
       sv.version AS score_version, sv.pen_lifts, sv.internal_pen_lifts, sv.accurate_letters,
       sv.accuracy_score, sv.avg_speed_mm_s, sv.speed_score, sv.pen_lift_score, sv.composite_score, sv.pass,
       st.step_index, st.is_scored, st.label_key, st.fill_order, st.canvas_id, b.sample_count
FROM v_research_sessions rs
JOIN session_steps st ON st.session_id = rs.session_id
LEFT JOIN canvases c ON c.id = st.canvas_id
JOIN block_attempts b ON b.session_step_id = st.id
LEFT JOIN score_versions sv ON sv.block_attempt_id = b.id AND sv.is_current;

-- Canvas geometry for replay: the canvas library holds no personal data.
CREATE OR REPLACE VIEW v_research_canvases AS
SELECT c.id AS canvas_id, c.code, c.version, c.geometry FROM canvases c;

GRANT SELECT ON v_research_sessions, v_research_blocks, v_research_letters, v_research_samples, v_research_canvases TO ilt_analyst;
-- Names for the Domain and Region filters.
GRANT SELECT ON domains, regions TO ilt_analyst;
-- The gateway may take the analyst role for research routes (SET LOCAL ROLE ilt_analyst).
GRANT ilt_analyst TO ilt_app;
