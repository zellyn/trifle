# Trifle - Local-First Python3 Playground

A local-first web application for creating, editing, and running Python3 programs entirely in the browser using Pyodide (WebAssembly Python). Works offline, syncs when online.

## Project Overview

**Name**: Trifle (individual programs are called "Trifles")

**Core Principles**:
- **Local-first**: All data stored in browser IndexedDB, works 100% offline
- **Content-addressable**: Git-style immutable content storage
- **Optional sync**: Sign in with Google only when you want to sync/share
- **Simple**: No CRDTs, honest conflict resolution ("you decide")

**Architecture**:
```
┌─────────────────────────────────────┐
│  Browser (Primary Data Store)       │
│  ┌────────────────────────────────┐ │
│  │ IndexedDB                      │ │
│  │  - trifles: {id, hash, ...}   │ │
│  │  - users: {id, email, hash}   │ │
│  │  - content: {hash → blob}     │ │
│  └────────────────────────────────┘ │
│         ↕ (optional sync)            │
│  ┌────────────────────────────────┐ │
│  │ Pyodide (Python3 runtime)     │ │
│  └────────────────────────────────┘ │
└─────────────────────────────────────┘
         ↕ (optional)
┌─────────────────────────────────────┐
│  Server (Sync Target, Flat Files)   │
│  data/                               │
│    content/{hash}  ← immutable blobs│
│    users/{id}.json ← pointers       │
│    trifles/{id}.json ← pointers     │
└─────────────────────────────────────┘
```

## Tech Stack

- **Backend**: Go 1.25+ (simple sync server, no database)
- **Frontend**: Vanilla JavaScript
- **Editor**: Ace Editor (from CDN)
- **Python Runtime**: Pyodide (WebAssembly, from CDN)
- **Client Storage**: IndexedDB (primary data store)
- **Server Storage**: Flat files (content-addressable)
- **Authentication**: Google OAuth 2.0 (optional, only for sync)
- **Deployment**: Single Go binary, flat file storage

## Content-Addressable Data Model

Everything is immutable content addressed by SHA-256 hash:

### Client-side (IndexedDB)

```javascript
// Object stores
"users": {
  id: "user_abc123",           // Random ID
  email: "user@example.com",   // null if not logged in
  current_hash: "sha256...",   // Pointer to user data blob
  last_modified: timestamp,
  logical_clock: 15            // Monotonic counter
}

"trifles": {
  id: "trifle_xyz789",         // Random ID
  owner_id: "user_abc123",     // User who owns this
  current_hash: "sha256...",   // Pointer to trifle data blob
  last_modified: timestamp,
  logical_clock: 42
}

"content": {
  hash: "sha256...",           // SHA-256 of content
  data: <blob>,                // The actual content (JSON or bytes)
  type: "trifle"|"user"|"file" // Content type
}

"versions": {
  trifle_id: "trifle_xyz789",
  hash: "sha256...",
  timestamp: timestamp,
  label: "session" | "checkpoint" // Type of version
}
```

### User Data Blob (at hash)
```json
{
  "display_name": "Curious Coder",
  "avatar": {
    "head": "round",
    "eyes": "happy",
    "hair": "curly"
  },
  "settings": {
    "auto_sync": false,
    "theme": "dark",
    "auto_save_interval": 60
  }
}
```

### Trifle Data Blob (at hash)
```json
{
  "name": "My First Program",
  "description": "Learning Python!",
  "files": [
    {"path": "main.py", "hash": "sha256..."},
    {"path": "utils.py", "hash": "sha256..."}
  ]
}
```

### File Content Blob (at hash)
```
print("Hello, world!")
```

### Server-side (Flat Files)

```
data/
  content/
    ab/
      cd/
        abcdef123456...  # Content blobs (SHA-256 hash)
  users/
    user_abc123.json   # {email, current_hash, updated_at, logical_clock}
  trifles/
    trifle_xyz789.json # {id, owner_id, current_hash, updated_at, logical_clock}
```

**Why flat files?**
- Simple: No database to configure/migrate
- Debuggable: Just look at files on disk
- Scalable enough: 10K users × 10 trifles × 10 files = ~1M blobs
  - With 2-level directory nesting: ~15 files per directory
- Immutable content: Perfect for filesystem caching
- Easy backup: Just tar the data/ directory

## Versioning Strategy

**Auto-save to IndexedDB**: Every 1 second after typing stops (never lose work)

**Version snapshots** (in "versions" store):
1. **Session versions**: Created on "Save/Sync" click (or auto-sync trigger)
   - If last version < 30 minutes ago: Overwrite it (same session)
   - If last version > 30 minutes ago: Create new version (new session)
   - Keep last 10 session versions

2. **Future**: Intermediate checkpoints every 5 minutes between sessions
   - GC'd after 2 new sessions created
   - (Implement only if users need "undo 20 minutes ago")

## Profile Merge on Login

**Scenario**: User creates trifles anonymously, then signs in with Google

1. User works locally with `user_local123` (no email)
2. User clicks "Sign in to sync"
3. Server finds existing user with that email → `user_server456`
4. **Merge strategy**:
   - Server's user profile wins (it's the canonical identity)
   - EXCEPT: If local has designed avatar and server doesn't, port it over
   - All local trifles get `owner_id` updated to `user_server456`
   - Upload local trifles to server
   - Delete local user, keep server user

## Sync Protocol

### Initial Sync (Download from Server)

```
GET /api/sync/state
→ {
    user: {id, email, hash, updated_at, logical_clock},
    trifles: [
      {id, owner_id, hash, updated_at, logical_clock},
      ...
    ]
  }

POST /api/sync/download
  {hashes: ["sha256...", "sha256..."]}
→ {
    content: {
      "sha256...": <blob>,
      "sha256...": <blob>
    }
  }
```

