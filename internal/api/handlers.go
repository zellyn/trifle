package api

import (
	"html/template"
	"log/slog"
	"net/http"

	"github.com/zellyn/trifle/internal/auth"
)

var homeTemplate = template.Must(template.New("home").Parse(`<!DOCTYPE html>
<html>
<head>
    <title>Trifle - Your Projects</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 1200px;
            margin: 40px auto;
            padding: 20px;
        }
        h1 { color: #667eea; }
        .user-info {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        a { color: #667eea; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="user-info">
        Welcome, <strong>{{.Email}}</strong>!
        <a href="/auth/logout" style="float: right;">Logout</a>
    </div>
    <h1>Your Trifles</h1>
    <p>Coming soon: Your Python projects will appear here!</p>
</body>
</html>`))

// HandleHome shows logged-in homepage, or redirects to /signup if not authenticated
func HandleHome(sessionMgr *auth.SessionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Check if user is logged in
		session, err := sessionMgr.GetSession(r)
		if err != nil || !session.Authenticated {
			// Not logged in, redirect to signup page
			http.Redirect(w, r, "/signup", http.StatusSeeOther)
			return
		}

		// User is logged in, show homepage
		// TODO: Render actual homepage with trifles
		// For now, just show a placeholder
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := homeTemplate.Execute(w, session); err != nil {
			slog.Error("Failed to render home page", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	}
}
