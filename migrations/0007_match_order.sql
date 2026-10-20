-- Existing games retain their original position until explicitly swapped.
ALTER TABLE matches ADD COLUMN schedule_order INTEGER;
