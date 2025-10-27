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
- Email allowlist: `data/allowlist.txt` controls OAuth access (exact emails + @domain wildcards)
- SameSite=Lax: for OAuth callback compatibility
- Production mode: inferred from OAUTH_REDIRECT_URL scheme (https = secure cookies)
- Reverse proxy friendly: designed for Caddy/nginx TLS termination

## Module Organization
- `internal/auth/` - OAuth, sessions (email-based)
- `internal/kv/` - File-based KV store for sync
- `web/js/` - Core modules:
  - `app.js` - Homepage trifle list
  - `db.js` - IndexedDB abstraction (content-addressable)
  - `editor.js` - Ace + Pyodide integration
  - `profile.js` - Profile page with avatar editor
  - `avatar.js` - Avatar SVG generation
  - `avatar-editor.js` - Drag-and-drop shape manipulation
  - `data.js` - Import/export functionality
  - `sync-kv.js` - Server sync logic
  - `namegen.js` - Random name generation
  - `notifications.js` - Dismissible banner notifications
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
├── domain/{domain}/user/{localpart}/profile                              # Profile JSON
├── domain/{domain}/user/{localpart}/trifle/latest/{trifle_id}/{version}  # Pointer (empty)
├── domain/{domain}/user/{localpart}/trifle/version/{version}             # Metadata + file refs
└── file/{hash[0:2]}/{hash[2:4]}/{hash}                                   # Global, content-addressed
```
- Domain-organized: `email@domain.com` → `/domain/domain.com/user/email/`
- Enables domain-level features (e.g., `/domain/myschool.edu/classes/`)
- Email-based access control (localpart@domain)
- `file/*` is public (content-addressed)
- Version ID = `version_{hash[0:16]}`
- **Migration**: Client automatically migrates old `/user/{email}/` format on first sync

## User Profile Storage
Profile stored in IndexedDB under user data blob:
```json
{
  "display_name": "Random Name",
  "avatar": {
    "shapes": [
      {"id": 1, "type": "ellipse", "x": 100, "y": 100, "rx": 25, "ry": 20, "color": "#FFD5A5", "rotation": 0},
      {"id": 2, "type": "circle", "x": 85, "y": 90, "r": 5, "color": "#2C1810", "rotation": 0}
    ],
    "bgColor": "#E8F4F8"
  },
  "settings": {...}
}
```

## Avatar Editor (`/profile.html`)
Felt-style SVG drag-and-drop editor:
- **Shape palette**: circles, ellipses, rectangles, body shapes (3 variants), facial features (eye, straight line, smile)
- **Manipulation**: drag to move, handles for resize/rotate, Option-drag to duplicate
- **Limits**: 200 shapes max, auto-delete when dragged completely off canvas (0-200 viewBox)
- **Shape IDs**: Integer-based (finds lowest unused), survives page reloads
- **Z-order**: "Send to Front/Back" controls
- **Storage**: Saved in user profile as `avatar: {shapes, bgColor}`

## Data Import/Export (`/data.html`)
Local backup and restore without OAuth:
- **Export**: Selective checklist (profile + trifles), downloads JSON with all file contents
  - Filename: `trifle-NAME.json` (single) or `trifling-backup-YYYY-MM-DD.json` (multiple)
- **Import**: Upload JSON, shows smart conflict resolution
  - Profile: Compare avatars/timestamps, recommend newer
  - Trifles: Match by ID, compare timestamps, recommend newer
  - Actions: Import/Skip (profile), Overwrite/Rename/Skip (trifles)
  - Bulk buttons: Import All, Skip All, Use Recommendations
- **Format**: JSON with `{version: 1, profile: {...}, trifles: [{...file_contents...}]}`

## Shortcuts
- **Cmd/Ctrl+Enter**: Run code
- **Cmd/Ctrl+Enter** in modal: Submit
- **Esc** in modal: Cancel
- **Delete/Backspace**: Delete selected avatar shape
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
