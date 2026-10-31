-- Persist the active/completed Instant Video Replay workflow with the match.
-- Decisions and corrections remain in the append-only match event and audit logs.
ALTER TABLE matches ADD COLUMN review_json TEXT;
