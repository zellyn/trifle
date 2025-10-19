-- +goose Up
-- +goose StatementBegin

-- Logins table: represents Google OAuth identities
CREATE TABLE logins (
    id TEXT PRIMARY KEY,
    google_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_logins_google_id ON logins(google_id);
CREATE INDEX idx_logins_email ON logins(email);

-- Accounts table: entities that own Trifles
CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    display_name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_accounts_display_name ON accounts(display_name);

-- Account members: links logins to accounts
CREATE TABLE account_members (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    login_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (login_id) REFERENCES logins(id) ON DELETE CASCADE,
    UNIQUE(account_id, login_id)
);

CREATE INDEX idx_account_members_account_id ON account_members(account_id);
CREATE INDEX idx_account_members_login_id ON account_members(login_id);

-- Trifles table: individual Python projects/programs
CREATE TABLE trifles (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    parent_id TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES trifles(id) ON DELETE SET NULL
);

CREATE INDEX idx_trifles_account_id ON trifles(account_id);
CREATE INDEX idx_trifles_parent_id ON trifles(parent_id);

-- Trifle files: files within a Trifle
CREATE TABLE trifle_files (
    id TEXT PRIMARY KEY,
    trifle_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (trifle_id) REFERENCES trifles(id) ON DELETE CASCADE,
    UNIQUE(trifle_id, path)
);

CREATE INDEX idx_trifle_files_trifle_id ON trifle_files(trifle_id);

-- Email allowlist: controls who can log in
CREATE TABLE email_allowlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('email', 'domain')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pattern, type)
);

CREATE INDEX idx_email_allowlist_pattern ON email_allowlist(pattern);

-- Insert initial allowlist entries
INSERT INTO email_allowlist (pattern, type) VALUES
    ('zellyn@gmail.com', 'email'),
    ('@misstudent.com', 'domain');

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS trifle_files;
DROP TABLE IF EXISTS trifles;
DROP TABLE IF EXISTS account_members;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS logins;
DROP TABLE IF EXISTS email_allowlist;

-- +goose StatementEnd
