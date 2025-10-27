package kv

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckAuth_EmailNormalization(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	handlers := NewHandlers(store)

	tests := []struct {
		name          string
		email         string
		key           string
		shouldSucceed bool
	}{
		{
			name:          "lowercase email matches lowercase key",
			email:         "alice@example.com",
			key:           "domain/example.com/user/alice/profile",
			shouldSucceed: true,
		},
		{
			name:          "uppercase email normalized to match lowercase key",
			email:         "Alice@Example.COM",
			key:           "domain/example.com/user/alice/profile",
			shouldSucceed: true,
		},
		{
			name:          "mixed case email normalized to match lowercase key",
			email:         "aLiCe@ExAmPlE.cOm",
			key:           "domain/example.com/user/alice/profile",
			shouldSucceed: true,
		},
		{
			name:          "email with plus addressing",
			email:         "alice+tag@example.com",
			key:           "domain/example.com/user/alice+tag/profile",
			shouldSucceed: true,
		},
		{
			name:          "different user should fail",
			email:         "alice@example.com",
			key:           "domain/example.com/user/bob/profile",
			shouldSucceed: false,
		},
		{
			name:          "different domain should fail",
			email:         "alice@example.com",
			key:           "domain/other.com/user/alice/profile",
			shouldSucceed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/kv/"+tt.key, nil)
			ctx := context.WithValue(req.Context(), "user_email", tt.email)
			req = req.WithContext(ctx)

			err := handlers.checkAuth(req, tt.key)

			if tt.shouldSucceed && err != nil {
				t.Errorf("Expected success but got error: %v", err)
			}
			if !tt.shouldSucceed && err == nil {
				t.Errorf("Expected error but got success")
			}
		})
	}
}

func TestCheckAuth_NewFormat(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	handlers := NewHandlers(store)

	tests := []struct {
		name          string
		email         string
		key           string
		shouldSucceed bool
	}{
		{
			name:          "valid profile key",
			email:         "zellyn@gmail.com",
			key:           "domain/gmail.com/user/zellyn/profile",
			shouldSucceed: true,
		},
		{
			name:          "valid trifle latest pointer",
			email:         "zellyn@gmail.com",
			key:           "domain/gmail.com/user/zellyn/trifle/latest/trifle_123/version_abc",
			shouldSucceed: true,
		},
		{
			name:          "valid trifle version",
			email:         "zellyn@gmail.com",
			key:           "domain/gmail.com/user/zellyn/trifle/version/version_abc",
			shouldSucceed: true,
		},
		{
			name:          "subdomain email",
			email:         "user@mail.company.example.com",
			key:           "domain/mail.company.example.com/user/user/profile",
			shouldSucceed: true,
		},
		{
			name:          "malformed key - too few segments",
			email:         "zellyn@gmail.com",
			key:           "domain/gmail.com/user",
			shouldSucceed: false,
		},
		{
			name:          "malformed key - wrong segment",
			email:         "zellyn@gmail.com",
			key:           "domain/gmail.com/admin/zellyn/profile",
			shouldSucceed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/kv/"+tt.key, nil)
			ctx := context.WithValue(req.Context(), "user_email", tt.email)
			req = req.WithContext(ctx)

			err := handlers.checkAuth(req, tt.key)

			if tt.shouldSucceed && err != nil {
				t.Errorf("Expected success but got error: %v", err)
			}
			if !tt.shouldSucceed && err == nil {
				t.Errorf("Expected error but got success")
			}
		})
	}
}

func TestCheckAuth_LegacyFormat(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	handlers := NewHandlers(store)

	tests := []struct {
		name          string
		email         string
		key           string
		shouldSucceed bool
	}{
		{
			name:          "valid legacy profile key",
			email:         "zellyn@gmail.com",
			key:           "user/zellyn@gmail.com/profile",
			shouldSucceed: true,
		},
		{
			name:          "legacy format with uppercase email normalized",
			email:         "Zellyn@Gmail.COM",
			key:           "user/zellyn@gmail.com/profile",
			shouldSucceed: true,
		},
		{
			name:          "valid legacy trifle key",
			email:         "zellyn@gmail.com",
			key:           "user/zellyn@gmail.com/trifle/latest/trifle_123/version_abc",
			shouldSucceed: true,
		},
		{
			name:          "different user should fail",
			email:         "alice@example.com",
			key:           "user/bob@example.com/profile",
			shouldSucceed: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/kv/"+tt.key, nil)
			ctx := context.WithValue(req.Context(), "user_email", tt.email)
			req = req.WithContext(ctx)

			err := handlers.checkAuth(req, tt.key)

			if tt.shouldSucceed && err != nil {
				t.Errorf("Expected success but got error: %v", err)
			}
			if !tt.shouldSucceed && err == nil {
				t.Errorf("Expected error but got success")
			}
		})
	}
}

func TestCheckAuth_FileKeys(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	handlers := NewHandlers(store)

	tests := []struct {
		name  string
		email string
		key   string
	}{
		{
			name:  "file key allowed without auth",
			email: "",
			key:   "file/ab/cd/abcd1234",
		},
		{
			name:  "file key allowed with auth",
			email: "zellyn@gmail.com",
			key:   "file/12/34/1234567890abcdef",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/kv/"+tt.key, nil)

			// Only add email to context if provided
			if tt.email != "" {
				ctx := context.WithValue(req.Context(), "user_email", tt.email)
				req = req.WithContext(ctx)
			}

			err := handlers.checkAuth(req, tt.key)

			// File keys should always succeed
			if err != nil {
				t.Errorf("File key should be allowed but got error: %v", err)
			}
		})
	}
}

func TestCheckAuth_InvalidEmail(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	handlers := NewHandlers(store)

	tests := []struct {
		name  string
		email string
		key   string
	}{
		{
			name:  "email missing @",
			email: "notanemail",
			key:   "domain/example.com/user/test/profile",
		},
		{
			name:  "email starts with @",
			email: "@example.com",
			key:   "domain/example.com/user/test/profile",
		},
		{
			name:  "email ends with @",
			email: "user@",
			key:   "domain/example.com/user/test/profile",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/kv/"+tt.key, nil)
			ctx := context.WithValue(req.Context(), "user_email", tt.email)
			req = req.WithContext(ctx)

			err := handlers.checkAuth(req, tt.key)

			// All invalid emails should fail
			if err == nil {
				t.Errorf("Expected error for invalid email format but got success")
			}
		})
	}
}

func TestCheckAuth_UnknownPrefix(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	handlers := NewHandlers(store)

	req := httptest.NewRequest(http.MethodGet, "/kv/unknown/path", nil)
	ctx := context.WithValue(req.Context(), "user_email", "zellyn@gmail.com")
	req = req.WithContext(ctx)

	err = handlers.checkAuth(req, "unknown/path")

	if err == nil {
		t.Errorf("Expected error for unknown prefix but got success")
	}
}

func TestCheckAuth_NotAuthenticated(t *testing.T) {
	store, err := NewStore(t.TempDir())
	if err != nil {
		t.Fatalf("Failed to create store: %v", err)
	}
	handlers := NewHandlers(store)

	tests := []struct {
		name string
		key  string
	}{
		{
			name: "new format requires auth",
			key:  "domain/gmail.com/user/zellyn/profile",
		},
		{
			name: "legacy format requires auth",
			key:  "user/zellyn@gmail.com/profile",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/kv/"+tt.key, nil)
			// No user_email in context - not authenticated

			err := handlers.checkAuth(req, tt.key)

			if err == nil {
				t.Errorf("Expected authentication error but got success")
			}
		})
	}
}
