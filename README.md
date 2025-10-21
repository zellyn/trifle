# Trifle

A browser-based Python3 playground where all code execution happens client-side using WebAssembly.

## What is Trifle?

Trifle is a web application for creating, editing, and running Python3 programs entirely in your browser. Think JSFiddle or CodePen, but for Python, with zero server-side code execution.

**Key Features:**
- 🐍 Python3 running in browser via [Pyodide](https://pyodide.org/)
- 📝 Multiple files per project with folder support
- 💾 Auto-save as you type
- 🔐 Google OAuth authentication with email allowlist
- 🎭 Victorian-era themed account names (e.g., "dapper-falcon")
- 🔒 All code execution is client-side (sandboxed in browser)

## Tech Stack

- **Backend**: Go 1.25+
- **Database**: SQLite with [sqlc](https://sqlc.dev/) and [goose](https://github.com/pressly/goose) migrations
- **Frontend**: Vanilla JavaScript, [Ace Editor](https://ace.c9.io/), [Pyodide](https://pyodide.org/)
- **Authentication**: Google OAuth 2.0
- **Deployment**: Single binary with embedded static files

## Running Locally

### Prerequisites

- Go 1.25 or later
- [1Password CLI](https://developer.1password.com/docs/cli/) (for secrets)
- Google OAuth credentials (or use the development ones below)

### Setup

1. Clone the repository:
```bash
git clone https://github.com/zellyn/trifle.git
cd trifle
```

2. Set environment variables:
```bash
export GOOGLE_CLIENT_ID="$(op read 'op://Shared/Trifle/Google OAuth Client ID')"
export GOOGLE_CLIENT_SECRET="$(op read 'op://Shared/Trifle/Google OAuth Client Secret')"
```

3. Run the server:
```bash
go run main.go
```

4. Open http://localhost:3000 in your browser

### Environment Variables

- `GOOGLE_CLIENT_ID` - Google OAuth client ID (required)
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret (required)
- `OAUTH_REDIRECT_URL` - OAuth redirect URL (defaults to `http://localhost:3000/auth/callback`)
- `PRODUCTION` - Set to `"true"` to enable secure cookies (for HTTPS)
- `PORT` - Server port (defaults to `3000`)

## Development

### Project Structure

```
trifle/
├── internal/
│   ├── db/          # Database: migrations, queries, manager
│   ├── auth/        # OAuth and session management
│   ├── api/         # HTTP handlers and middleware
│   └── namegen/     # Account name generator
├── web/             # Frontend static files
├── main.go          # Entry point
└── sqlc.yaml        # sqlc configuration
```

### Database

Migrations are automatically run on startup. The database is created in `./data/trifle.db`.

To regenerate sqlc code after modifying `internal/db/queries.sql`:
```bash
sqlc generate
```

### Adding Users to Allowlist

Edit `internal/db/migrations/00001_initial_schema.sql` and add entries to the `email_allowlist` table:

```sql
-- Individual email
INSERT INTO email_allowlist (pattern, type) VALUES ('user@example.com', 'email');

-- Entire domain
INSERT INTO email_allowlist (pattern, type) VALUES ('@example.com', 'domain');
```

Then delete `./data/trifle.db` and restart to recreate the database.

## Current Status

**Completed:**
- ✅ Google OAuth authentication with allowlist
- ✅ Session management
- ✅ Database schema and migrations
- ✅ Auto-generated account names
- ✅ Basic signup/home pages

**In Progress:**
- 🔲 Trifle CRUD API endpoints
- 🔲 File management API
- 🔲 Editor frontend
- 🔲 Pyodide integration

See [PLAN.md](PLAN.md) for detailed architecture and roadmap.

## License

GPLv3
