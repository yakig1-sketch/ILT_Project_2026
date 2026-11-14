-- Phase 5e: paper-cohort and legacy results for analysts and exports (FRS FR-LEG-1/2, FR-AN-1/2/3; DDD §9).
-- As for tablet sessions, only participants whose current consent allows research use. Participant
-- attributes as in v_research_sessions; no notes, file names or raw rows (they may name people).
CREATE VIEW v_research_paper_blocks AS
SELECT p.study_code, p.domain_id, p.region_id, p.school_code_hmac, p.grade_level, p.gender, p.ses_group, p.dominant_hand, p.cohort,
       pb.session_type, pb.block_number, pb.pen_lifts, pb.accurate_letters, pb.total_time_ms, pb.entered_at, pb.updated_at
FROM paper_block_scores pb
JOIN participants p ON p.id = pb.participant_id
JOIN consent_records c ON c.participant_id = p.id AND c.superseded_at IS NULL
WHERE c.allows_research_use;

CREATE VIEW v_research_legacy_blocks AS
SELECT p.study_code, p.domain_id, p.region_id, p.school_code_hmac, p.grade_level, p.gender, p.ses_group, p.dominant_hand, p.cohort,
       l.session_label, l.block_number, l.pen_lifts, l.width_mm, l.total_time_ms, l.writing_time_ms, l.air_time_ms, l.imported_at
FROM legacy_block_results l
JOIN participants p ON p.id = l.participant_id
JOIN consent_records c ON c.participant_id = p.id AND c.superseded_at IS NULL
WHERE c.allows_research_use;

GRANT SELECT ON v_research_paper_blocks, v_research_legacy_blocks TO ilt_analyst;
