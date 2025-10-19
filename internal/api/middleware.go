package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/zellyn/trifle/internal/auth"
)

// responseWriter wraps http.ResponseWriter to capture the status code
type responseWriter struct {
	http.ResponseWriter
	statusCode int
	written    int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.written += n
	return n, err
}

// LoggingMiddleware logs HTTP requests in a standard format
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap the response writer to capture status code
		wrapped := &responseWriter{
			ResponseWriter: w,
			statusCode:     200, // default status code
		}

		// Call the next handler
		next.ServeHTTP(wrapped, r)

		// Log the request
		duration := time.Since(start)
		slog.Info("HTTP request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.statusCode,
			"duration_ms", duration.Milliseconds(),
			"bytes", wrapped.written,
			"remote_addr", r.RemoteAddr,
		)
	})
}

// contextKey is a custom type for context keys to avoid collisions
type contextKey string

const (
	// ContextKeySession is the context key for storing the session
	ContextKeySession contextKey = "session"
)

// RequireAuthAPI is middleware that requires authentication for API routes
// Returns JSON error responses instead of redirecting
func RequireAuthAPI(sessionMgr *auth.SessionManager) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			session, err := sessionMgr.GetSession(r)
			if err != nil || !session.Authenticated {
				JSONUnauthorized(w, "Authentication required")
				return
			}

			// Add session to request context for downstream handlers
			ctx := context.WithValue(r.Context(), ContextKeySession, session)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetSessionFromContext retrieves the session from the request context
func GetSessionFromContext(r *http.Request) *auth.Session {
	session, ok := r.Context().Value(ContextKeySession).(*auth.Session)
	if !ok {
		return nil
	}
	return session
}
