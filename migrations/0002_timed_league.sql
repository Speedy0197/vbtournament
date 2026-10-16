ALTER TABLE matches ADD COLUMN scoring_format TEXT NOT NULL DEFAULT 'sets' CHECK(scoring_format IN ('sets', 'timed'));
