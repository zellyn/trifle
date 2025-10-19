package main

import (
	"context"
	"embed"
	"fmt"
	"html/template"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/zellyn/trifle/internal/api"
	"github.com/zellyn/trifle/internal/auth"
	"github.com/zellyn/trifle/internal/db"
)

//go:embed web
var webFS embed.FS

func main() {
	// Set up structured logging
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Get port from environment or default to 3000
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	// Determine if we're in production (HTTPS) or development (HTTP)
	isProduction := os.Getenv("PRODUCTION") == "true"

	// Database path
	dbPath := "./data/trifle.db"

	// Ensure data directory exists
	if err := os.MkdirAll("./data", 0755); err != nil {
		slog.Error("Failed to create data directory", "error", err)
		os.Exit(1)
	}

	// Initialize database manager
	dbManager, err := db.NewManager(dbPath)
	if err != nil {
		slog.Error("Failed to initialize database", "error", err)
		os.Exit(1)
	}
	defer dbManager.Close()

	slog.Info("Database initialized successfully")

	// Initialize session manager
	sessionMgr := auth.NewSessionManager(isProduction, dbManager)

	// Get OAuth credentials
	clientID, clientSecret, err := auth.GetOAuthCredentials()
	if err != nil {
		slog.Error("Failed to get OAuth credentials", "error", err)
		os.Exit(1)
	}

	// Determine redirect URL based on environment
	redirectURL := os.Getenv("OAUTH_REDIRECT_URL")
	if redirectURL == "" {
		// Default to localhost if not specified
		redirectURL = fmt.Sprintf("http://localhost:%s/auth/callback", port)
	}

	// Initialize OAuth config
	oauthConfig := auth.NewOAuthConfig(clientID, clientSecret, redirectURL, dbManager, sessionMgr)

	// Set up template filesystem for API handlers
	webContent, err := fs.Sub(webFS, "web")
	if err != nil {
		slog.Error("Failed to get web subdirectory", "error", err)
		os.Exit(1)
	}
	api.Templates = webContent

	// Set up HTTP router
	mux := http.NewServeMux()

	// Home page (auth-aware)
	mux.HandleFunc("/", api.HandleHome(sessionMgr, dbManager))

	// Auth routes
	mux.HandleFunc("/auth/login", oauthConfig.HandleLogin)
	mux.HandleFunc("/auth/callback", oauthConfig.HandleCallback)
	mux.HandleFunc("/auth/logout", oauthConfig.HandleLogout)

	// API handlers
	trifleHandlers := api.NewTrifleHandlers(dbManager)
	accountHandlers := api.NewAccountHandlers(dbManager)

	// API routes (all require authentication)
	requireAuthAPI := api.RequireAuthAPI(sessionMgr)

	// Account endpoints
	mux.Handle("/api/account/name-suggestions", requireAuthAPI(http.HandlerFunc(accountHandlers.HandleGetNameSuggestions)))
	mux.Handle("/api/account/name", requireAuthAPI(http.HandlerFunc(accountHandlers.HandleSetAccountName)))

	// Trifle endpoints
	mux.Handle("/api/trifles", requireAuthAPI(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			trifleHandlers.HandleListTrifles(w, r)
		} else if r.Method == http.MethodPost {
			trifleHandlers.HandleCreateTrifle(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})))

	// Trifle by ID endpoints (GET, PUT, DELETE)
	mux.Handle("/api/trifles/", requireAuthAPI(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if it's a file operation
		if len(r.URL.Path) > len("/api/trifles/") {
			// Extract the path after /api/trifles/
			path := r.URL.Path[len("/api/trifles/"):]

			// Check if this is a files endpoint
			if len(path) > 0 {
				// Split on / to get trifle_id and potential "files" segment
				// Example paths:
				// - /api/trifles/trifle_abc123 -> trifle operations
				// - /api/trifles/trifle_abc123/files -> file operations

				// Simple check: does it contain "/files"?
				if len(path) > 6 && path[len(path)-6:] == "/files" {
					// File list or batch update: /api/trifles/:id/files
					if r.Method == http.MethodGet {
						trifleHandlers.HandleListFiles(w, r)
					} else if r.Method == http.MethodPost {
						trifleHandlers.HandleCreateFile(w, r)
					} else if r.Method == http.MethodPut {
						trifleHandlers.HandleBatchUpdateFiles(w, r)
					} else if r.Method == http.MethodDelete {
						trifleHandlers.HandleDeleteFile(w, r)
					} else {
						http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
					}
					return
				}
			}
		}

		// Trifle-level operations
		if r.Method == http.MethodGet {
			trifleHandlers.HandleGetTrifle(w, r)
		} else if r.Method == http.MethodPut {
			trifleHandlers.HandleUpdateTrifle(w, r)
		} else if r.Method == http.MethodDelete {
			trifleHandlers.HandleDeleteTrifle(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	})))

	// Signup page
	mux.HandleFunc("/signup", api.HandleSignup())

	// Profile page (requires authentication)
	mux.Handle("/profile", sessionMgr.RequireAuth(api.HandleProfile(sessionMgr, dbManager)))

	// Editor page (requires authentication)
	mux.Handle("/editor/", sessionMgr.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Get session
		session, err := sessionMgr.GetSession(r)
		if err != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		// Get account details
		account, err := dbManager.GetAccount(r.Context(), session.AccountID)
		if err != nil {
			slog.Error("Failed to get account", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Serve the editor template
		tmpl, err := template.ParseFS(webContent, "editor.html")
		if err != nil {
			slog.Error("Failed to parse editor template", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
			return
		}

		// Prepare data for template
		data := struct {
			DisplayName string
		}{
			DisplayName: account.DisplayName,
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.Execute(w, data); err != nil {
			slog.Error("Failed to render editor page", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
	})))

	// Serve static files from embedded web directory
	fileServer := http.FileServer(http.FS(webContent))

	// Other static files
	mux.Handle("/css/", fileServer)
	mux.Handle("/js/", fileServer)

	// Create HTTP server with logging middleware
	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      api.LoggingMiddleware(mux),
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		slog.Info("Trifle server starting", "url", fmt.Sprintf("http://localhost:%s", port))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("Server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	slog.Info("Shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("Server shutdown error", "error", err)
	}

	slog.Info("Server stopped")
}
