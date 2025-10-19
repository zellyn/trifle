package main

import (
	"context"
	"embed"
	"fmt"
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
	sessionMgr := auth.NewSessionManager(isProduction)

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

	// Set up HTTP router
	mux := http.NewServeMux()

	// Home page (auth-aware)
	mux.HandleFunc("/", api.HandleHome(sessionMgr))

	// Auth routes
	mux.HandleFunc("/auth/login", oauthConfig.HandleLogin)
	mux.HandleFunc("/auth/callback", oauthConfig.HandleCallback)
	mux.HandleFunc("/auth/logout", oauthConfig.HandleLogout)

	// Serve static files from embedded web directory
	webContent, err := fs.Sub(webFS, "web")
	if err != nil {
		slog.Error("Failed to get web subdirectory", "error", err)
		os.Exit(1)
	}
	fileServer := http.FileServer(http.FS(webContent))

	// Signup page (serve signup.html explicitly)
	mux.HandleFunc("/signup", func(w http.ResponseWriter, r *http.Request) {
		data, err := webFS.ReadFile("web/signup.html")
		if err != nil {
			http.Error(w, "Signup page not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})

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
