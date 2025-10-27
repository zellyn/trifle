package kv

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
)

// Handlers provides HTTP handlers for KV operations
type Handlers struct {
	store *Store
}

// NewHandlers creates a new KV handlers instance
func NewHandlers(store *Store) *Handlers {
	return &Handlers{store: store}
}

// HandleKV handles GET, PUT, DELETE, HEAD for /kv/{key}
func (h *Handlers) HandleKV(w http.ResponseWriter, r *http.Request) {
	// Extract key from path
	key := strings.TrimPrefix(r.URL.Path, "/kv/")
	if key == "" {
		http.Error(w, "Key required", http.StatusBadRequest)
		return
	}

	// Check authorization
	if err := h.checkAuth(r, key); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.handleGet(w, r, key)
	case http.MethodPut:
		h.handlePut(w, r, key)
	case http.MethodDelete:
		h.handleDelete(w, r, key)
	case http.MethodHead:
		h.handleHead(w, r, key)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// HandleList handles GET /kvlist/{prefix}
func (h *Handlers) HandleList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract prefix from path
	prefix := strings.TrimPrefix(r.URL.Path, "/kvlist/")

	// Check authorization for prefix
	if err := h.checkAuth(r, prefix); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}

	// Parse query parameters
	depthStr := r.URL.Query().Get("depth")
	recursiveStr := r.URL.Query().Get("recursive")

	var depth int
	var recursive bool

	if recursiveStr == "true" {
		recursive = true
	} else if depthStr != "" {
		var err error
		depth, err = strconv.Atoi(depthStr)
		if err != nil || depth < 1 {
			http.Error(w, "Invalid depth parameter", http.StatusBadRequest)
			return
		}
	} else {
		// Default to depth=1
		depth = 1
	}

	// List keys
	keys, err := h.store.List(prefix, depth, recursive)
	if err != nil {
		slog.Error("Failed to list keys", "error", err, "prefix", prefix)
		http.Error(w, "Failed to list keys", http.StatusInternalServerError)
		return
	}

	// Return as JSON array
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(keys)
}

// handleGet retrieves a value
func (h *Handlers) handleGet(w http.ResponseWriter, r *http.Request, key string) {
	value, err := h.store.Get(key)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, "Not found", http.StatusNotFound)
		} else {
			slog.Error("Failed to get key", "error", err, "key", key)
			http.Error(w, "Internal error", http.StatusInternalServerError)
		}
		return
	}

	// Return raw bytes
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Write(value)
}

// handlePut stores a value
func (h *Handlers) handlePut(w http.ResponseWriter, r *http.Request, key string) {
	// Read request body (raw bytes)
	value, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	// Special case: file/* keys are idempotent
	if strings.HasPrefix(key, "file/") {
		// If key exists, just return success (content-addressed storage)
		if h.store.Exists(key) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("OK"))
			return
		}
	}

	// Store value
	if err := h.store.Put(key, value); err != nil {
		slog.Error("Failed to put key", "error", err, "key", key)
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// handleDelete deletes a key or prefix
func (h *Handlers) handleDelete(w http.ResponseWriter, r *http.Request, key string) {
	if err := h.store.Delete(key); err != nil {
		if strings.Contains(err.Error(), "not found") {
			http.Error(w, "Not found", http.StatusNotFound)
		} else {
			slog.Error("Failed to delete key", "error", err, "key", key)
			http.Error(w, "Internal error", http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// handleHead checks if a key exists
func (h *Handlers) handleHead(w http.ResponseWriter, r *http.Request, key string) {
	if h.store.Exists(key) {
		w.WriteHeader(http.StatusOK)
	} else {
		w.WriteHeader(http.StatusNotFound)
	}
}

// checkAuth verifies the user has permission to access a key
func (h *Handlers) checkAuth(r *http.Request, key string) error {
	// Allow file/* to everyone (content-addressed, public)
	if strings.HasPrefix(key, "file/") {
		return nil
	}

	// Get user email from context (set by auth middleware)
	email, ok := r.Context().Value("user_email").(string)
	if !ok {
		return fmt.Errorf("not authenticated")
	}

	// Normalize email to lowercase for consistent key generation
	email = strings.ToLower(email)

	// Parse email into domain and localpart
	atIndex := strings.LastIndex(email, "@")
	if atIndex == -1 || atIndex == 0 || atIndex == len(email)-1 {
		return fmt.Errorf("invalid email format")
	}
	localpart := email[:atIndex]
	domain := email[atIndex+1:]

	// For domain/* keys: domain/{domain}/user/{localpart}/...
	if strings.HasPrefix(key, "domain/") {
		// Extract domain and localpart from key
		parts := strings.SplitN(key, "/", 5)
		if len(parts) < 4 {
			return fmt.Errorf("invalid key format")
		}

		keyDomain := parts[1]
		if parts[2] != "user" {
			return fmt.Errorf("invalid key format: expected 'user' segment")
		}
		keyLocalpart := parts[3]

		if keyDomain != domain || keyLocalpart != localpart {
			return fmt.Errorf("access denied: cannot access other user's data")
		}

		return nil
	}

	// For user/* keys (legacy format), check email matches
	if strings.HasPrefix(key, "user/") {
		// Extract email from key: user/{email}/...
		parts := strings.SplitN(key, "/", 3)
		if len(parts) < 2 {
			return fmt.Errorf("invalid key format")
		}

		keyEmail := parts[1]
		if keyEmail != email {
			return fmt.Errorf("access denied: cannot access other user's data")
		}

		return nil
	}

	// Unknown prefix - deny by default
	return fmt.Errorf("access denied: unknown key prefix")
}
