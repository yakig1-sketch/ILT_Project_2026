-- Phase 5b QA Take#1 (T5): every measured attempt keeps its pen lifts, also when it has no score
-- version (notebook pages, the warm-up and, until sheet scoring, intervention sheets).
ALTER TABLE block_attempts ADD COLUMN pen_lifts SMALLINT NULL;
