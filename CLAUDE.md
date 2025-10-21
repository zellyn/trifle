# Trifle - Project Context for Claude

## What This Is
Browser-based Python3 playground using Pyodide (WASM). All code execution happens client-side in the browser. Google OAuth with email allowlist controls access.

## Current Status
**Completed:** Phases 1-3 (Foundation, Auth, Backend API)
- Database, migrations, ID generation, name generator
- Google OAuth flow, allowlist, sessions, auto-account creation
- Full REST API for trifles and files (CRUD, batch updates)
- Account name suggestion & validation system
- HTML templates (signup, home with trifle list, editor structure)

**In Progress:** Phases 4-6 - Frontend (editor JS, Pyodide integration)

**Run locally:**
```bash
export GOOGLE_CLIENT_ID="$(op read 'op://Shared/Trifle/Google OAuth Client ID')"
export GOOGLE_CLIENT_SECRET="$(op read 'op://Shared/Trifle/Google OAuth Client Secret')"
go run main.go  # → http://localhost:3000
```

**Key decisions:**
- Session cleanup on login (not background goroutine)
- Context cancellation in DB
- **SameSite=Lax** (not Strict) for OAuth callback compatibility
- Trifle IDs=16 hex chars
- Templates loaded from embedded FS (not inline)
- Client-side execution = **works offline** (after initial load)
- Graceful offline handling (shows "Offline" instead of error popups)

## Module Organization
- `internal/db/` - SQLite schema, sqlc queries, single-goroutine manager pattern, ID generation
- `internal/auth/` - Google OAuth, sessions, allowlist checking
- `internal/api/` - HTTP handlers, endpoints, middleware (auth, CSRF)
- `internal/namegen/` - Adjective-noun account name generator
- `web/` - Static frontend (Ace editor, Pyodide, vanilla JS)
  - `editor.js` - File tree, auto-save, Pyodide execution, `input()` support, ANSI color parsing

## Python Features

**`input()` Support**: Terminal-style input directly in the console (like real Python REPL)
- Type appears in the console as you enter it
- Press Enter to submit
- Works for classroom scenarios (guess-the-number, interactive programs, etc.)
```python
name = input("What's your name? ")
print(f"Hello, {name}!")
```

**ANSI Color Codes**: Full support for terminal colors and backgrounds
```python
print('\x1b[31mRed text\x1b[0m')
print('\x1b[32;40mGreen on black\x1b[0m')
```

Supported codes: 30-37 (foreground), 40-47 (background), 49 (bg default), 0 (reset)

## Editor Shortcuts

- **Cmd+Enter** (Mac) / **Ctrl+Enter** (Windows/Linux) - Run code
- Auto-save after 1 second of typing inactivity

## Workflow

**Before committing**: Always use Task tool to launch a code review agent to check for issues.

## Critical: SQLite Dependency
`modernc.org/sqlite` and `modernc.org/libc` versions **must match exactly** (see go.mod comment). Test enforces this: `go test ./internal/db`. Never upgrade one without the other.

---

**IMPORTANT FOR CLAUDE**: When you notice information in conversations that either:
1. Contradicts something in this file, OR
2. Seems important enough to add (architectural decisions, gotchas, invariants)

→ Start a conversation with the user about updating CLAUDE.md. Keep it high-value and succinct.
