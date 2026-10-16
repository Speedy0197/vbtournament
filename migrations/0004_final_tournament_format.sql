ALTER TABLE matches ADD COLUMN fixed_sets INTEGER NOT NULL DEFAULT 0 CHECK(fixed_sets IN (0,2));

-- Upgrade an untouched league to the final 20-minute timetable without changing pairings.
WITH slots AS (
  SELECT id, row_number() OVER (PARTITION BY court ORDER BY id) - 1 AS slot
  FROM matches WHERE phase = 'group' AND scoring_format = 'timed'
)
UPDATE matches SET timed_periods = 2, estimated_minutes = 20,
  label = (SELECT printf('Slot %d · %02d:%02d–%02d:%02d · 2 × 10 min',
    slot + 1, (600 + slot * 20) / 60, (600 + slot * 20) % 60,
    (620 + slot * 20) / 60, (620 + slot * 20) % 60) FROM slots WHERE slots.id = matches.id)
WHERE phase = 'group' AND scoring_format = 'timed'
  AND NOT EXISTS (SELECT 1 FROM sets)
  AND NOT EXISTS (SELECT 1 FROM matches WHERE status <> 'pending' OR phase <> 'group')
  AND NOT EXISTS (SELECT 1 FROM teams WHERE group_name <> 'A')
  AND EXISTS (SELECT 1 FROM settings WHERE key = 'tournament_mode'
    AND (value = 'league' OR (value = 'auto' AND (SELECT count(*) FROM teams) = 7)));
