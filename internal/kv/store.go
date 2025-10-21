// Package kv provides a simple file-based key-value store.
// Keys map directly to filesystem paths with slashes as directory separators.
package kv

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Store manages key-value storage operations
type Store struct {
	dataDir string
}

// NewStore creates a new KV store instance
func NewStore(dataDir string) (*Store, error) {
	// Ensure data directory exists
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create data directory: %w", err)
	}

	return &Store{
		dataDir: dataDir,
	}, nil
}

// keyPath converts a key to a filesystem path
// key "user/alice@example.com/profile" -> "data/user/alice@example.com/profile"
func (s *Store) keyPath(key string) (string, error) {
	// Validate key doesn't escape data directory
	if strings.Contains(key, "..") {
		return "", fmt.Errorf("invalid key: contains '..'")
	}
	if strings.HasPrefix(key, "/") {
		return "", fmt.Errorf("invalid key: starts with '/'")
	}

	return filepath.Join(s.dataDir, key), nil
}

// Get retrieves a value by key
func (s *Store) Get(key string) ([]byte, error) {
	path, err := s.keyPath(key)
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("key not found: %s", key)
		}
		return nil, fmt.Errorf("failed to read key: %w", err)
	}

	return data, nil
}

// Put stores a value by key (upsert)
func (s *Store) Put(key string, value []byte) error {
	path, err := s.keyPath(key)
	if err != nil {
		return err
	}

	// Create parent directories
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("failed to create directories: %w", err)
	}

	// Write value
	if err := os.WriteFile(path, value, 0644); err != nil {
		return fmt.Errorf("failed to write key: %w", err)
	}

	return nil
}

// Delete removes a key and all its descendants (if it's a prefix)
func (s *Store) Delete(key string) error {
	path, err := s.keyPath(key)
	if err != nil {
		return err
	}

	// Check if path exists
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("key not found: %s", key)
		}
		return fmt.Errorf("failed to stat key: %w", err)
	}

	// If it's a directory, remove recursively
	if info.IsDir() {
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("failed to delete prefix: %w", err)
		}
	} else {
		// Single file
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("failed to delete key: %w", err)
		}
	}

	return nil
}

// Exists checks if a key exists
func (s *Store) Exists(key string) bool {
	path, err := s.keyPath(key)
	if err != nil {
		return false
	}

	_, err = os.Stat(path)
	return err == nil
}

// List returns keys matching a prefix
func (s *Store) List(prefix string, depth int, recursive bool) ([]string, error) {
	prefixPath, err := s.keyPath(prefix)
	if err != nil {
		return nil, err
	}

	// Check if prefix exists
	if _, err := os.Stat(prefixPath); os.IsNotExist(err) {
		// Prefix doesn't exist - return empty list
		return []string{}, nil
	}

	var keys []string

	if recursive {
		// Walk entire tree under prefix
		err = filepath.Walk(prefixPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}

			// Skip directories, only return files (actual keys)
			if info.IsDir() {
				return nil
			}

			// Convert filesystem path back to key
			relPath, err := filepath.Rel(s.dataDir, path)
			if err != nil {
				return err
			}

			keys = append(keys, relPath)
			return nil
		})
	} else {
		// Walk with depth limit
		err = s.walkWithDepth(prefixPath, 0, depth, func(path string, info os.FileInfo) error {
			// Skip directories, only return files
			if info.IsDir() {
				return nil
			}

			// Convert filesystem path back to key
			relPath, err := filepath.Rel(s.dataDir, path)
			if err != nil {
				return err
			}

			keys = append(keys, relPath)
			return nil
		})
	}

	if err != nil {
		return nil, fmt.Errorf("failed to list keys: %w", err)
	}

	return keys, nil
}

// walkWithDepth walks a directory tree up to a specified depth
func (s *Store) walkWithDepth(root string, currentDepth, maxDepth int, fn func(string, os.FileInfo) error) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		path := filepath.Join(root, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Call function for this entry
		if err := fn(path, info); err != nil {
			return err
		}

		// Recurse into directories if we haven't hit depth limit
		if entry.IsDir() && currentDepth < maxDepth {
			if err := s.walkWithDepth(path, currentDepth+1, maxDepth, fn); err != nil {
				return err
			}
		}
	}

	return nil
}
