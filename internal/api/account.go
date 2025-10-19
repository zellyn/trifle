package api

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/zellyn/trifle/internal/db"
	"github.com/zellyn/trifle/internal/namegen"
)

// AccountHandlers contains all account-related HTTP handlers
type AccountHandlers struct {
	dbManager *db.Manager
}

// NewAccountHandlers creates a new AccountHandlers instance
func NewAccountHandlers(dbManager *db.Manager) *AccountHandlers {
	return &AccountHandlers{
		dbManager: dbManager,
	}
}

// NameSuggestion represents a single name suggestion
type NameSuggestion struct {
	Name string `json:"name"`
}

// NameSuggestionsResponse contains a list of name suggestions
type NameSuggestionsResponse struct {
	Suggestions []NameSuggestion `json:"suggestions"`
}

// SetAccountNameRequest represents the request body for setting account name
type SetAccountNameRequest struct {
	Name string `json:"name"`
}

// AccountResponse represents an account in API responses
type AccountResponse struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
}

// HandleGetNameSuggestions handles GET /api/account/name-suggestions
func (h *AccountHandlers) HandleGetNameSuggestions(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Generate 6 random name suggestions
	const numSuggestions = 6
	suggestions := make([]NameSuggestion, 0, numSuggestions)

	for i := 0; i < numSuggestions; i++ {
		name, err := namegen.Generate()
		if err != nil {
			slog.Error("Failed to generate name", "error", err)
			continue
		}
		suggestions = append(suggestions, NameSuggestion{Name: name})
	}

	if len(suggestions) == 0 {
		JSONInternalError(w, "Failed to generate name suggestions")
		return
	}

	response := NameSuggestionsResponse{
		Suggestions: suggestions,
	}

	JSONResponse(w, http.StatusOK, response)
}

// HandleSetAccountName handles POST /api/account/name
func (h *AccountHandlers) HandleSetAccountName(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Parse request body
	var req SetAccountNameRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONBadRequest(w, "Invalid request body")
		return
	}

	// Validate and parse name
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		JSONBadRequest(w, "Name is required")
		return
	}

	// Validate format: should be "adjective-noun"
	parts := strings.Split(req.Name, "-")
	if len(parts) != 2 {
		JSONBadRequest(w, "Name must be in format 'adjective-noun'")
		return
	}

	adjective := strings.TrimSpace(parts[0])
	noun := strings.TrimSpace(parts[1])

	if adjective == "" || noun == "" {
		JSONBadRequest(w, "Name must be in format 'adjective-noun'")
		return
	}

	// Validate that the words are from the valid lists
	if !isValidAdjective(adjective) {
		JSONBadRequest(w, "Invalid adjective")
		return
	}

	if !isValidNoun(noun) {
		JSONBadRequest(w, "Invalid noun")
		return
	}

	// Reconstruct name to ensure proper format
	normalizedName := adjective + "-" + noun

	// Check if name is already taken
	existingAccount, err := h.dbManager.GetAccountByDisplayName(r.Context(), normalizedName)
	if err != nil && err != sql.ErrNoRows {
		slog.Error("Failed to check name availability", "error", err)
		JSONInternalError(w, "Failed to check name availability")
		return
	}

	if existingAccount != nil && existingAccount.ID != session.AccountID {
		JSONBadRequest(w, "This name is already taken")
		return
	}

	// If it's the same as their current name, just return success
	if existingAccount != nil && existingAccount.ID == session.AccountID {
		account, err := h.dbManager.GetAccount(r.Context(), session.AccountID)
		if err != nil {
			slog.Error("Failed to get account", "error", err, "account_id", session.AccountID)
			JSONInternalError(w, "Failed to retrieve account")
			return
		}

		response := AccountResponse{
			ID:          account.ID,
			DisplayName: account.DisplayName,
			CreatedAt:   account.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt:   account.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}

		JSONResponse(w, http.StatusOK, response)
		return
	}

	// Update account name
	err = h.dbManager.UpdateAccountDisplayName(r.Context(), session.AccountID, normalizedName)
	if err != nil {
		// Check for uniqueness constraint violation
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			JSONBadRequest(w, "This name is already taken")
			return
		}
		slog.Error("Failed to update account name", "error", err, "account_id", session.AccountID)
		JSONInternalError(w, "Failed to update account name")
		return
	}

	// Get updated account
	account, err := h.dbManager.GetAccount(r.Context(), session.AccountID)
	if err != nil {
		slog.Error("Failed to get updated account", "error", err, "account_id", session.AccountID)
		JSONInternalError(w, "Failed to retrieve updated account")
		return
	}

	response := AccountResponse{
		ID:          account.ID,
		DisplayName: account.DisplayName,
		CreatedAt:   account.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   account.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	JSONResponse(w, http.StatusOK, response)
}

// isValidAdjective checks if a string is in the valid adjectives list
func isValidAdjective(adj string) bool {
	for _, valid := range namegen.Adjectives {
		if adj == valid {
			return true
		}
	}
	return false
}

// isValidNoun checks if a string is in the valid nouns list
func isValidNoun(noun string) bool {
	for _, valid := range namegen.Nouns {
		if noun == valid {
			return true
		}
	}
	return false
}
