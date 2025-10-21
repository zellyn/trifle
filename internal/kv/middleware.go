package kv

import (
	"context"
	"net/http"
)

// Session interface for KV auth - needs email
type Session interface {
	Email() string
	IsAuthenticated() bool
}

// SessionGetter can retrieve a session from a request
type SessionGetter interface {
	GetSession(r *http.Request) (Session, error)
}

// RequireAuth wraps a handler to require authentication for KV operations
func RequireAuth(sessionGetter SessionGetter) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			session, err := sessionGetter.GetSession(r)
			if err != nil || !session.IsAuthenticated() {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			// Add user email to context
			ctx := context.WithValue(r.Context(), "user_email", session.Email())
			next.ServeHTTP(w, r.WithContext(ctx))
		}
	}
}

// SessionAdapter adapts auth.Session to kv.Session interface
type SessionAdapter struct {
	email         string
	authenticated bool
}

func (sa *SessionAdapter) Email() string {
	return sa.email
}

func (sa *SessionAdapter) IsAuthenticated() bool {
	return sa.authenticated
}

// NewSessionAdapter creates an adapter for auth.Session
func NewSessionAdapter(email string, authenticated bool) *SessionAdapter {
	return &SessionAdapter{
		email:         email,
		authenticated: authenticated,
	}
}

// SessionManagerAdapter adapts auth.SessionManager to kv.SessionGetter
type SessionManagerAdapter struct {
	getSession func(*http.Request) (string, bool, error) // Returns (email, authenticated, error)
}

func (sma *SessionManagerAdapter) GetSession(r *http.Request) (Session, error) {
	email, authenticated, err := sma.getSession(r)
	if err != nil {
		return nil, err
	}
	return NewSessionAdapter(email, authenticated), nil
}

// NewSessionManagerAdapter creates a session manager adapter
func NewSessionManagerAdapter(getSession func(*http.Request) (string, bool, error)) *SessionManagerAdapter {
	return &SessionManagerAdapter{
		getSession: getSession,
	}
}
