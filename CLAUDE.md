# Trifle - Project Context for Claude

## What This Is
Local-first browser-based Python3 playground using Pyodide (WASM). All code execution happens client-side. Optional Google OAuth for syncing data to server.

## Current Status
**Completed:**
- ✅ IndexedDB storage layer (client-side)
- ✅ Service worker for offline support
- ✅ Pyodide integration with web worker execution
- ✅ Multi-file editor with auto-save
- ✅ ANSI terminal output support
- ✅ `input()` support for interactive programs
- ✅ Google OAuth authentication (optional, for sync)
- ✅ Bidirectional sync with file-based KV store
- ✅ Profile management with random name generation

**Run locally:**
```bash
export GOOGLE_CLIENT_ID="$(op read 'op://Shared/Trifle/Google OAuth Client ID')"
export GOOGLE_CLIENT_SECRET="$(op read 'op://Shared/Trifle/Google OAuth Client Secret')"
go run main.go  # → http://localhost:3000
```

**Key decisions:**
- **Local-first**: All data in browser IndexedDB, no account required
- **Optional sync**: Google OAuth only needed for backup/restore
- **Pure KV store**: Server never parses user data, just stores opaque bytes
- **Content-addressed storage**: Files stored by SHA-256 hash for deduplication
- **Logical clocks**: Conflict resolution for bidirectional sync
- **SameSite=Lax** (not Strict) for OAuth callback compatibility
- **Production detection**: Inferred from OAUTH_REDIRECT_URL scheme (https = secure cookies)
- Client-side execution = **works offline** (after initial load)
- Graceful offline handling (service worker shows "Offline" page)

## Module Organization
- `internal/auth/` - Google OAuth, sessions (email-based, no DB)
- `internal/kv/` - File-based key-value store for sync
- `web/` - Static frontend (Ace editor, Pyodide, vanilla JS)
  - `js/app.js` - Main app controller, trifle list, modals
  - `js/db.js` - IndexedDB storage layer with content addressing
  - `js/editor.js` - File tree, auto-save, Pyodide execution, `input()` support, ANSI color parsing
  - `js/sync-kv.js` - Bidirectional sync manager
  - `js/namegen.js` - Client-side random name generator
  - `sw.js` - Service worker for offline support

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

## Modal UX

New Trifle modal:
- Auto-focuses title field
- **Cmd/Ctrl+Enter** to submit
- **Esc** to cancel

## Workflow

**Before committing**: Always use Task tool to launch a code review agent to check for issues.

## KV Sync Schema

Server stores user data in flat files:
```
data/
├── user/{email}/profile                              # User profile JSON
├── user/{email}/trifle/latest/{trifle_id}/{version}  # Latest version pointer (empty file)
├── user/{email}/trifle/version/{version}             # Version metadata with file refs
└── file/{hash[0:2]}/{hash[2:4]}/{hash}               # Content-addressed files (global)
```

- Email-based access control (user can only access their own data)
- `file/*` is global (content-addressed, anyone can read/write)
- Version ID = `version_{hash[0:16]}`

---

**IMPORTANT FOR CLAUDE**: When you notice information in conversations that either:
1. Contradicts something in this file, OR
2. Seems important enough to add (architectural decisions, gotchas, invariants)

→ Start a conversation with the user about updating CLAUDE.md. Keep it high-value and succinct.
