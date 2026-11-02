ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1 CHECK (must_change_password IN (0, 1));
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;
