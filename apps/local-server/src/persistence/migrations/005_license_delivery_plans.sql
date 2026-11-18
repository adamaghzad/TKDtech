-- SALLE / SALLE_PLUS monthly subscription plans: widen the plan CHECK.
-- SQLite cannot alter a CHECK constraint in place, so the table is rebuilt
-- with the same columns and uniqueness, and the existing delivery history
-- (already issued licenses, SENT/FAILED audit trail) is carried over.
CREATE TABLE license_deliveries_rebuilt (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES profiles(id),
  club_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('FOUNDING_CLUB','CLUB','TOURNAMENT_SUPPORT','SALLE','SALLE_PLUS')),
  device_code TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SENDING','SENT','FAILED')),
  email_message_id TEXT,
  delivery_error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(actor_id,request_key)
);

INSERT INTO license_deliveries_rebuilt (
  id, license_id, request_key, request_hash, actor_id, club_name, client_email, plan, device_code,
  issued_at, expires_at, status, email_message_id, delivery_error, created_at, sent_at
)
SELECT
  id, license_id, request_key, request_hash, actor_id, club_name, client_email, plan, device_code,
  issued_at, expires_at, status, email_message_id, delivery_error, created_at, sent_at
FROM license_deliveries;

DROP TABLE license_deliveries;
ALTER TABLE license_deliveries_rebuilt RENAME TO license_deliveries;

CREATE INDEX idx_license_deliveries_created ON license_deliveries(created_at DESC);
CREATE INDEX idx_license_deliveries_device ON license_deliveries(device_code, created_at DESC);
