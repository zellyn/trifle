# Trifle - Project Context for Claude

## What This Is
Local-first Python3 playground using Pyodide (WASM). All execution client-side. Optional Google OAuth for sync.

## Architecture
- **Local-first**: All data in browser IndexedDB, no account required
- **Optional sync**: OAuth only for backup/restore to file-based KV store
- **Content-addressed**: Files stored by SHA-256, deduplicated
- **Offline-capable**: Service worker caches app, works without network
- **WebAssembly required**: Editor checks and shows helpful error if unavailable

## Key Decisions
- Pure KV store: server never parses user data
- Logical clocks: conflict resolution for bidirectional sync
- Email-based auth: no user IDs, email is identity
- SameSite=Lax: for OAuth callback compatibility
- Production mode: inferred from OAUTH_REDIRECT_URL scheme (https = secure cookies)
- Reverse proxy friendly: designed for Caddy/nginx TLS termination

## Module Organization
- `internal/auth/` - OAuth, sessions (email-based)
- `internal/kv/` - File-based KV store for sync
- `web/js/` - app.js (list), db.js (IndexedDB), editor.js (Ace+Pyodide), sync-kv.js, namegen.js
- `web/sw.js` - Service worker (**bump version** when cache behavior changes)

## Service Worker
- Caches static files and CDN resources (Pyodide, Ace)
- Query params: strips them for cache matching (e.g., `/editor.html?id=xyz` → `/editor.html`)
- Never caches `/api/*` endpoints
- Version format: `v{number}` - increment when changing cache logic

## Python Features
- `input()` with terminal-style prompt
- ANSI color codes (30-37 fg, 40-47 bg, 0 reset)
- Web worker execution (non-blocking)

## KV Sync Schema
```
data/
├── user/{email}/profile                              # Profile JSON
├── user/{email}/trifle/latest/{trifle_id}/{version}  # Pointer (empty)
├── user/{email}/trifle/version/{version}             # Metadata + file refs
└── file/{hash[0:2]}/{hash[2:4]}/{hash}               # Global, content-addressed
```
- Email-based access control
- `file/*` is public (content-addressed)
- Version ID = `version_{hash[0:16]}`

## Shortcuts
- **Cmd/Ctrl+Enter**: Run code
- **Cmd/Ctrl+Enter** in modal: Submit
- **Esc** in modal: Cancel
- Auto-save after 1s idle

## Run Locally
```bash
export GOOGLE_CLIENT_ID="$(op read 'op://Shared/Trifle/Google OAuth Client ID')"
export GOOGLE_CLIENT_SECRET="$(op read 'op://Shared/Trifle/Google OAuth Client Secret')"
go run main.go  # → http://localhost:3000
```

## Workflow
Before committing: Use Task tool to launch code review agent.

---

**For Claude**: Update this file when you notice contradictions or important architectural decisions.
