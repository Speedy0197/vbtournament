CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL CHECK(group_name IN ('A', 'B')), icon_path TEXT
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase TEXT NOT NULL CHECK(phase IN ('group', 'gold_sf', 'silver_sf', 'gold_final', 'silver_final')),
  court INTEGER, team1_id INTEGER REFERENCES teams(id), team2_id INTEGER REFERENCES teams(id), label TEXT,
  set_target INTEGER NOT NULL DEFAULT 25, deciding_set_target INTEGER NOT NULL DEFAULT 15, estimated_minutes INTEGER NOT NULL DEFAULT 40,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'done'))
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_playoff ON matches(phase, label) WHERE phase <> 'group';
CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL CHECK(set_number IN (1, 2, 3)),
  team1_score INTEGER NOT NULL DEFAULT 0, team2_score INTEGER NOT NULL DEFAULT 0,
  UNIQUE(match_id, set_number)
);
CREATE TABLE IF NOT EXISTS team_icons (
  team_id INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
  mime_type TEXT NOT NULL, version TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS icon_chunks (
  team_id INTEGER NOT NULL REFERENCES team_icons(team_id) ON DELETE CASCADE,
  chunk_number INTEGER NOT NULL, bytes TEXT NOT NULL, PRIMARY KEY(team_id, chunk_number)
);
