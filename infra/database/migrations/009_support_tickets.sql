-- TABLE OWNER: TI
-- Migration 008: Support Ticket System
-- Created: 2026-03-26
-- Purpose: In-app support ticket system with user-admin communication

-- Create tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number SERIAL UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  subject VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_on_user', 'resolved', 'closed')),
  priority VARCHAR(50) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  assigned_to UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP WITH TIME ZONE,
  closed_at TIMESTAMP WITH TIME ZONE
);

-- Create ticket messages table for threaded conversations
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_internal_note BOOLEAN DEFAULT FALSE, -- For admin-only notes
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status) WHERE status NOT IN ('resolved', 'closed');
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_to ON support_tickets(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_number ON support_tickets(ticket_number);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON support_ticket_messages(ticket_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_user_id ON support_ticket_messages(user_id);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_support_ticket_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_support_ticket_timestamp
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_support_ticket_timestamp();

CREATE TRIGGER update_support_ticket_message_timestamp
  BEFORE UPDATE ON support_ticket_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_support_ticket_timestamp();

-- Create view for ticket list with user info
CREATE OR REPLACE VIEW support_tickets_with_user AS
SELECT 
  st.id,
  st.ticket_number,
  st.user_id,
  up.email AS user_email,
  up.username AS user_username,
  st.subject,
  st.status,
  st.priority,
  st.assigned_to,
  admin.email AS assigned_to_email,
  admin.username AS assigned_to_username,
  st.created_at,
  st.updated_at,
  st.resolved_at,
  st.closed_at,
  (SELECT COUNT(*) FROM support_ticket_messages WHERE ticket_id = st.id AND is_internal_note = FALSE) AS message_count,
  (SELECT MAX(created_at) FROM support_ticket_messages WHERE ticket_id = st.id) AS last_message_at
FROM support_tickets st
JOIN user_profiles up ON st.user_id = up.id
LEFT JOIN user_profiles admin ON st.assigned_to = admin.id;

-- Grant permissions (adjust based on your role setup)
-- GRANT SELECT, INSERT, UPDATE ON support_tickets TO trimg_app_user;
-- GRANT SELECT, INSERT, UPDATE ON support_ticket_messages TO trimg_app_user;
-- GRANT SELECT ON support_tickets_with_user TO trimg_app_user;

-- Add comments for documentation
COMMENT ON TABLE support_tickets IS 'User support tickets for in-app help system';
COMMENT ON TABLE support_ticket_messages IS 'Threaded messages within support tickets';
COMMENT ON COLUMN support_ticket_messages.is_internal_note IS 'True if message is admin-only note (not visible to user)';
COMMENT ON VIEW support_tickets_with_user IS 'Support tickets with user and admin information';
