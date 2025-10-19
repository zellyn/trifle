package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

// generateRandomString generates a cryptographically random string of the specified length (in bytes)
func generateRandomString(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("failed to generate random string: %w", err)
	}
	return base64.URLEncoding.EncodeToString(bytes), nil
}
