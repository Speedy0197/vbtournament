ALTER TABLE matches ADD COLUMN referee_team_id INTEGER REFERENCES teams(id)
  CHECK(referee_team_id IS NULL OR (referee_team_id <> team1_id AND referee_team_id <> team2_id));
-- Unstarted placement matches now require two set wins. Preserve any saved legacy result.
UPDATE matches SET fixed_sets = 0, sets_to_win = 2, scoring_format = 'sets', timed_periods = 1,
  set_target = coalesce(json_extract((SELECT value FROM settings WHERE key = 'scoring_rules'), '$.setTarget'), 25),
  deciding_set_target = coalesce(json_extract((SELECT value FROM settings WHERE key = 'scoring_rules'), '$.decidingSetTarget'), 15),
  estimated_minutes = coalesce(json_extract((SELECT value FROM settings WHERE key = 'scoring_rules'), '$.matchMinutes'), 40)
WHERE phase = 'placement' AND status = 'pending'
  AND NOT EXISTS (SELECT 1 FROM sets WHERE sets.match_id = matches.id);
