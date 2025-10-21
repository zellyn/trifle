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

	"github.com/zellyn/trifle/internal/auth"
	"github.com/zellyn/trifle/internal/kv"
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

	// Data directory for flat-file storage
	dataDir := "./data"

	// Initialize KV store
	kvStore, err := kv.NewStore(dataDir)
	if err != nil {
		slog.Error("Failed to initialize KV store", "error", err)
		os.Exit(1)
	}

	slog.Info("Storage initialized successfully", "dataDir", dataDir)

	// Initialize session manager (for OAuth)
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
	oauthConfig := auth.NewOAuthConfig(clientID, clientSecret, redirectURL, sessionMgr)

	// Set up web filesystem
	webContent, err := fs.Sub(webFS, "web")
	if err != nil {
		slog.Error("Failed to get web subdirectory", "error", err)
		os.Exit(1)
	}

	// Set up HTTP router
	mux := http.NewServeMux()

	// Home page - NO AUTH REQUIRED (local-first!)
	// Serves the static index.html which uses IndexedDB
	mux.Handle("/", http.FileServer(http.FS(webContent)))

	// Auth routes (optional, only for sync)
	mux.HandleFunc("/auth/login", oauthConfig.HandleLogin)
	mux.HandleFunc("/auth/callback", oauthConfig.HandleCallback)
	mux.HandleFunc("/auth/logout", oauthConfig.HandleLogout)
	mux.HandleFunc("/api/whoami", auth.HandleWhoAmI(sessionMgr))

	// KV API handlers (require authentication)
	kvHandlers := kv.NewHandlers(kvStore)

	// Create session adapter for KV middleware
	kvSessionAdapter := kv.NewSessionManagerAdapter(func(r *http.Request) (string, bool, error) {
		session, err := sessionMgr.GetSession(r)
		if err != nil {
			return "", false, err
		}
		return session.Email, session.Authenticated, nil
	})

	requireAuth := kv.RequireAuth(kvSessionAdapter)

	// KV endpoints
	mux.HandleFunc("/kv/", requireAuth(kvHandlers.HandleKV))
	mux.HandleFunc("/kvlist/", requireAuth(kvHandlers.HandleList))

	// Serve static files from embedded web directory
	mux.Handle("/css/", http.FileServer(http.FS(webContent)))
	mux.Handle("/js/", http.FileServer(http.FS(webContent)))

	// Create HTTP server with logging middleware
	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      loggingMiddleware(mux),
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

// loggingMiddleware logs HTTP requests
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		duration := time.Since(start)
		slog.Info("HTTP request",
			"method", r.Method,
			"path", r.URL.Path,
			"duration", duration,
		)
	})
}
