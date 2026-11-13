-- Phase 5d: intervention sheet marks for analysts and exports (FRS FR-AN-2, FR-SCORE-15; DDD §9).
-- One row per letter of each research sheet attempt. Who decided is kept as SYSTEM / EVALUATOR only:
-- the evaluator's identity is not research data.
CREATE VIEW v_research_marks AS
SELECT rb.session_id, rb.study_code, rb.block_attempt_id, rb.step_index, rb.block_number, rb.canvas_code,
       im.box_id, im.row_type, im.letter, im.auto_error, im.start_point_ok, im.evaluator_error, im.final_error,
       im.decided_by, im.decided_at, im.similarity_hint, im.internal_pen_lifts, im.lifts_allowed
FROM v_research_blocks rb
JOIN intervention_marks im ON im.block_attempt_id = rb.block_attempt_id;

GRANT SELECT ON v_research_marks TO ilt_analyst;
