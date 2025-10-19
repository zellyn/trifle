package auth

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/zellyn/trifle/internal/db"
)

const (
	sessionCookieName = "trifle_session"
	sessionDuration   = 24 * time.Hour * 7 // 7 days
)

// Session represents a user session
type Session struct {
	ID            string
	LoginID       string
	AccountID     string
	Email         string
	Authenticated bool
	OAuthState    string    // Temporary state for OAuth flow
	ReturnURL     string    // URL to redirect to after login
	CreatedAt     time.Time
	LastAccessed  time.Time
}

// SessionManager manages user sessions
type SessionManager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	secure   bool // Use secure cookies (set to true in production)
	db       *db.Manager
}

// NewSessionManager creates a new session manager
func NewSessionManager(secure bool, dbManager *db.Manager) *SessionManager {
	sm := &SessionManager{
		sessions: make(map[string]*Session),
		secure:   secure,
		db:       dbManager,
	}

	// Load existing sessions from database on startup
	sm.loadSessionsFromDB()

	return sm
}

// loadSessionsFromDB loads all non-expired sessions from the database into memory
func (sm *SessionManager) loadSessionsFromDB() {
	// Delete expired sessions first
	ctx := context.Background()
	if err := sm.db.DeleteExpiredSessions(ctx); err != nil {
		slog.Error("Failed to delete expired sessions", "error", err)
	}

	// Note: We're not loading all sessions into memory on startup.
	// Instead, we'll load them on-demand when GetSession is called.
	// This is more memory-efficient for large numbers of sessions.
	slog.Info("Session manager initialized with database persistence")
}

// GetSession retrieves a session from a request
func (sm *SessionManager) GetSession(r *http.Request) (*Session, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil, err
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Check memory cache first
	session, exists := sm.sessions[cookie.Value]
	if exists {
		// Update last accessed time
		session.LastAccessed = time.Now()
		// Update in database asynchronously
		go func() {
			ctx := context.Background()
			sm.db.UpdateSessionLastAccessed(ctx, session.LastAccessed, session.ID)
		}()
		return session, nil
	}

	// Not in cache, try database
	ctx := context.Background()
	dbSession, err := sm.db.GetSession(ctx, cookie.Value)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("session not found")
		}
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	// Check if expired
	if dbSession.ExpiresAt.Before(time.Now()) {
		sm.db.DeleteSession(ctx, dbSession.ID)
		return nil, fmt.Errorf("session expired")
	}

	// Convert to Session and cache it
	session = &Session{
		ID:            dbSession.ID,
		LoginID:       dbSession.LoginID.String,
		AccountID:     dbSession.AccountID.String,
		Email:         dbSession.Email.String,
		Authenticated: dbSession.Authenticated,
		OAuthState:    dbSession.OauthState.String,
		ReturnURL:     dbSession.ReturnUrl.String,
		CreatedAt:     dbSession.CreatedAt,
		LastAccessed:  time.Now(),
	}
	sm.sessions[session.ID] = session

	// Update last accessed
	go func() {
		ctx := context.Background()
		sm.db.UpdateSessionLastAccessed(ctx, session.LastAccessed, session.ID)
	}()

	return session, nil
}

// GetOrCreateSession gets an existing session or creates a new one
func (sm *SessionManager) GetOrCreateSession(r *http.Request, w http.ResponseWriter) (*Session, error) {
	// Clean up expired sessions opportunistically
	go func() {
		ctx := context.Background()
		sm.db.DeleteExpiredSessions(ctx)
	}()

	// Try to get existing session
	session, err := sm.GetSession(r)
	if err == nil {
		return session, nil
	}

	// Create new session
	sessionID, err := generateRandomString(32)
	if err != nil {
		return nil, fmt.Errorf("failed to generate session ID: %w", err)
	}

	now := time.Now()
	expiresAt := now.Add(sessionDuration)

	session = &Session{
		ID:            sessionID,
		Authenticated: false,
		CreatedAt:     now,
		LastAccessed:  now,
	}

	// Save to database
	ctx := context.Background()
	err = sm.db.CreateSession(ctx, db.CreateSessionParams{
		ID:            sessionID,
		LoginID:       sql.NullString{},
		AccountID:     sql.NullString{},
		Email:         sql.NullString{},
		Authenticated: false,
		OauthState:    sql.NullString{},
		ReturnUrl:     sql.NullString{},
		CreatedAt:     now,
		LastAccessed:  now,
		ExpiresAt:     expiresAt,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create session in database: %w", err)
	}

	// Cache in memory
	sm.mu.Lock()
	sm.sessions[sessionID] = session
	sm.mu.Unlock()

	// Set cookie
	sm.setCookie(w, sessionID)

	return session, nil
}

// Save saves a session (updates it in memory and database, and refreshes the cookie)
func (sm *SessionManager) Save(w http.ResponseWriter, session *Session) error {
	// Update in database
	ctx := context.Background()
	err := sm.db.UpdateSession(ctx, db.UpdateSessionParams{
		LoginID:       toNullString(session.LoginID),
		AccountID:     toNullString(session.AccountID),
		Email:         toNullString(session.Email),
		Authenticated: session.Authenticated,
		OauthState:    toNullString(session.OAuthState),
		ReturnUrl:     toNullString(session.ReturnURL),
		LastAccessed:  session.LastAccessed,
		ID:            session.ID,
	})
	if err != nil {
		return fmt.Errorf("failed to update session in database: %w", err)
	}

	// Update in memory cache
	sm.mu.Lock()
	sm.sessions[session.ID] = session
	sm.mu.Unlock()

	sm.setCookie(w, session.ID)
	return nil
}

// Helper to convert string to sql.NullString
func toNullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// Destroy destroys a session
func (sm *SessionManager) Destroy(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookieName)
	if err == nil {
		// Delete from database
		ctx := context.Background()
		sm.db.DeleteSession(ctx, cookie.Value)

		// Delete from memory cache
		sm.mu.Lock()
		delete(sm.sessions, cookie.Value)
		sm.mu.Unlock()
	}

	// Clear the cookie
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   sm.secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// setCookie sets the session cookie
func (sm *SessionManager) setCookie(w http.ResponseWriter, sessionID string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sessionID,
		Path:     "/",
		MaxAge:   int(sessionDuration.Seconds()),
		HttpOnly: true,
		Secure:   sm.secure,
		SameSite: http.SameSiteLaxMode, // Lax allows OAuth callback redirects
	})
}

// Close cleans up the session manager
func (sm *SessionManager) Close() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Clear memory cache (database sessions persist)
	sm.sessions = make(map[string]*Session)
}

// RequireAuth is middleware that requires authentication
func (sm *SessionManager) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, err := sm.GetSession(r)
		if err != nil || !session.Authenticated {
			// Store the return URL in a new session
			returnSession, _ := sm.GetOrCreateSession(r, w)
			returnSession.ReturnURL = r.URL.String()
			sm.Save(w, returnSession)

			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}

		next.ServeHTTP(w, r)
	})
}
