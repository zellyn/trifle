# Trifle

A local-first browser-based Python3 playground where all code execution happens client-side using WebAssembly.

## What is Trifle?

Trifle is a web application for creating, editing, and running Python3 programs entirely in your browser. Think JSFiddle or CodePen, but for Python, with zero server-side code execution.

**Key Features:**
- 🐍 Python3 running in browser via [Pyodide](https://pyodide.org/)
- 📝 Multiple files per project with folder support
- 💾 Auto-save as you type
- 🔌 Works offline (after initial load)
- 🔐 Optional Google OAuth authentication for sync
- 🔒 All code execution is client-side (sandboxed in browser)
- 💿 Local-first: All data stored in browser IndexedDB

## Tech Stack

- **Backend**: Go 1.25+ (minimal server for OAuth and KV sync)
- **Storage**: IndexedDB (client-side) + file-based KV store (server-side sync)
- **Frontend**: Vanilla JavaScript, [Ace Editor](https://ace.c9.io/), [Pyodide](https://pyodide.org/)
- **Authentication**: Optional Google OAuth 2.0
- **Deployment**: Single binary with embedded static files

## Running Locally

### Prerequisites

- Go 1.25 or later
- Google OAuth credentials (optional, only needed for sync)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/zellyn/trifle.git
cd trifle
```

2. (Optional) Set environment variables for OAuth:
```bash
export GOOGLE_CLIENT_ID="<your-client-id>"
export GOOGLE_CLIENT_SECRET="<your-client-secret>"
```

3. Run the server:
```bash
go run main.go
```

4. Open http://localhost:3000 in your browser

### Environment Variables

- `GOOGLE_CLIENT_ID` - Google OAuth client ID (optional, required for sync)
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret (optional, required for sync)
- `PORT` - Server port (defaults to `3000`)
- `OAUTH_REDIRECT_URL` - OAuth redirect URL (defaults to `http://localhost:{PORT}/auth/callback`)
  - Example for production: `https://trifling.org/auth/callback`
  - The URL scheme determines secure cookie settings (https = secure)

### Email Allowlist

Access to sync is controlled by an allowlist at `data/allowlist.txt`. The file is automatically created with default entries if it doesn't exist:

```
zellyn@gmail.com
@misstudent.com
```

**Format**:
- One pattern per line
- Exact email addresses: `user@example.com`
- Domain wildcards: `@example.com` (allows all emails from that domain)
- Comments: Lines starting with `#` are ignored
- Empty lines are ignored

**Example**:
```
# Individual users
alice@example.com
bob@gmail.com

# Entire domains
@mycompany.com
@school.edu
```

The server logs which patterns are loaded on startup. Users not in the allowlist will see "Access denied: email not authorized" when attempting to log in.

## Development

### Project Structure

```
trifle/
├── internal/
│   ├── auth/        # OAuth and session management
│   └── kv/          # File-based key-value store for sync
├── web/             # Frontend static files
│   ├── css/         # Stylesheets
│   ├── js/          # JavaScript modules
│   │   ├── app.js       # Main app controller
│   │   ├── db.js        # IndexedDB storage layer
│   │   ├── editor.js    # Code editor
│   │   ├── sync-kv.js   # Sync manager
│   │   └── ...
│   ├── sw.js        # Service worker for offline support
│   └── *.html       # Page templates
└── main.go          # Entry point
```

## Architecture

Trifle is a **local-first** application:

- All user data is stored in the browser's IndexedDB
- Works completely offline after initial page load
- No account required for basic use
- Optional sync via Google OAuth:
  - Server acts as a simple key-value store
  - Server never parses or executes user code
  - Conflict resolution via logical clocks
  - Content-addressed file storage with deduplication

## Current Status

**Completed:**
- ✅ IndexedDB storage layer
- ✅ Service worker for offline support
- ✅ Pyodide integration with web worker execution
- ✅ Multi-file editor with auto-save
- ✅ ANSI terminal output support
- ✅ `input()` support for interactive programs
- ✅ Google OAuth authentication (optional)
- ✅ Bidirectional sync with KV store
- ✅ Profile management with random name generation

**Future Ideas:**
- 🔲 Package installation (pip packages via Pyodide)
- 🔲 Sharing/publishing trifles
- 🔲 Collaborative editing
- 🔲 Version history

See [PLAN.md](PLAN.md) for detailed architecture and roadmap.

## License

GPLv3
