package api

import (
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"

	"github.com/zellyn/trifle/internal/auth"
	"github.com/zellyn/trifle/internal/db"
)

// Templates holds the embedded template files
var Templates fs.FS

// HandleHome shows logged-in homepage, or redirects to /signup if not authenticated
func HandleHome(sessionMgr *auth.SessionManager, dbManager *db.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Check if user is logged in
		session, err := sessionMgr.GetSession(r)
		if err != nil || !session.Authenticated {
			// Not logged in, redirect to signup page
			http.Redirect(w, r, "/signup", http.StatusSeeOther)
			return
		}

		// Get account details
		account, err := dbManager.GetAccount(r.Context(), session.AccountID)
		if err != nil {
			slog.Error("Failed to get account", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Load and parse the home template
		tmpl, err := template.ParseFS(Templates, "home.html")
		if err != nil {
			slog.Error("Failed to parse home template", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Prepare data for template
		data := struct {
			Email       string
			DisplayName string
		}{
			Email:       session.Email,
			DisplayName: account.DisplayName,
		}

		// User is logged in, show homepage
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.Execute(w, data); err != nil {
			slog.Error("Failed to render home page", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	}
}

// HandleSignup shows the signup/login page
func HandleSignup() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Load and parse the signup template
		tmpl, err := template.ParseFS(Templates, "signup.html")
		if err != nil {
			slog.Error("Failed to parse signup template", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Render the signup page
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.Execute(w, nil); err != nil {
			slog.Error("Failed to render signup page", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	}
}

// HandleProfile shows the user profile page
func HandleProfile(sessionMgr *auth.SessionManager, dbManager *db.Manager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Get session (authentication handled by middleware)
		session, err := sessionMgr.GetSession(r)
		if err != nil || !session.Authenticated {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}

		// Get account details
		account, err := dbManager.GetAccount(r.Context(), session.AccountID)
		if err != nil {
			slog.Error("Failed to get account", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Load and parse the profile template
		tmpl, err := template.ParseFS(Templates, "profile.html")
		if err != nil {
			slog.Error("Failed to parse profile template", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Prepare data for template
		data := struct {
			Email       string
			DisplayName string
			CreatedAt   string
		}{
			Email:       session.Email,
			DisplayName: account.DisplayName,
			CreatedAt:   account.CreatedAt.Format("2006-01-02"),
		}

		// Render the profile page
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.Execute(w, data); err != nil {
			slog.Error("Failed to render profile page", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	}
}
