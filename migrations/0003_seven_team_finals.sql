-- Copy both tables before replacing matches so ON DELETE CASCADE cannot lose scores.
CREATE TABLE matches_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase TEXT NOT NULL CHECK(phase IN ('group','gold_sf','silver_sf','gold_final','silver_final','placement')),
  court INTEGER, team1_id INTEGER REFERENCES teams(id), team2_id INTEGER REFERENCES teams(id), label TEXT,
  set_target INTEGER NOT NULL DEFAULT 25, deciding_set_target INTEGER NOT NULL DEFAULT 15,
  estimated_minutes INTEGER NOT NULL DEFAULT 40,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','done')),
  scoring_format TEXT NOT NULL DEFAULT 'sets' CHECK(scoring_format IN ('sets','timed')),
  timed_periods INTEGER NOT NULL DEFAULT 1 CHECK(timed_periods IN (1,2)),
  sets_to_win INTEGER NOT NULL DEFAULT 2 CHECK(sets_to_win IN (1,2))
);
INSERT INTO matches_new (id,phase,court,team1_id,team2_id,label,set_target,deciding_set_target,estimated_minutes,status,scoring_format)
  SELECT id,phase,court,team1_id,team2_id,label,set_target,deciding_set_target,estimated_minutes,status,scoring_format FROM matches;
CREATE TABLE sets_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES matches_new(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL CHECK(set_number IN (1,2,3)),
  team1_score INTEGER NOT NULL DEFAULT 0, team2_score INTEGER NOT NULL DEFAULT 0,
  UNIQUE(match_id,set_number)
);
INSERT INTO sets_new SELECT * FROM sets;
DROP TABLE sets;
DROP TABLE matches;
ALTER TABLE matches_new RENAME TO matches;
ALTER TABLE sets_new RENAME TO sets;
CREATE UNIQUE INDEX unique_playoff ON matches(phase,label) WHERE phase <> 'group';

-- An untouched timed league can adopt the new rules without regenerating pairings.
-- Started events keep their original scoring format.
WITH slots AS (
  SELECT id, row_number() OVER (PARTITION BY court ORDER BY id) - 1 AS slot
  FROM matches WHERE phase = 'group' AND scoring_format = 'timed'
)
UPDATE matches SET timed_periods = 2,
  label = (SELECT printf('Slot %d · %02d:%02d–%02d:%02d · 2 × 10 min',
    slot + 1, (600 + slot * 25) / 60, (600 + slot * 25) % 60,
    (625 + slot * 25) / 60, (625 + slot * 25) % 60) FROM slots WHERE slots.id = matches.id)
WHERE phase = 'group' AND scoring_format = 'timed'
  AND NOT EXISTS (SELECT 1 FROM sets)
  AND NOT EXISTS (SELECT 1 FROM matches WHERE status <> 'pending' OR phase <> 'group' OR scoring_format <> 'timed')
  AND NOT EXISTS (SELECT 1 FROM teams WHERE group_name <> 'A')
  AND EXISTS (SELECT 1 FROM settings WHERE key = 'tournament_mode'
    AND (value = 'league' OR (value = 'auto' AND (SELECT count(*) FROM teams) = 7)));
