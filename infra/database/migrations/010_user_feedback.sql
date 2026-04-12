-- TABLE OWNER: TI
-- Migration 009: User Feedback System
-- Created: 2026-03-28
-- Purpose: Store and manage user feedback submissions from dashboard

-- Create user_feedback table
CREATE TABLE IF NOT EXISTS user_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  topic VARCHAR(100) NOT NULL,
  feedback_text TEXT NOT NULL,
  sentiment VARCHAR(20), -- angry, sad, neutral, happy, love
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_read BOOLEAN DEFAULT FALSE,
  admin_notes TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_user_feedback_topic ON user_feedback(topic);
CREATE INDEX IF NOT EXISTS idx_user_feedback_sentiment ON user_feedback(sentiment);
CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_is_read ON user_feedback(is_read) WHERE is_read = FALSE;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_feedback_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_feedback_timestamp
  BEFORE UPDATE ON user_feedback
  FOR EACH ROW
  EXECUTE FUNCTION update_user_feedback_timestamp();

-- Create view for feedback with user info
CREATE OR REPLACE VIEW user_feedback_with_details AS
SELECT 
  uf.id,
  uf.user_id,
  up.email AS user_email,
  up.username AS user_username,
  up.professional_name AS user_professional_name,
  up.role AS user_role,
  uf.topic,
  uf.feedback_text,
  uf.sentiment,
  uf.created_at,
  uf.updated_at,
  uf.is_read,
  uf.admin_notes
FROM user_feedback uf
JOIN user_profiles up ON uf.user_id = up.id;

-- Add comments for documentation
COMMENT ON TABLE user_feedback IS 'User feedback submissions from the dashboard';
COMMENT ON COLUMN user_feedback.sentiment IS 'User sentiment: angry, sad, neutral, happy, love';
COMMENT ON COLUMN user_feedback.is_read IS 'Flag indicating if admin has reviewed the feedback';
COMMENT ON VIEW user_feedback_with_details IS 'User feedback with associated user profile information';
