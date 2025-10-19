package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"

	"github.com/zellyn/trifle/internal/db"
	"github.com/zellyn/trifle/internal/namegen"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

// OAuthConfig holds OAuth configuration
type OAuthConfig struct {
	Config      *oauth2.Config
	DBManager   *db.Manager
	SessionMgr  *SessionManager
	RedirectURL string
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
func NewOAuthConfig(clientID, clientSecret, redirectURL string, dbMgr *db.Manager, sessMgr *SessionManager) *OAuthConfig {
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
		DBManager:   dbMgr,
		SessionMgr:  sessMgr,
		RedirectURL: redirectURL,
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

	// Check for error from Google
	if errMsg := r.URL.Query().Get("error"); errMsg != "" {
		slog.Error("OAuth error from Google", "error", errMsg)
		http.Error(w, fmt.Sprintf("OAuth error: %s", errMsg), http.StatusBadRequest)
		return
	}

	// Get the session to verify state
	session, err := oc.SessionMgr.GetSession(r)
	if err != nil || session == nil {
		slog.Warn("Invalid session in callback", "error", err)
		http.Error(w, "Invalid session - please try logging in again", http.StatusBadRequest)
		return
	}

	// Verify state token (CSRF protection)
	state := r.URL.Query().Get("state")
	if state == "" || state != session.OAuthState {
		slog.Warn("State mismatch", "got", state, "expected", session.OAuthState)
		http.Error(w, "Invalid state parameter - please try logging in again", http.StatusBadRequest)
		return
	}

	// Exchange code for token
	code := r.URL.Query().Get("code")
	if code == "" {
		slog.Warn("No code in callback")
		http.Error(w, "No authorization code received", http.StatusBadRequest)
		return
	}

	token, err := oc.Config.Exchange(ctx, code)
	if err != nil {
		slog.Error("Failed to exchange token", "error", err)
		http.Error(w, fmt.Sprintf("Failed to exchange token: %v", err), http.StatusInternalServerError)
		return
	}

	// Get user info from Google
	userInfo, err := oc.getUserInfo(ctx, token)
	if err != nil {
		slog.Error("Failed to get user info", "error", err)
		http.Error(w, fmt.Sprintf("Failed to get user info: %v", err), http.StatusInternalServerError)
		return
	}

	slog.Info("User attempting to log in", "email", userInfo.Email, "name", userInfo.Name)

	// Check if email is verified
	if !userInfo.VerifiedEmail {
		slog.Warn("Email not verified", "email", userInfo.Email)
		http.Error(w, "Email not verified with Google", http.StatusForbidden)
		return
	}

	// Check allowlist
	allowed, err := oc.DBManager.CheckEmailAllowlist(ctx, userInfo.Email)
	if err != nil {
		slog.Error("Failed to check allowlist", "error", err)
		http.Error(w, "Failed to check allowlist", http.StatusInternalServerError)
		return
	}
	if !allowed {
		slog.Warn("Email not on allowlist", "email", userInfo.Email)
		http.Error(w, "Access denied: email not on allowlist", http.StatusForbidden)
		return
	}

	// Get or create login
	login, err := oc.getOrCreateLogin(ctx, userInfo)
	if err != nil {
		slog.Error("Failed to process login", "error", err)
		http.Error(w, fmt.Sprintf("Failed to process login: %v", err), http.StatusInternalServerError)
		return
	}

	// Get the user's account
	account, err := oc.getAccountForLogin(ctx, login.ID)
	if err != nil {
		slog.Error("Failed to get account", "error", err)
		http.Error(w, fmt.Sprintf("Failed to get account: %v", err), http.StatusInternalServerError)
		return
	}

	slog.Info("Login successful", "email", userInfo.Email, "account_id", account.ID, "display_name", account.DisplayName)

	// Update session with login info
	session.LoginID = login.ID
	session.AccountID = account.ID
	session.Email = login.Email
	session.Authenticated = true
	session.OAuthState = "" // Clear the state token

	// Check for return URL before we save (we'll clear it)
	returnURL := session.ReturnURL
	if returnURL != "" {
		session.ReturnURL = "" // Clear it after use
	}

	if err := oc.SessionMgr.Save(w, session); err != nil {
		slog.Error("Failed to save session", "error", err)
		http.Error(w, "Failed to save session", http.StatusInternalServerError)
		return
	}

	// Redirect to return URL if set, otherwise home page
	if returnURL != "" {
		http.Redirect(w, r, returnURL, http.StatusSeeOther)
	} else {
		http.Redirect(w, r, "/", http.StatusSeeOther)
	}
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

// getOrCreateLogin retrieves an existing login or creates a new one
func (oc *OAuthConfig) getOrCreateLogin(ctx context.Context, userInfo *GoogleUser) (*db.Login, error) {
	// Try to get existing login by Google ID
	login, err := oc.DBManager.GetLoginByGoogleID(ctx, userInfo.ID)
	if err == nil {
		// Login exists, update email/name in case they changed
		// (Note: We don't expose UpdateLogin via Manager yet, skipping for now)
		return login, nil
	}

	if err != sql.ErrNoRows {
		return nil, fmt.Errorf("failed to query login: %w", err)
	}

	// Login doesn't exist, create new login + account + account_member in a transaction
	loginID, err := db.NewLoginID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate login ID: %w", err)
	}

	accountID, err := db.NewAccountID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate account ID: %w", err)
	}

	accountMemberID, err := db.NewAccountMemberID()
	if err != nil {
		return nil, fmt.Errorf("failed to generate account member ID: %w", err)
	}

	// Generate unique display name
	displayName, err := oc.generateUniqueDisplayName(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to generate display name: %w", err)
	}

	// Create login, account, and account_member in a transaction
	err = oc.DBManager.Transaction(ctx, func(tx *sql.Tx, q *db.Queries) error {
		// Create login
		if err := q.CreateLogin(ctx, db.CreateLoginParams{
			ID:       loginID,
			GoogleID: userInfo.ID,
			Email:    userInfo.Email,
			Name:     userInfo.Name,
		}); err != nil {
			return fmt.Errorf("failed to create login: %w", err)
		}

		// Create account
		if err := q.CreateAccount(ctx, db.CreateAccountParams{
			ID:          accountID,
			DisplayName: displayName,
		}); err != nil {
			return fmt.Errorf("failed to create account: %w", err)
		}

		// Create account member
		if err := q.CreateAccountMember(ctx, db.CreateAccountMemberParams{
			ID:        accountMemberID,
			AccountID: accountID,
			LoginID:   loginID,
			Role:      "owner",
		}); err != nil {
			return fmt.Errorf("failed to create account member: %w", err)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	// Fetch and return the newly created login
	return oc.DBManager.GetLoginByGoogleID(ctx, userInfo.ID)
}

// generateUniqueDisplayName generates a unique display name, retrying if there's a collision
func (oc *OAuthConfig) generateUniqueDisplayName(ctx context.Context) (string, error) {
	const maxRetries = 10

	for i := 0; i < maxRetries; i++ {
		name, err := namegen.Generate()
		if err != nil {
			return "", err
		}

		// Check if name is already taken
		_, err = oc.DBManager.GetAccountByDisplayName(ctx, name)
		if err == sql.ErrNoRows {
			// Name is available!
			return name, nil
		}
		if err != nil {
			return "", fmt.Errorf("failed to check display name: %w", err)
		}

		// Name is taken, try again
	}

	return "", fmt.Errorf("failed to generate unique display name after %d attempts", maxRetries)
}

// getAccountForLogin retrieves the account associated with a login
func (oc *OAuthConfig) getAccountForLogin(ctx context.Context, loginID string) (*db.Account, error) {
	// Get account members for this login
	members, err := oc.DBManager.GetAccountMembersByLoginID(ctx, loginID)
	if err != nil {
		return nil, fmt.Errorf("failed to get account members: %w", err)
	}

	if len(members) == 0 {
		return nil, fmt.Errorf("no account found for login")
	}

	// For now, just use the first account (in V1 there's only one per login)
	return oc.DBManager.GetAccount(ctx, members[0].AccountID)
}

// HandleLogout logs the user out
func (oc *OAuthConfig) HandleLogout(w http.ResponseWriter, r *http.Request) {
	// Clear the session
	oc.SessionMgr.Destroy(w, r)

	// Redirect to landing page
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

// GetOAuthCredentials retrieves OAuth credentials from environment or 1Password
func GetOAuthCredentials() (clientID, clientSecret string, err error) {
	// Try environment variables first
	clientID = os.Getenv("GOOGLE_CLIENT_ID")
	clientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")

	if clientID != "" && clientSecret != "" {
		return clientID, clientSecret, nil
	}

	// If not in env, check if we should load from 1Password
	// For now, require env vars (we can add 1Password support later)
	if clientID == "" {
		return "", "", fmt.Errorf("GOOGLE_CLIENT_ID not set")
	}
	if clientSecret == "" {
		return "", "", fmt.Errorf("GOOGLE_CLIENT_SECRET not set")
	}

	return clientID, clientSecret, nil
}
