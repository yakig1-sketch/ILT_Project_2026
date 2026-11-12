-- Phase 4d: legacy import and paper-cohort scores (FRS FR-LEG-1, FR-LEG-2; DDD §9, §14).

-- Children imported from the old application are known only by its number and hand flag: grade and
-- gender (and the hand, when the flag is missing) stay "not recorded" (NULL) until someone completes
-- the record. Every other participant still needs them.
ALTER TABLE participants ALTER COLUMN grade_level DROP NOT NULL, ALTER COLUMN gender DROP NOT NULL, ALTER COLUMN dominant_hand DROP NOT NULL;
ALTER TABLE participants ADD CONSTRAINT participants_demographics_check
  CHECK (cohort = 'LEGACY' OR (grade_level IS NOT NULL AND gender IS NOT NULL AND dominant_hand IS NOT NULL));
-- One legacy participant per old-application number.
CREATE UNIQUE INDEX participants_legacy_ref ON participants (legacy_ref) WHERE cohort = 'LEGACY';

-- One legacy import: the files read together (one measure each), by whom, into which session label.
CREATE TABLE legacy_import_batches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_by           UUID NOT NULL REFERENCES users(id),
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_label         VARCHAR(50) NOT NULL,
  domain_id             INT NOT NULL REFERENCES domains(id),
  files                 JSONB NOT NULL,          -- [{name, measure, rows}]
  participants_created  INT NOT NULL,
  participants_matched  INT NOT NULL,
  block_rows            INT NOT NULL
);
GRANT SELECT, INSERT ON legacy_import_batches TO ilt_app;

-- The five measure files of one import fill the same rows: one row per child, session label and block.
-- Importing a file again updates its measure (the latest batch is recorded on the row).
ALTER TABLE legacy_block_results ADD CONSTRAINT legacy_block_results_one_row UNIQUE (participant_id, session_label, block_number);
ALTER TABLE legacy_block_results ADD CONSTRAINT legacy_block_results_batch_fkey FOREIGN KEY (import_batch_id) REFERENCES legacy_import_batches(id);
ALTER TABLE legacy_block_results ALTER COLUMN source_file TYPE VARCHAR(1000);

-- Paper scores: who changed them last (the first entry keeps entered_by / entered_at).
ALTER TABLE paper_block_scores ADD COLUMN updated_by UUID NULL REFERENCES users(id), ADD COLUMN updated_at TIMESTAMPTZ NULL;
