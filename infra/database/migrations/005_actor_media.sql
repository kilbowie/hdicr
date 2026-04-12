-- TABLE OWNER: TI
-- Migration: Add actor_media table for headshots, audio, and video reels
-- Date: 2026-03-25
-- Description: Stores uploaded media (headshots, audio reels, video reels) with S3 URLs

CREATE TABLE IF NOT EXISTS actor_media (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Actor reference
  actor_id UUID NOT NULL,
  
  -- Media details
  media_type VARCHAR(50) NOT NULL CHECK (media_type IN ('headshot', 'audio_reel', 'video_reel')),
  file_name VARCHAR(255) NOT NULL,
  s3_key VARCHAR(500) NOT NULL, -- Full S3 object key: actors/{actor_id}/headshots/{filename}
  s3_url VARCHAR(1000) NOT NULL, -- Full URL to access the file
  file_size_bytes INTEGER NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  
  -- Media metadata
  title VARCHAR(255), -- User-defined title for the media
  photo_credit VARCHAR(255), -- Photographer credit for headshots
  description TEXT, -- Optional description
  
  -- Display settings
  is_primary BOOLEAN DEFAULT FALSE, -- Primary headshot
  display_order INTEGER DEFAULT 0, -- Order for display (0=primary, 1=secondary, 2=tertiary1, 3=tertiary2)
  
  -- Timestamps
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE, -- Soft delete
  
  -- Constraints
  CONSTRAINT valid_display_order CHECK (display_order >= 0 AND display_order <= 3)
);

-- Partial unique index for primary media (only one primary per type per actor when not deleted)
CREATE UNIQUE INDEX IF NOT EXISTS idx_actor_media_unique_primary 
ON actor_media(actor_id, media_type, is_primary) 
WHERE is_primary = TRUE AND deleted_at IS NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_actor_media_actor_id ON actor_media(actor_id);
CREATE INDEX IF NOT EXISTS idx_actor_media_type ON actor_media(media_type);
CREATE INDEX IF NOT EXISTS idx_actor_media_primary ON actor_media(actor_id, is_primary) WHERE is_primary = TRUE;
CREATE INDEX IF NOT EXISTS idx_actor_media_display_order ON actor_media(actor_id, display_order);
CREATE INDEX IF NOT EXISTS idx_actor_media_uploaded_at ON actor_media(uploaded_at DESC);

-- Auto-update timestamp trigger
CREATE TRIGGER update_actor_media_updated_at 
BEFORE UPDATE ON actor_media
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE actor_media IS 'Stores actor media files (headshots, audio reels, video reels) with S3 references';
COMMENT ON COLUMN actor_media.s3_key IS 'S3 object key (e.g., actors/uuid/headshots/filename.jpg)';
COMMENT ON COLUMN actor_media.display_order IS '0=primary, 1=secondary, 2=tertiary1, 3=tertiary2';
COMMENT ON COLUMN actor_media.photo_credit IS 'Photographer name/credit for headshot attribution';
