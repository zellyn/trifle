package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// OAuthConfig holds OAuth configuration
type OAuthConfig struct {
	Config      *oauth2.Config
	SessionMgr  *SessionManager
	RedirectURL string
	Allowlist   *Allowlist
}

// GoogleUser represents user info from Google
type GoogleUser struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	VerifiedEmail bool   `json:"verified_email"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

// NewOAuthConfig creates a new OAuth configuration
func NewOAuthConfig(clientID, clientSecret, redirectURL string, sessMgr *SessionManager, allowlist *Allowlist) *OAuthConfig {
	return &OAuthConfig{
		Config: &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Scopes: []string{
				"https://www.googleapis.com/auth/userinfo.email",
				"https://www.googleapis.com/auth/userinfo.profile",
			},
			Endpoint: google.Endpoint,
		},
		SessionMgr:  sessMgr,
		RedirectURL: redirectURL,
		Allowlist:   allowlist,
	}
}

// HandleLogin redirects the user to Google's OAuth consent page
func (oc *OAuthConfig) HandleLogin(w http.ResponseWriter, r *http.Request) {
	// Generate a random state token for CSRF protection
	state, err := generateRandomString(32)
	if err != nil {
		http.Error(w, "Failed to generate state token", http.StatusInternalServerError)
		return
	}

	// Store state in session (we'll verify it in the callback)
	session, err := oc.SessionMgr.GetOrCreateSession(r, w)
	if err != nil {
		http.Error(w, "Failed to create session", http.StatusInternalServerError)
		return
	}
	session.OAuthState = state
	if err := oc.SessionMgr.Save(w, session); err != nil {
		http.Error(w, "Failed to save session", http.StatusInternalServerError)
		return
	}

	// Redirect to Google's consent page
	url := oc.Config.AuthCodeURL(state, oauth2.AccessTypeOffline)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// HandleCallback processes the OAuth callback from Google
func (oc *OAuthConfig) HandleCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Helper function to redirect to profile page with error message
	redirectWithError := func(message string) {
		http.Redirect(w, r, "/profile.html?error="+url.QueryEscape(message), http.StatusSeeOther)
	}

	// Check for error from Google
	if errMsg := r.URL.Query().Get("error"); errMsg != "" {
		slog.Error("OAuth error from Google", "error", errMsg)
		redirectWithError("OAuth login failed. Please try again.")
		return
	}

	// Get the session to verify state
	session, err := oc.SessionMgr.GetSession(r)
	if err != nil || session == nil {
		slog.Warn("Invalid session in callback", "error", err)
		redirectWithError("Invalid session. Please try logging in again.")
		return
	}

	// Verify state token (CSRF protection)
	state := r.URL.Query().Get("state")
	if state == "" || state != session.OAuthState {
		slog.Warn("State mismatch", "got", state, "expected", session.OAuthState)
		redirectWithError("Security check failed. Please try logging in again.")
		return
	}

	// Exchange code for token
	code := r.URL.Query().Get("code")
	if code == "" {
		slog.Warn("No code in callback")
		redirectWithError("No authorization code received. Please try again.")
		return
	}

	token, err := oc.Config.Exchange(ctx, code)
	if err != nil {
		slog.Error("Failed to exchange token", "error", err)
		redirectWithError("Failed to complete login. Please try again.")
		return
	}

	// Get user info from Google
	userInfo, err := oc.getUserInfo(ctx, token)
	if err != nil {
		slog.Error("Failed to get user info", "error", err)
		redirectWithError("Failed to get user information. Please try again.")
		return
	}

	slog.Info("User attempting to log in", "email", userInfo.Email, "name", userInfo.Name)

	// Check if email is verified
	if !userInfo.VerifiedEmail {
		slog.Warn("Email not verified", "email", userInfo.Email)
		redirectWithError("Email not verified with Google. Please verify your email.")
		return
	}

	// Check if email is in allowlist
	if !oc.Allowlist.IsAllowed(userInfo.Email) {
		slog.Warn("Email not in allowlist", "email", userInfo.Email)
		redirectWithError("Your email (" + userInfo.Email + ") is not authorized for sync. The site works fine without logging in! Contact zellyn@gmail.com if you need sync access.")
		return
	}

	slog.Info("Login successful", "email", userInfo.Email)

	// Update session with user info
	// Note: We no longer use separate user IDs - the email IS the user identifier
	session.UserID = "" // Deprecated, keeping for compatibility
	session.Email = userInfo.Email
	session.Authenticated = true
	session.OAuthState = "" // Clear the state token

	if err := oc.SessionMgr.Save(w, session); err != nil {
		slog.Error("Failed to save session", "error", err)
		redirectWithError("Failed to save login session. Please try again.")
		return
	}

	// Redirect to profile page with logged_in flag to trigger auto-sync
	http.Redirect(w, r, "/profile.html?logged_in=true", http.StatusSeeOther)
}

// getUserInfo fetches user information from Google
func (oc *OAuthConfig) getUserInfo(ctx context.Context, token *oauth2.Token) (*GoogleUser, error) {
	client := oc.Config.Client(ctx, token)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v2/userinfo")
	if err != nil {
		return nil, fmt.Errorf("failed to get user info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get user info, status: %d, body: %s", resp.StatusCode, body)
	}

	var userInfo GoogleUser
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, fmt.Errorf("failed to decode user info: %w", err)
	}

	return &userInfo, nil
}

// HandleLogout logs the user out
func (oc *OAuthConfig) HandleLogout(w http.ResponseWriter, r *http.Request) {
	// Clear the session
	oc.SessionMgr.Destroy(w, r)

	// Redirect to home page
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// GetOAuthCredentials retrieves OAuth credentials from environment
func GetOAuthCredentials() (clientID, clientSecret string, err error) {
	clientID = os.Getenv("GOOGLE_CLIENT_ID")
	clientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")

	if clientID == "" {
		return "", "", fmt.Errorf("GOOGLE_CLIENT_ID not set")
	}
	if clientSecret == "" {
		return "", "", fmt.Errorf("GOOGLE_CLIENT_SECRET not set")
	}

	return clientID, clientSecret, nil
}
