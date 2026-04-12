-- TABLE OWNER: TI
-- Migration: Enable extensions required by TI database
-- Date: 2026-04-11
-- Description: Create uuid-ossp and pgcrypto extensions for TI database

-- Enable required extensions (idempotent - safe to run even if already exists)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Shared trigger function for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
	NEW.updated_at = NOW();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