### Upload Changes to Server

```
POST /api/sync/upload
  {
    content: {
      "sha256...": <blob>,
      "sha256...": <blob>
    }
  }
→ {uploaded: ["sha256...", ...]}

PUT /api/sync/trifle/:id
  {
    current_hash: "sha256...",
    last_known_hash: "sha256...",  // For conflict detection
    updated_at: timestamp,
    logical_clock: 43
  }
→ 200 OK {synced: true}
→ 409 Conflict {server_hash: "sha256...", conflict: true}
```

### Conflict Resolution

**Detection**: Client sends `last_known_hash`, server compares to `current_hash`

**If conflict**:
1. Server returns 409 with server's current hash
2. Client downloads server version
3. Client shows modal:
   ```
   Conflict: This trifle was edited on another device

   Your version (modified 5 minutes ago):
   - main.py (changed)
   - utils.py (unchanged)

   Server version (modified 3 minutes ago):
   - main.py (changed)
   - helper.py (new file)

   [Keep Mine] [Keep Server's] [View Diff]
   ```
4. User chooses resolution
5. Winning version becomes new `current_hash`

## API Endpoints

### Anonymous (No Auth Required)
- `GET /` - Serve frontend (works offline after first load)

### Sync (Google OAuth Required)
- `GET /auth/login` - Redirect to Google OAuth
- `GET /auth/callback` - OAuth callback, create/merge user
- `POST /auth/logout` - Clear session

- `GET /api/sync/state` - Get user + trifles metadata
- `POST /api/sync/download` - Download content blobs by hash
- `POST /api/sync/upload` - Upload content blobs
- `PUT /api/sync/user` - Update user pointer (profile changes)
- `PUT /api/sync/trifle/:id` - Update trifle pointer (with conflict detection)
- `DELETE /api/sync/trifle/:id` - Delete trifle from server

### Future: Sharing
- `GET /t/:id` - Public view of trifle (read-only)
- `POST /api/trifles/:id/fork` - Clone someone else's trifle

## Implementation Phases

### Phase 1: Local-Only (No Server, No Auth)

**Goal**: Fully functional offline Python playground

**Client (IndexedDB + Pyodide)**:
1. Set up IndexedDB schema (users, trifles, content, versions)
2. Create anonymous user on first visit with random display name
3. Generate name from adjective-noun list (allow re-roll)
4. Create/edit/delete trifles (all stored locally)
5. Content-addressable storage (SHA-256 hashing)
6. Integrate Ace Editor
7. Integrate Pyodide for Python execution
8. File tree UI for multi-file trifles
9. Auto-save to IndexedDB (1 second debounce)
10. Version snapshots (session-based, keep 10)
11. Manual "Save" button (creates version snapshot)

**At this point**: Fully functional local app, no server needed!

**Deliverable**: Visit `pytrifle.org`, instantly start coding Python

### Phase 2: Server + Sync

**Goal**: Optional cloud backup/sync

**Server (Go + Flat Files)**:
1. Flat file storage structure (`data/content/`, `data/users/`, `data/trifles/`)
2. Content upload endpoint (dedupe by hash)
3. Content download endpoint (batch fetch)
4. User/Trifle pointer update endpoints
5. Google OAuth flow (only for sync)
6. Profile merge logic (local → server on first login)

**Client**:
1. "Sign in to sync" button
2. Sync UI (manual "Sync Now" button)
3. Upload local trifles to server
4. Download server trifles to local
5. Show sync status (synced/unsynced indicator)

**Deliverable**: Users can sync across devices

### Phase 3: Conflict Resolution

**Goal**: Handle multi-device editing gracefully

**Server**:
1. Logical clock comparison for conflict detection
2. Return 409 Conflict with server state

**Client**:
1. Detect conflicts (last_known_hash ≠ server hash)
2. Download both versions
3. Show conflict resolution UI:
   - File-by-file diff view
   - "Keep mine" / "Keep server's" / "Pick per file"
4. Resolve and re-upload

**Deliverable**: Safe multi-device editing

### Phase 4: Polish

**Features**:
1. Avatar designer (pick head/eyes/hair/etc)
2. Settings UI (auto-sync on/off, theme, etc)
3. Trifle list with search/sort
4. Version history browser ("rewind to yesterday")
5. Public sharing (read-only links)
6. Fork/remix trifles
7. Canvas graphics output (turtle-style drawing)

## Security Considerations

1. **Local-first = User owns data**: No server can lock them out
2. **Content hashing**: Ensures integrity, detects corruption
3. **OAuth only for sync**: Can use app 100% anonymously
4. **No server-side Python**: All execution in browser sandbox
5. **CSRF protection**: Still needed for sync endpoints
6. **Path traversal**: Sanitize file paths in trifles
7. **Hash collisions**: SHA-256 is collision-resistant enough

## Migration from Current Version

**No migration needed** - Fresh start!
- Existing data is local only (on your laptop)
- You saved important trifles to text files
- Phase 1 starts with clean slate

## Open Questions

1. **Auto-sync default**: OFF for now, can enable later?
2. **Storage limits**: 50MB per user? (IndexedDB quota)
3. **Allowlist**: Still restrict who can create server accounts?
4. **Display name uniqueness**: Enforce globally or per-email?
5. **Public trifles**: Allow anonymous users to publish read-only?

## Notes

- Ace Editor: https://ace.c9.io/
- Pyodide: https://pyodide.org/
- IndexedDB API: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- SHA-256 in browser: `crypto.subtle.digest()`
- Local-first principles: https://www.inkandswitch.com/local-first/
- Keep it simple: Honest conflict resolution beats clever CRDTs
