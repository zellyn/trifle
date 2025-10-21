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

// Session represents a user session (in-memory only for Phase 2)
type Session struct {
	ID            string
	UserID        string // User ID from storage
	Email         string
	Authenticated bool
	OAuthState    string    // Temporary state for OAuth flow
	CreatedAt     time.Time
	LastAccessed  time.Time
}

// GetUserID returns the user ID for this session (implements sync.Session interface)
func (s *Session) GetUserID() string {
	return s.UserID
}

// IsAuthenticated returns whether this session is authenticated (implements sync.Session interface)
func (s *Session) IsAuthenticated() bool {
	return s.Authenticated
}

// SessionManager manages user sessions (in-memory)
type SessionManager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	secure   bool  // Use secure cookies (set to true in production)
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

	sm.mu.RLock()
	session, exists := sm.sessions[cookie.Value]
	sm.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("session not found")
	}

	// Update last accessed time
	sm.mu.Lock()
	session.LastAccessed = time.Now()
	sm.mu.Unlock()

	return session, nil
}

// GetOrCreateSession gets an existing session or creates a new one
func (sm *SessionManager) GetOrCreateSession(r *http.Request, w http.ResponseWriter) (*Session, error) {
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
	session = &Session{
		ID:            sessionID,
		Authenticated: false,
		CreatedAt:     now,
		LastAccessed:  now,
	}

	// Cache in memory
	sm.mu.Lock()
	sm.sessions[sessionID] = session
	sm.mu.Unlock()

	// Set cookie
	sm.setCookie(w, sessionID)

	return session, nil
}

// Save saves a session (updates it in memory and refreshes the cookie)
func (sm *SessionManager) Save(w http.ResponseWriter, session *Session) error {
	// Update in memory cache
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
