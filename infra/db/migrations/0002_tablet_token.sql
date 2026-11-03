-- Phase 2 QA: the evaluator can release the tablet from an unfinished session (Phase 2 QA take 1, item 1).
-- Each pairing issues a tablet token with a new id. The gateway accepts a tablet only while its token
-- id is the session's current one; releasing the tablet clears it, so the old token stops working.
ALTER TABLE sessions ADD COLUMN tablet_token_id UUID NULL;
