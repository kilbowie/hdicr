-- TABLE OWNER: HDICR
-- Add structured multi-location support to actors.
-- Stores up to 3 location entries as JSONB, each with shape:
--   { "city": string, "region": string, "country": string, "label": string, "isPrimary": bool }
-- The legacy `location` VARCHAR column is kept for backward compatibility;
-- the API layer syncs it from the primary entry in `locations`.

ALTER TABLE actors
  ADD COLUMN IF NOT EXISTS locations JSONB DEFAULT '[]'::jsonb;

-- Backfill: migrate existing single location string into locations[0] as primary
UPDATE actors
SET locations = jsonb_build_array(
  jsonb_build_object(
    'label', location,
    'isPrimary', true
  )
)
WHERE location IS NOT NULL
  AND (locations IS NULL OR locations = '[]'::jsonb)
  AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_actors_locations ON actors USING GIN (locations);
