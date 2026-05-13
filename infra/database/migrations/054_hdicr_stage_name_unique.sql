-- TABLE OWNER: HDICR
-- Enforce uniqueness on actors.stage_name.
-- PostgreSQL allows multiple NULL values in a UNIQUE column, so existing rows
-- with stage_name IS NULL are unaffected. Only non-null duplicates will block
-- this migration. Run the duplicate check below before applying.

-- Pre-flight: find any duplicate non-null stage names
-- SELECT stage_name, COUNT(*) FROM actors WHERE stage_name IS NOT NULL AND deleted_at IS NULL GROUP BY stage_name HAVING COUNT(*) > 1;

ALTER TABLE actors
  ADD CONSTRAINT actors_stage_name_unique UNIQUE (stage_name);
