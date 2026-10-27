CREATE TABLE license_deliveries (
  id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL UNIQUE,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES profiles(id),
  club_name TEXT NOT NULL,
  client_email TEXT NOT NULL,
  plan TEXT NOT NULL CHECK(plan IN ('FOUNDING_CLUB','CLUB','TOURNAMENT_SUPPORT')),
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

CREATE INDEX idx_license_deliveries_created ON license_deliveries(created_at DESC);
CREATE INDEX idx_license_deliveries_device ON license_deliveries(device_code,created_at DESC);
