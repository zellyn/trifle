-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    login_id TEXT,
    account_id TEXT,
    email TEXT,
    authenticated BOOLEAN NOT NULL DEFAULT 0,
    oauth_state TEXT,
    return_url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (login_id) REFERENCES logins(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_account_id ON sessions(account_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sessions_account_id;
DROP INDEX IF EXISTS idx_sessions_expires_at;
DROP TABLE IF EXISTS sessions;
-- +goose StatementEnd
