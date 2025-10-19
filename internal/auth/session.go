package auth

import (
	"fmt"
	"net/http"
	"sync"
	"time"
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
	CreatedAt     time.Time
	LastAccessed  time.Time
}

// SessionManager manages user sessions
type SessionManager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	secure   bool // Use secure cookies (set to true in production)
}

// NewSessionManager creates a new session manager
func NewSessionManager(secure bool) *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
		secure:   secure,
	}
}

// GetSession retrieves a session from a request
func (sm *SessionManager) GetSession(r *http.Request) (*Session, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil, err
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	session, exists := sm.sessions[cookie.Value]
	if !exists {
		return nil, fmt.Errorf("session not found")
	}

	// Update last accessed time while holding lock
	session.LastAccessed = time.Now()

	return session, nil
}

// GetOrCreateSession gets an existing session or creates a new one
func (sm *SessionManager) GetOrCreateSession(r *http.Request, w http.ResponseWriter) (*Session, error) {
	// Clean up expired sessions opportunistically
	sm.cleanupExpired()

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

	session = &Session{
		ID:            sessionID,
		Authenticated: false,
		CreatedAt:     time.Now(),
		LastAccessed:  time.Now(),
	}

	sm.mu.Lock()
	sm.sessions[sessionID] = session
	sm.mu.Unlock()

	// Set cookie
	sm.setCookie(w, sessionID)

	return session, nil
}

// Save saves a session (updates it in memory and refreshes the cookie)
func (sm *SessionManager) Save(w http.ResponseWriter, session *Session) error {
	sm.mu.Lock()
	sm.sessions[session.ID] = session
	sm.mu.Unlock()

	sm.setCookie(w, session.ID)
	return nil
}

// Destroy destroys a session
func (sm *SessionManager) Destroy(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookieName)
	if err == nil {
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
		SameSite: http.SameSiteStrictMode,
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
		SameSite: http.SameSiteStrictMode,
	})
}

// cleanupExpired removes expired sessions
// Called opportunistically during login to avoid needing a background goroutine
func (sm *SessionManager) cleanupExpired() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	now := time.Now()
	for id, session := range sm.sessions {
		if now.Sub(session.LastAccessed) > sessionDuration {
			delete(sm.sessions, id)
		}
	}
}

// Close cleans up the session manager
func (sm *SessionManager) Close() {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	// Clear all sessions
	sm.sessions = make(map[string]*Session)
}

// RequireAuth is middleware that requires authentication
func (sm *SessionManager) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, err := sm.GetSession(r)
		if err != nil || !session.Authenticated {
			http.Redirect(w, r, "/", http.StatusSeeOther)
			return
		}

		next.ServeHTTP(w, r)
	})
}
