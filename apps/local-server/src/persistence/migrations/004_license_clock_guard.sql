-- Offline subscription enforcement: high-water clock guard.
-- Stores the furthest trustworthy time the licensed server has observed so a
-- rolled-back system clock cannot extend an expired subscription. The row lives
-- in the tournament database (not a loose file) so resetting it would also wipe
-- the client's competition data.
CREATE TABLE IF NOT EXISTS license_clock_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_seen_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
