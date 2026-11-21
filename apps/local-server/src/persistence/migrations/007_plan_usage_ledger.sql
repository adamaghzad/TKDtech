-- Tamper-resistant plan usage ledger (1.2.26).
-- Quota counters primarily read editable data columns (matches.actual_start_at,
-- tournaments.created_at). The ledger keeps an independent, append-only record
-- of billable events (match starts, tournament creations); usage is the MAX of
-- both sources, so resetting or backdating a data column no longer resets the
-- allowance. Ledger rows whose referenced entity was deleted stop counting:
-- deleting a tournament legitimately frees its yearly slot.
CREATE TABLE IF NOT EXISTS plan_usage_ledger (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('MATCH_STARTED','TOURNAMENT_CREATED')),
  period_key TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_usage_ledger_period ON plan_usage_ledger(kind, period_key);
CREATE INDEX IF NOT EXISTS idx_plan_usage_ledger_time ON plan_usage_ledger(kind, occurred_at);
