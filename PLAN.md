# Trifle - Browser-based Python3 Playground

A web application for creating, editing, and running Python3 programs entirely in the browser using Pyodide (WebAssembly Python).

## Project Overview

**Name**: Trifle (individual programs are called "Trifles")

**Core Concept**:
- Python3 playground running entirely in browser via Pyodide
- Open-source editor (Ace)
- Restricted to allowlisted users (Google OAuth)
- Multiple files per project with folder support
- All code execution happens client-side (no server-side Python)

## Tech Stack

- **Backend**: Go 1.25+
- **Frontend**: Vanilla JavaScript (consider htmx if it fits)
- **Editor**: Ace Editor (from CDN)
- **Python Runtime**: Pyodide (WebAssembly, from CDN)
- **Database**: SQLite via `database/sql` + driver (generic SQL, DB-agnostic where possible)
- **SQL Code Generation**: [sqlc](https://sqlc.dev/) - all SQL in one package, type-safe generated Go code
- **Database Migrations**: [goose](https://github.com/pressly/goose) - embedded migrations, simple and reliable
- **Authentication**: Google OAuth 2.0
- **CSRF Protection**: Go 1.25's built-in CSRF middleware ([reference](https://www.alexedwards.net/blog/preventing-csrf-in-go))
- **Deployment**: Single Go binary with embedded static files, behind Caddy reverse proxy
- **Production URL**: https://trifle.greenseptember.com (Caddy terminates TLS)

## Secrets Configuration

All secrets stored in 1Password under "Shared/Trifle":

1. **Google OAuth Client Secret**: `op read "op://Shared/Trifle/Google OAuth Client Secret"`
2. **3DES ID Encryption Key**: `op read "op://Shared/Trifle/3DES ID Key"` (48 hex chars = 24 bytes)

## Google OAuth Configuration

- **Client ID**: `957488163855-57odpu7dd2e9f9m44teermhuti95s43r.apps.googleusercontent.com`
- **Development**:
  - Authorized Origins: `http://localhost:3000`
  - Redirect URI: `http://localhost:3000/auth/callback`
- **Production** (will need to add to Google Console):
  - Authorized Origins: `https://trifle.greenseptember.com`
  - Redirect URI: `https://trifle.greenseptember.com/auth/callback`

## Data Model

### ID Format Convention

All exposed IDs use **Stripe/GitHub-style prefixed random hex strings**:

**Approach**: Generate random hex IDs on creation
- Generate cryptographically random hex digits
- Prefix with entity type for type safety and debugging
- Store full prefixed ID as TEXT PRIMARY KEY in database
- Retry on collision (extremely rare with sufficient length)

**Format**: `{prefix}_{random_hex}`
- `trifle_{8_hex}` - Trifle IDs (e.g., `trifle_a3f9c2b8`) - short for nice URLs
- `account_{12_hex}` - Account IDs (e.g., `account_7b2e8f3a9c1d`)
- `login_{12_hex}` - Login IDs (e.g., `login_f8a3c2b9e1d4`)
- `file_{12_hex}` - File IDs (e.g., `file_d4a9b7c3e8f2`)

**Benefits**:
- Prevents German Tank Problem (random reveals no count info)
- Type-safe IDs in logs and debugging
- Flexible lengths per entity type
- Simple implementation (no crypto needed)
- Can change approach later if needed

### Tables

#### `logins`
Represents Google OAuth identities
- `id` - TEXT PRIMARY KEY (e.g., `login_f8a3c2b9e1d4`)
- `google_id` - TEXT UNIQUE - Google user ID
- `email` - TEXT - User's email address
- `name` - TEXT - Display name from Google
- `created_at` - TIMESTAMP

#### `accounts`
Represents entities that own Trifles (separated from logins for future multi-user support)
- `id` - TEXT PRIMARY KEY (e.g., `account_7b2e8f3a9c1d`)
- `display_name` - TEXT UNIQUE - Auto-generated adjective-noun name (e.g., "purple-dinosaur")
- `created_at` - TIMESTAMP
- `updated_at` - TIMESTAMP

#### `account_members`
Links logins to accounts (one-to-one in V1, but designed for future multi-user)
- `id` - TEXT PRIMARY KEY
- `account_id` - TEXT - Foreign key to accounts
- `login_id` - TEXT - Foreign key to logins
- `role` - TEXT - Role string (e.g., "owner", "editor") - just "owner" for V1
- `created_at` - TIMESTAMP
- UNIQUE constraint on (account_id, login_id)

#### `trifles`
Individual Python projects/programs
- `id` - TEXT PRIMARY KEY (e.g., `trifle_a3f9c2b8`)
- `account_id` - TEXT - Foreign key to accounts
- `title` - TEXT - User-provided title
- `description` - TEXT - Optional description (nullable)
- `parent_id` - TEXT - Foreign key to trifles (for future cloning/remixing, nullable)
- `created_at` - TIMESTAMP
- `updated_at` - TIMESTAMP

#### `trifle_files`
Files within a Trifle (supports folders via path)
- `id` - TEXT PRIMARY KEY (e.g., `file_d4a9b7c3e8f2`)
- `trifle_id` - TEXT - Foreign key to trifles
- `path` - TEXT - File path within project (e.g., "main.py", "utils/helper.py")
- `content` - TEXT - File contents
- `created_at` - TIMESTAMP
- `updated_at` - TIMESTAMP
- UNIQUE constraint on (trifle_id, path)

#### `email_allowlist`
Controls who can log in
- `id` - INTEGER PRIMARY KEY AUTOINCREMENT (internal only, never exposed)
- `pattern` - TEXT - Email or domain pattern (e.g., "zellyn@gmail.com" or "@misstudent.com")
- `type` - TEXT - "email" or "domain"
- `created_at` - TIMESTAMP
- UNIQUE constraint on (pattern, type)

### Initial Allowlist Data
- Individual email: `zellyn@gmail.com`
- Domain: `@misstudent.com`

## Architecture

### Backend (Go)

**Pattern**: Single goroutine handles all database access via channels to ensure thread safety.

**Database Access Strategy**:
- Use [sqlc](https://sqlc.dev/) for type-safe, generated Go code from SQL
- All SQL queries in one package (`internal/db/queries.sql`)
- Schema migrations in `internal/db/schema.sql`
- Generic SQL where possible (avoid SQLite-specific features) for future DB portability
- Generated code handles parameter binding and row scanning

**Key Components**:
1. **Database Manager Goroutine**:
   - Runs in background, receives requests via channel
   - Executes all SQLite operations using sqlc-generated code
   - Returns results via response channels

2. **ID Generation**:
   - Cryptographically random hex strings with type prefixes
   - Helper functions in `internal/db/ids.go`
   - Collision retry logic (though extremely rare)

3. **HTTP Server**:
   - Serves embedded static files
   - Provides API endpoints
   - Handles OAuth flow
   - Uses Go 1.25 CSRF middleware

4. **OAuth Handler**:
   - Initiates Google OAuth flow
   - Handles callback
   - Verifies email against allowlist BEFORE creating session
   - Creates Login + Account + AccountMember on first login
   - Generates adjective-noun display name (ensures uniqueness)

5. **Session Management**:
   - Use secure HTTP-only cookies
   - Session data in memory (or SQLite if preferred)

### Frontend (Vanilla JS)

**Pages/Views**:
1. **Login Page**: Google Sign-In button
2. **Trifle List**: Browse user's Trifles, create new
3. **Trifle Editor**: Main workspace

**Trifle Editor Layout**:
```
+----------------------------------------------------------+
|  Navbar: [Trifle Logo] [Title]           [User] [Logout]|
+----------------------------------------------------------+
| File    |                                                 |
| Tree    |  Ace Editor                                     |
|         |  (resizable)                                    |
|  📁 /   |                                                 |
|  📄main.|                                                 |
|  📄util.|                                                 |
|         +--------------------------------------------------+
|         |  Output Console                                 |
|         |  (Python stdout/stderr)                         |
|         |  [Run Button]                                   |
+---------+--------------------------------------------------+
```

**Key Frontend Features**:
- Ace Editor with Python syntax highlighting
- Custom-built file tree (Ace doesn't include one)
  - Parse file paths into tree structure
  - Vanilla JS rendering with expand/collapse
  - Click to open file in editor
  - Add/delete/rename file actions
- Resizable editor/console split
- "Run" button executes main.py via Pyodide
- Auto-save (debounced, triggers ~1s after typing stops)
- Load Ace and Pyodide from CDNs

## API Endpoints

### Authentication
- `GET /auth/login` - Redirect to Google OAuth
- `GET /auth/callback` - OAuth callback, verify allowlist, create session
- `POST /auth/logout` - Clear session

### Account Management
- `POST /api/account/reroll-name` - Generate new display name

### Trifles
- `GET /api/trifles` - List all user's Trifles
- `POST /api/trifles` - Create new Trifle (returns ID)
- `GET /api/trifles/:id` - Get Trifle metadata + all files
- `PUT /api/trifles/:id` - Update Trifle metadata (title, description)
- `DELETE /api/trifles/:id` - Delete Trifle

### Trifle Files
- `GET /api/trifles/:id/files` - List all files in Trifle
- `PUT /api/trifles/:id/files` - Batch update files (for auto-save)
- `POST /api/trifles/:id/files` - Create new file
- `DELETE /api/trifles/:id/files` - Delete file (by path in query param)

## Execution Model

- All Python code runs **client-side** via Pyodide
- No server-side Python execution
- Output captured and displayed in console
- `main.py` is the entry point when "Run" is clicked
- Future: Support for micropip to install packages

## V1 Scope (MVP)

### Included
✅ Google OAuth login with allowlist enforcement
✅ Reject disallowed emails immediately (no access request page)
✅ Auto-generated adjective-noun account display names
✅ Ability to re-roll display name
✅ Create/edit/delete Trifles
✅ Multiple files per Trifle with folder support (via paths)
✅ Ace editor with Python syntax highlighting
✅ Run Python3 code via Pyodide
✅ Output console for stdout/stderr
✅ Auto-save (debounced)
✅ `main.py` as designated entry point
✅ Single binary deployment with embedded static files
✅ SQLite database in `./data/`

### Deferred to Later
⏭️ Autocomplete in editor
⏭️ micropip package installation
⏭️ Turtle graphics (custom implementation)
⏭️ Sharing/public links
⏭️ Clone/remix functionality (but DB schema supports it via parent_id)
⏭️ Folders to organize Trifles (flat list for now)
⏭️ Multi-user accounts (but DB schema supports it)
⏭️ Admin UI to manage allowlist

## Implementation Steps

### Phase 1: Foundation
1. Initialize Go module and project structure
2. Set up SQLite schema with migrations
3. Implement database manager goroutine pattern
4. Create initial allowlist entries

### Phase 2: Authentication
5. Implement Google OAuth flow
6. Add allowlist checking
7. Create Login + Account + AccountMember on first login
8. Implement adjective-noun name generator
9. Add session management

### Phase 3: Backend API
10. Implement Trifle CRUD endpoints
11. Implement file CRUD endpoints
12. Add account name re-roll endpoint

### Phase 4: Frontend - Basic Structure
13. Create HTML templates (or embed single-page app)
14. Set up routing (login, list, editor views)
15. Implement login page with Google button

### Phase 5: Frontend - Trifle List
16. Build Trifle list view
17. Add "New Trifle" functionality

### Phase 6: Frontend - Editor
18. Integrate Ace Editor from CDN
19. Build file tree UI
20. Implement file add/delete/rename
21. Add resizable split pane
22. Integrate Pyodide from CDN
23. Implement "Run" button with output capture
24. Add auto-save with debouncing

### Phase 7: Polish
25. Error handling and validation
26. Loading states and UX improvements
27. Test with multiple users
28. Documentation

## File Structure

```
trifle/
├── PLAN.md                 # This file
├── README.md               # User-facing docs
├── go.mod
├── go.sum
├── sqlc.yaml              # sqlc configuration
├── main.go                 # Entry point
├── data/                   # Created at runtime
│   └── trifle.db          # SQLite database
├── internal/
│   ├── db/
│   │   ├── migrations/    # Goose migrations (embedded)
│   │   │   └── 00001_initial_schema.sql
│   │   ├── queries.sql    # All SQL queries (sqlc input)
│   │   ├── db.go          # sqlc-generated code (output)
│   │   ├── models.go      # sqlc-generated models (output)
│   │   ├── querier.go     # sqlc-generated interface (output)
│   │   ├── manager.go     # DB manager goroutine wrapper
│   │   └── ids.go         # ID generation utilities
│   ├── auth/
│   │   ├── oauth.go       # Google OAuth handling
│   │   ├── session.go     # Session management
│   │   └── allowlist.go   # Allowlist checking
│   ├── api/
│   │   ├── handlers.go    # HTTP handlers
│   │   ├── trifles.go     # Trifle endpoints
│   │   └── middleware.go  # Auth + CSRF middleware
│   └── namegen/
│       └── namegen.go     # Adjective-noun generator
└── web/                   # Frontend (embedded)
    ├── index.html
    ├── css/
    │   └── style.css
    └── js/
        ├── app.js         # Main app logic
        ├── editor.js      # Editor integration
        ├── pyodide.js     # Pyodide integration
        └── ui.js          # UI components
```

## Reference Implementation

Inspiration from: https://github.com/alexprengere/python_playground/blob/main/index.html
- Single-file example using Ace + Pyodide
- We'll modernize and split into proper structure
- Add persistence, auth, multi-file support

## Security Considerations

1. **Allowlist Enforcement**: Check on every login, reject disallowed emails immediately
2. **Session Security**: HTTP-only, secure cookies (SameSite=Lax or Strict)
3. **CSRF Protection**: Use Go 1.25's built-in CSRF middleware for all mutating endpoints
4. **Input Validation**: Validate all API inputs (title lengths, path names, etc.)
5. **Path Traversal**: Sanitize file paths in Trifles (no `..`, absolute paths, etc.)
6. **Client-side Execution**: Python runs in browser sandbox (Pyodide), no server-side risk
7. **Rate Limiting**: Consider adding to prevent abuse
8. **ID Unpredictability**: Random hex IDs prevent enumeration attacks
9. **Secrets Management**: All secrets from 1Password, never committed to repo

## Open Questions / Future Considerations

1. Should we add a max Trifle count per account?
2. Disk space limits per account?
3. File size limits?
4. Should adjective-noun list be embedded or configurable?
5. Session storage: in-memory or SQLite?
6. How to handle Pyodide version updates?
7. Admin interface for managing allowlist?

## Notes

- Ace Editor: https://ace.c9.io/ (can load from CDN)
- Pyodide: https://pyodide.org/ (can load from CDN)
- Keep UI simple and clean
- Auto-save eliminates "run unsaved code" issues
- Prefixed random hex IDs (Stripe/GitHub style) for type safety and security
- sqlc generates type-safe Go code from SQL, keeping all SQL in one place
- Generic SQL approach allows future migration from SQLite if needed
