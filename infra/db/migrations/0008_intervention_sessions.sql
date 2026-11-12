-- Phase 5b: intervention sessions (FRS FR-PLAN-3, FR-COCK-7; DDD §10, §11.1).
-- An intervention session trains one target letter (TRAINING: the letter video, then the training
-- sheets) or checks it two weeks later (RETENTION: one sheet). The letter is the canvas its sheets use.
ALTER TABLE sessions
  ADD COLUMN intervention_kind VARCHAR(10) NULL CHECK (intervention_kind IN ('TRAINING', 'RETENTION')),
  ADD COLUMN intervention_canvas_id UUID NULL REFERENCES canvases(id);
ALTER TABLE sessions ADD CONSTRAINT sessions_intervention_check
  CHECK ((session_type = 'INTERVENTION') = (intervention_kind IS NOT NULL AND intervention_canvas_id IS NOT NULL));
CREATE INDEX sessions_intervention_letter ON sessions (participant_id, intervention_canvas_id) WHERE session_type = 'INTERVENTION';
