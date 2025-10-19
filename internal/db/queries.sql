-- name: GetLogin :one
SELECT * FROM logins
WHERE id = ? LIMIT 1;

-- name: GetLoginByGoogleID :one
SELECT * FROM logins
WHERE google_id = ? LIMIT 1;

-- name: GetLoginByEmail :one
SELECT * FROM logins
WHERE email = ? LIMIT 1;

-- name: CreateLogin :exec
INSERT INTO logins (id, google_id, email, name)
VALUES (?, ?, ?, ?);

-- name: UpdateLogin :exec
UPDATE logins
SET email = ?, name = ?
WHERE id = ?;

-- name: GetAccount :one
SELECT * FROM accounts
WHERE id = ? LIMIT 1;

-- name: GetAccountByDisplayName :one
SELECT * FROM accounts
WHERE display_name = ? LIMIT 1;

-- name: CreateAccount :exec
INSERT INTO accounts (id, display_name)
VALUES (?, ?);

-- name: UpdateAccountDisplayName :exec
UPDATE accounts
SET display_name = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: GetAccountMember :one
SELECT * FROM account_members
WHERE id = ? LIMIT 1;

-- name: GetAccountMembersByAccountID :many
SELECT * FROM account_members
WHERE account_id = ?;

-- name: GetAccountMembersByLoginID :many
SELECT * FROM account_members
WHERE login_id = ?;

-- name: GetAccountMemberByAccountAndLogin :one
SELECT * FROM account_members
WHERE account_id = ? AND login_id = ?
LIMIT 1;

-- name: CreateAccountMember :exec
INSERT INTO account_members (id, account_id, login_id, role)
VALUES (?, ?, ?, ?);

-- name: DeleteAccountMember :exec
DELETE FROM account_members
WHERE id = ?;

-- name: GetTrifle :one
SELECT * FROM trifles
WHERE id = ? LIMIT 1;

-- name: ListTriflesByAccountID :many
SELECT * FROM trifles
WHERE account_id = ?
ORDER BY updated_at DESC;

-- name: CreateTrifle :exec
INSERT INTO trifles (id, account_id, title, description, parent_id)
VALUES (?, ?, ?, ?, ?);

-- name: UpdateTrifle :exec
UPDATE trifles
SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: DeleteTrifle :exec
DELETE FROM trifles
WHERE id = ?;

-- name: GetTrifleFile :one
SELECT * FROM trifle_files
WHERE id = ? LIMIT 1;

-- name: GetTrifleFileByPath :one
SELECT * FROM trifle_files
WHERE trifle_id = ? AND path = ?
LIMIT 1;

-- name: ListTrifleFilesByTrifleID :many
SELECT * FROM trifle_files
WHERE trifle_id = ?
ORDER BY path;

-- name: CreateTrifleFile :exec
INSERT INTO trifle_files (id, trifle_id, path, content)
VALUES (?, ?, ?, ?);

-- name: UpdateTrifleFile :exec
UPDATE trifle_files
SET content = ?, updated_at = CURRENT_TIMESTAMP
WHERE id = ?;

-- name: UpdateTrifleFileByPath :exec
UPDATE trifle_files
SET content = ?, updated_at = CURRENT_TIMESTAMP
WHERE trifle_id = ? AND path = ?;

-- name: DeleteTrifleFile :exec
DELETE FROM trifle_files
WHERE id = ?;

-- name: DeleteTrifleFileByPath :exec
DELETE FROM trifle_files
WHERE trifle_id = ? AND path = ?;

-- name: CheckEmailAllowlist :one
SELECT COUNT(*) as count FROM email_allowlist
WHERE (type = 'email' AND pattern = ?)
   OR (type = 'domain' AND ? LIKE '%' || pattern);

-- name: ListAllowlistEntries :many
SELECT * FROM email_allowlist
ORDER BY type, pattern;

-- name: AddAllowlistEntry :exec
INSERT INTO email_allowlist (pattern, type)
VALUES (?, ?);

-- name: DeleteAllowlistEntry :exec
DELETE FROM email_allowlist
WHERE id = ?;

-- Sessions
-- name: GetSession :one
SELECT * FROM sessions
WHERE id = ? LIMIT 1;

-- name: CreateSession :exec
INSERT INTO sessions (id, login_id, account_id, email, authenticated, oauth_state, return_url, created_at, last_accessed, expires_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);

-- name: UpdateSession :exec
UPDATE sessions
SET login_id = ?, account_id = ?, email = ?, authenticated = ?, oauth_state = ?, return_url = ?, last_accessed = ?
WHERE id = ?;

-- name: DeleteSession :exec
DELETE FROM sessions
WHERE id = ?;

-- name: DeleteExpiredSessions :exec
DELETE FROM sessions
WHERE expires_at < CURRENT_TIMESTAMP;

-- name: UpdateSessionLastAccessed :exec
UPDATE sessions
SET last_accessed = ?
WHERE id = ?;
