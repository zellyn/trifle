package auth

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// Allowlist manages email access control
type Allowlist struct {
	patterns []string
}

// defaultAllowlist contains the default allowed patterns if file doesn't exist
var defaultAllowlist = []string{
	"zellyn@gmail.com",
	"@misstudent.com",
}

// NewAllowlist loads the allowlist from a file
// If the file doesn't exist, it creates it with default patterns
func NewAllowlist(filePath string) (*Allowlist, error) {
	// Ensure data directory exists
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		// Create file with defaults
		slog.Info("Allowlist file not found, creating with defaults", "path", filePath)
		if err := createDefaultAllowlist(filePath); err != nil {
			return nil, fmt.Errorf("failed to create default allowlist: %w", err)
		}
	}

	// Load patterns from file
	patterns, err := loadAllowlist(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to load allowlist: %w", err)
	}

	slog.Info("Allowlist loaded", "patterns", len(patterns), "path", filePath)
	for _, pattern := range patterns {
		slog.Info("  Allowed pattern", "pattern", pattern)
	}

	return &Allowlist{
		patterns: patterns,
	}, nil
}

// createDefaultAllowlist creates a new allowlist file with default patterns
func createDefaultAllowlist(filePath string) error {
	file, err := os.Create(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := bufio.NewWriter(file)
	for _, pattern := range defaultAllowlist {
		if _, err := writer.WriteString(pattern + "\n"); err != nil {
			return err
		}
	}
	return writer.Flush()
}

// loadAllowlist reads patterns from a file
func loadAllowlist(filePath string) ([]string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var patterns []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		patterns = append(patterns, line)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return patterns, nil
}

// IsAllowed checks if an email is allowed by the allowlist
func (a *Allowlist) IsAllowed(email string) bool {
	email = strings.ToLower(strings.TrimSpace(email))

	for _, pattern := range a.patterns {
		pattern = strings.ToLower(strings.TrimSpace(pattern))

		// Check for domain wildcard (e.g., "@anthropic.com")
		if strings.HasPrefix(pattern, "@") {
			domain := pattern // includes the @
			if strings.HasSuffix(email, domain) {
				return true
			}
		} else {
			// Exact email match
			if email == pattern {
				return true
			}
		}
	}

	return false
}
