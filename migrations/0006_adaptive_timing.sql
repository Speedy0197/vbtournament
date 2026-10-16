-- Preserve existing results without inventing historical finish times.
ALTER TABLE matches ADD COLUMN completed_at TEXT;
