# Trifle - Project Context for Claude

## What This Is
Browser-based Python3 playground using Pyodide (WASM). All code execution happens client-side in the browser. Google OAuth with email allowlist controls access.

## Current Status
**Completed:** Phase 1 (Foundation) + Phase 2 (Authentication)
- Database, migrations, ID generation, name generator
- Google OAuth flow, allowlist, sessions, auto-account creation
- Signup/home pages with secure sessions

**Next:** Phase 3 - Backend API (Trifle CRUD, file operations)

**Run locally:**
```bash
export GOOGLE_CLIENT_ID="957488163855-57odpu7dd2e9f9m44teermhuti95s43r.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="$(op read 'op://Shared/Trifle/Google OAuth Client Secret')"
go run main.go  # → http://localhost:3000
```

**Key decisions:** Session cleanup on login (not background goroutine), context cancellation in DB, SameSite=Strict, Trifle IDs=16 hex chars

## Module Organization
- `internal/db/` - SQLite schema, sqlc queries, single-goroutine manager pattern, ID generation
- `internal/auth/` - Google OAuth, sessions, allowlist checking
- `internal/api/` - HTTP handlers, endpoints, middleware (auth, CSRF)
- `internal/namegen/` - Adjective-noun account name generator
- `web/` - Static frontend (Ace editor, Pyodide, vanilla JS)

## Critical: SQLite Dependency
`modernc.org/sqlite` and `modernc.org/libc` versions **must match exactly** (see go.mod comment). Test enforces this: `go test ./internal/db`. Never upgrade one without the other.

---

**IMPORTANT FOR CLAUDE**: When you notice information in conversations that either:
1. Contradicts something in this file, OR
2. Seems important enough to add (architectural decisions, gotchas, invariants)

→ Start a conversation with the user about updating CLAUDE.md. Keep it high-value and succinct.
