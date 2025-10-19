package db

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

// ID prefix constants for type safety
const (
	PrefixLogin         = "login"
	PrefixAccount       = "account"
	PrefixAccountMember = "acctmember"
	PrefixTrifle        = "trifle"
	PrefixFile          = "file"
)

// ID length constants (in hex characters, not including prefix)
const (
	LoginIDLength         = 12 // 6 bytes = 12 hex chars
	AccountIDLength       = 12 // 6 bytes = 12 hex chars
	AccountMemberIDLength = 12 // 6 bytes = 12 hex chars
	TrifleIDLength        = 16 // 8 bytes = 16 hex chars
	FileIDLength          = 12 // 6 bytes = 12 hex chars
)

// GenerateID creates a new random ID with the given prefix and length.
// Length is in hex characters (each byte = 2 hex chars).
func GenerateID(prefix string, hexLength int) (string, error) {
	if hexLength%2 != 0 {
		return "", fmt.Errorf("hex length must be even")
	}

	numBytes := hexLength / 2
	randomBytes := make([]byte, numBytes)

	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("failed to generate random bytes: %w", err)
	}

	hexStr := hex.EncodeToString(randomBytes)
	return fmt.Sprintf("%s_%s", prefix, hexStr), nil
}

// NewLoginID generates a new login ID
func NewLoginID() (string, error) {
	return GenerateID(PrefixLogin, LoginIDLength)
}

// NewAccountID generates a new account ID
func NewAccountID() (string, error) {
	return GenerateID(PrefixAccount, AccountIDLength)
}

// NewAccountMemberID generates a new account member ID
func NewAccountMemberID() (string, error) {
	return GenerateID(PrefixAccountMember, AccountMemberIDLength)
}

// NewTrifleID generates a new trifle ID
func NewTrifleID() (string, error) {
	return GenerateID(PrefixTrifle, TrifleIDLength)
}

// NewFileID generates a new file ID
func NewFileID() (string, error) {
	return GenerateID(PrefixFile, FileIDLength)
}

// ValidateID checks if an ID has the correct prefix and format
func ValidateID(id, expectedPrefix string) error {
	parts := strings.SplitN(id, "_", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid ID format: missing underscore separator")
	}

	prefix, hexPart := parts[0], parts[1]

	if prefix != expectedPrefix {
		return fmt.Errorf("invalid ID prefix: expected %s, got %s", expectedPrefix, prefix)
	}

	// Validate hex string
	if _, err := hex.DecodeString(hexPart); err != nil {
		return fmt.Errorf("invalid ID: hex part is not valid hex: %w", err)
	}

	return nil
}

// ValidateLoginID validates a login ID
func ValidateLoginID(id string) error {
	return ValidateID(id, PrefixLogin)
}

// ValidateAccountID validates an account ID
func ValidateAccountID(id string) error {
	return ValidateID(id, PrefixAccount)
}

// ValidateAccountMemberID validates an account member ID
func ValidateAccountMemberID(id string) error {
	return ValidateID(id, PrefixAccountMember)
}

// ValidateTrifleID validates a trifle ID
func ValidateTrifleID(id string) error {
	return ValidateID(id, PrefixTrifle)
}

// ValidateFileID validates a file ID
func ValidateFileID(id string) error {
	return ValidateID(id, PrefixFile)
}
