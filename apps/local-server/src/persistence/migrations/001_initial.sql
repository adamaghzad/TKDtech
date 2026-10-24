PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','TOURNAMENT_ADMIN','REGISTRATION_MANAGER','MAT_OPERATOR','REFEREE','CORNER_JUDGE','PUBLIC_VIEWER')),
  PRIMARY KEY(organization_id, profile_id)
);
CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
  organizer TEXT NOT NULL, venue TEXT NOT NULL, country TEXT NOT NULL,
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, timezone TEXT NOT NULL,
  registration_opens TEXT, registration_closes TEXT,
  status TEXT NOT NULL CHECK(status IN ('DRAFT','REGISTRATION_OPEN','REGISTRATION_CLOSED','DRAW_READY','IN_PROGRESS','COMPLETED','CANCELLED')),
  mode TEXT NOT NULL DEFAULT 'LOCAL' CHECK(mode IN ('LOCAL','CLOUD')),
  mat_count INTEGER NOT NULL DEFAULT 1 CHECK(mat_count BETWEEN 1 AND 32),
  ruleset_id TEXT NOT NULL, is_development_seed INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tournament_rulesets (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  version TEXT NOT NULL, name TEXT NOT NULL, config_json TEXT NOT NULL,
  effective_date TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(tournament_id, version)
);
CREATE TABLE IF NOT EXISTS clubs (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL, country TEXT NOT NULL, country_code TEXT NOT NULL,
  head_coach TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '', logo_url TEXT,
  created_at TEXT NOT NULL, UNIQUE(tournament_id, name)
);
CREATE TABLE IF NOT EXISTS athletes (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  club_id TEXT REFERENCES clubs(id), first_name TEXT NOT NULL, last_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL, division TEXT NOT NULL CHECK(division IN ('MEN','WOMEN')),
  nationality TEXT NOT NULL, country_code TEXT NOT NULL, external_number TEXT,
  coach TEXT NOT NULL DEFAULT '', photo_url TEXT, eligibility_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(eligibility_status IN ('PENDING','ELIGIBLE','INELIGIBLE','WITHDRAWN','DISQUALIFIED')),
  created_at TEXT NOT NULL, UNIQUE(tournament_id, external_number)
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL, division TEXT NOT NULL, age_group TEXT NOT NULL,
  min_weight_kg REAL NOT NULL, max_weight_kg REAL NOT NULL,
  ruleset_id TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('SINGLE_ELIMINATION','REPECHAGE')),
  rounds INTEGER NOT NULL, round_duration_ms INTEGER NOT NULL, break_duration_ms INTEGER NOT NULL,
  golden_point_policy TEXT NOT NULL, repechage_policy TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','WEIGH_IN','DRAW_READY','IN_PROGRESS','COMPLETED','CANCELLED')),
  CHECK(max_weight_kg > min_weight_kg), UNIQUE(tournament_id, name, age_group)
);
CREATE TABLE IF NOT EXISTS athlete_registrations (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'REGISTERED' CHECK(status IN ('REGISTERED','CONFIRMED','WITHDRAWN','DISQUALIFIED')),
  created_at TEXT NOT NULL, UNIQUE(athlete_id, category_id)
);
CREATE TABLE IF NOT EXISTS weigh_ins (
  id TEXT PRIMARY KEY, registration_id TEXT NOT NULL REFERENCES athlete_registrations(id) ON DELETE CASCADE,
  weight_kg REAL NOT NULL CHECK(weight_kg > 0), unit TEXT NOT NULL DEFAULT 'kg' CHECK(unit='kg'),
  passed INTEGER NOT NULL CHECK(passed IN (0,1)), recorded_at TEXT NOT NULL,
  recorded_by TEXT REFERENCES profiles(id), UNIQUE(registration_id)
);
CREATE TABLE IF NOT EXISTS tournament_seeds (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  athlete_id TEXT NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  seed_position INTEGER NOT NULL CHECK(seed_position > 0), UNIQUE(category_id, athlete_id), UNIQUE(category_id, seed_position)
);
CREATE TABLE IF NOT EXISTS mats (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL, display_slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'AVAILABLE'
    CHECK(status IN ('AVAILABLE','OCCUPIED','OFFLINE')),
  queue_json TEXT NOT NULL DEFAULT '[]', network_status TEXT NOT NULL DEFAULT 'ONLINE',
  created_at TEXT NOT NULL, UNIQUE(tournament_id, name)
);
CREATE TABLE IF NOT EXISTS draws (
  id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method IN ('RANDOM','SEEDED')), seed TEXT NOT NULL,
  ruleset_version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PUBLISHED','CORRECTED')),
  published_version INTEGER, created_at TEXT NOT NULL, created_by TEXT REFERENCES profiles(id)
);
CREATE TABLE IF NOT EXISTS draw_versions (
  id TEXT PRIMARY KEY, draw_id TEXT NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, published_at TEXT NOT NULL,
  published_by TEXT REFERENCES profiles(id), UNIQUE(draw_id, version)
);
CREATE TABLE IF NOT EXISTS brackets (
  id TEXT PRIMARY KEY, draw_id TEXT NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id), size INTEGER NOT NULL,
  graph_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(draw_id)
);
CREATE TABLE IF NOT EXISTS bracket_nodes (
  id TEXT PRIMARY KEY, bracket_id TEXT NOT NULL REFERENCES brackets(id) ON DELETE CASCADE,
  round INTEGER NOT NULL, position INTEGER NOT NULL, round_name TEXT NOT NULL,
  source_json TEXT NOT NULL DEFAULT '[]', destination_id TEXT,
  destination_side TEXT, blue_athlete_id TEXT REFERENCES athletes(id), red_athlete_id TEXT REFERENCES athletes(id),
  winner_athlete_id TEXT REFERENCES athletes(id), status TEXT NOT NULL, is_bye INTEGER NOT NULL DEFAULT 0,
  UNIQUE(bracket_id, round, position)
);
CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  category_id TEXT NOT NULL REFERENCES categories(id), bracket_node_id TEXT REFERENCES bracket_nodes(id),
  match_number TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'MAIN', mat_id TEXT REFERENCES mats(id),
  blue_athlete_id TEXT REFERENCES athletes(id), red_athlete_id TEXT REFERENCES athletes(id),
  state TEXT NOT NULL CHECK(state IN ('PENDING','READY','CALLED','IN_PROGRESS','PAUSED','ROUND_BREAK','GOLDEN_POINT','UNDER_REVIEW','COMPLETED','WALKOVER','WITHDRAWN','DISQUALIFIED','CANCELLED')),
  current_round INTEGER NOT NULL DEFAULT 1, blue_score INTEGER NOT NULL DEFAULT 0, red_score INTEGER NOT NULL DEFAULT 0,
  blue_gam_jeom INTEGER NOT NULL DEFAULT 0, red_gam_jeom INTEGER NOT NULL DEFAULT 0,
  winner_side TEXT CHECK(winner_side IN ('BLUE','RED')), decision_method TEXT,
  timer_json TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  queue_position INTEGER, scheduled_at TEXT, actual_start_at TEXT, actual_end_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(tournament_id, match_number)
);
CREATE TABLE IF NOT EXISTS match_rounds (
  id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  number INTEGER NOT NULL, blue_score INTEGER NOT NULL DEFAULT 0, red_score INTEGER NOT NULL DEFAULT 0,
  blue_penalties INTEGER NOT NULL DEFAULT 0, red_penalties INTEGER NOT NULL DEFAULT 0,
  winner_side TEXT CHECK(winner_side IN ('BLUE','RED')), decision_method TEXT,
  started_at TEXT, ended_at TEXT, UNIQUE(match_id, number)
);
CREATE TABLE IF NOT EXISTS match_events (
  event_id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, event_type TEXT NOT NULL, actor_id TEXT, actor_session_id TEXT,
  payload_json TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  server_timestamp INTEGER NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(match_id, sequence), UNIQUE(match_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS scoring_proposals (
  event_id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES match_rounds(id), judge_session_id TEXT NOT NULL,
  judge_id TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('BLUE','RED')), point_type TEXT NOT NULL,
  submitted_at INTEGER NOT NULL, event_sequence INTEGER NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','REJECTED','EXPIRED')),
  reason TEXT NOT NULL, decision_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(judge_session_id, event_sequence)
);
CREATE TABLE IF NOT EXISTS judge_sessions (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK(role IN ('J1','J2','J3')),
  device_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')),
  last_sequence INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER,
  expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS referee_sessions (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, device_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED','EXPIRED')),
  last_seen_at INTEGER, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pairing_tokens (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('J1','J2','J3','REFEREE')),
  expires_at INTEGER NOT NULL, used_at INTEGER, created_by TEXT REFERENCES profiles(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_presence (
  session_id TEXT PRIMARY KEY, role TEXT NOT NULL, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('ONLINE','RECONNECTING','OFFLINE')),
  last_seen_at INTEGER NOT NULL, connected_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS match_assignments (
  id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  mat_id TEXT NOT NULL REFERENCES mats(id), assigned_at TEXT NOT NULL, unassigned_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_match_per_mat ON match_assignments(mat_id) WHERE unassigned_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_active_assignment_per_match ON match_assignments(match_id) WHERE unassigned_at IS NULL;
CREATE TABLE IF NOT EXISTS tournament_results (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  match_id TEXT NOT NULL UNIQUE REFERENCES matches(id), winner_athlete_id TEXT REFERENCES athletes(id),
  loser_athlete_id TEXT REFERENCES athletes(id), decision_method TEXT NOT NULL,
  blue_score INTEGER NOT NULL, red_score INTEGER NOT NULL, completed_at TEXT NOT NULL,
  version INTEGER NOT NULL, correction_of TEXT REFERENCES tournament_results(id)
);
CREATE TABLE IF NOT EXISTS medal_standings (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  athlete_id TEXT NOT NULL REFERENCES athletes(id), club_id TEXT REFERENCES clubs(id),
  category_id TEXT NOT NULL REFERENCES categories(id), place INTEGER NOT NULL CHECK(place IN (1,2,3)),
  result_id TEXT NOT NULL REFERENCES tournament_results(id), UNIQUE(category_id, athlete_id, place)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, tournament_id TEXT REFERENCES tournaments(id), actor_id TEXT,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT, reason TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS synchronization_jobs (
  id TEXT PRIMARY KEY, tournament_id TEXT NOT NULL REFERENCES tournaments(id),
  direction TEXT NOT NULL CHECK(direction IN ('PUSH','PULL')), status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','CONFLICT','COMPLETED','FAILED')),
  last_event_id TEXT, last_version INTEGER NOT NULL DEFAULT 0, conflict_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_athletes_tournament_name ON athletes(tournament_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_registrations_category ON athlete_registrations(category_id, status);
CREATE INDEX IF NOT EXISTS idx_matches_tournament_state ON matches(tournament_id, state, mat_id);
CREATE INDEX IF NOT EXISTS idx_match_events_match_sequence ON match_events(match_id, sequence);
CREATE INDEX IF NOT EXISTS idx_proposals_consensus ON scoring_proposals(match_id, round_id, side, point_type, status, submitted_at);
CREATE INDEX IF NOT EXISTS idx_audit_tournament_time ON audit_logs(tournament_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS immutable_published_draw_update BEFORE UPDATE ON draw_versions
BEGIN SELECT RAISE(ABORT, 'Published draw versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_published_draw_delete BEFORE DELETE ON draw_versions
BEGIN SELECT RAISE(ABORT, 'Published draw versions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS append_only_match_events_update BEFORE UPDATE ON match_events
BEGIN SELECT RAISE(ABORT, 'Match events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS append_only_match_events_delete BEFORE DELETE ON match_events
BEGIN SELECT RAISE(ABORT, 'Match events are append-only'); END;
