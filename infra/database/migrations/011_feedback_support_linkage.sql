-- TABLE OWNER: TI
-- Migration 010: Link Feedback to Support Tickets
-- Created: 2026-03-28
-- Purpose: Add relationship between feedback and support tickets for reply functionality

-- Add feedback_id column to support_tickets
ALTER TABLE support_tickets
ADD COLUMN feedback_id UUID REFERENCES user_feedback(id) ON DELETE SET NULL;

-- CREATE INDEX IF NOT EXISTS for fast lookup
CREATE INDEX IF NOT EXISTS idx_support_tickets_feedback_id ON support_tickets(feedback_id) WHERE feedback_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN support_tickets.feedback_id IS 'Link to user_feedback entry if ticket was created from feedback reply';
