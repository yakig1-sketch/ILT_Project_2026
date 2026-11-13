-- Phase 5c QA Take#1 (M2): a row-1 mark keeps why the system suggested it, so the stored marks show
-- "lifts n (allowed k)" as the live ones do.
ALTER TABLE intervention_marks
  ADD COLUMN internal_pen_lifts SMALLINT NULL,
  ADD COLUMN lifts_allowed SMALLINT NULL;
