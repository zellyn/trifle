package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var embedMigrations embed.FS

// Manager handles all database operations through a single goroutine
type Manager struct {
	db      *sql.DB
	queries *Queries
	reqCh   chan dbRequest
	closeCh chan struct{}
	wg      sync.WaitGroup
}

// dbRequest represents a database operation request
type dbRequest struct {
	fn     func(*sql.DB, *Queries) (interface{}, error)
	respCh chan dbResponse
}

// dbResponse contains the result of a database operation
type dbResponse struct {
	result interface{}
	err    error
}

// NewManager creates a new database manager and starts the worker goroutine
func NewManager(dbPath string) (*Manager, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool
	// SQLite doesn't benefit from many connections since it's single-writer
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(time.Hour)

	// Enable foreign keys (disabled by default in SQLite)
	if _, err := db.Exec("PRAGMA foreign_keys = ON"); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to enable foreign keys: %w", err)
	}

	// Run migrations
	goose.SetBaseFS(embedMigrations)
	if err := goose.SetDialect("sqlite3"); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to set goose dialect: %w", err)
	}

	if err := goose.Up(db, "migrations"); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	queries := New(db)

	m := &Manager{
		db:      db,
		queries: queries,
		reqCh:   make(chan dbRequest, 100), // Buffer for performance
		closeCh: make(chan struct{}),
	}

	// Start the worker goroutine
	m.wg.Add(1)
	go m.worker()

	return m, nil
}

// worker is the single goroutine that handles all database operations
func (m *Manager) worker() {
	defer m.wg.Done()

	for {
		select {
		case req := <-m.reqCh:
			result, err := req.fn(m.db, m.queries)
			req.respCh <- dbResponse{result: result, err: err}
		case <-m.closeCh:
			return
		}
	}
}

// execute sends a request to the worker goroutine and waits for the response
// It respects context cancellation
func (m *Manager) execute(ctx context.Context, fn func(*sql.DB, *Queries) (interface{}, error)) (interface{}, error) {
	respCh := make(chan dbResponse, 1)
	req := dbRequest{
		fn:     fn,
		respCh: respCh,
	}

	select {
	case m.reqCh <- req:
		// Request sent successfully
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	select {
	case resp := <-respCh:
		return resp.result, resp.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Close shuts down the database manager and waits for in-flight requests to complete
func (m *Manager) Close() error {
	close(m.closeCh)
	m.wg.Wait() // Wait for worker goroutine to finish
	return m.db.Close()
}

// Example methods - these demonstrate how to use the manager pattern
// More methods will be added as needed

// GetLoginByGoogleID retrieves a login by Google ID
func (m *Manager) GetLoginByGoogleID(ctx context.Context, googleID string) (*Login, error) {
	result, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		login, err := q.GetLoginByGoogleID(ctx, googleID)
		if err != nil {
			return nil, err
		}
		return &login, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*Login), nil
}

// CreateLogin creates a new login
func (m *Manager) CreateLogin(ctx context.Context, id, googleID, email, name string) error {
	_, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		err := q.CreateLogin(ctx, CreateLoginParams{
			ID:       id,
			GoogleID: googleID,
			Email:    email,
			Name:     name,
		})
		return nil, err
	})
	return err
}

// CreateAccount creates a new account
func (m *Manager) CreateAccount(ctx context.Context, id, displayName string) error {
	_, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		err := q.CreateAccount(ctx, CreateAccountParams{
			ID:          id,
			DisplayName: displayName,
		})
		return nil, err
	})
	return err
}

// CreateAccountMember creates a new account member
func (m *Manager) CreateAccountMember(ctx context.Context, id, accountID, loginID, role string) error {
	_, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		err := q.CreateAccountMember(ctx, CreateAccountMemberParams{
			ID:        id,
			AccountID: accountID,
			LoginID:   loginID,
			Role:      role,
		})
		return nil, err
	})
	return err
}

// CheckEmailAllowlist checks if an email is on the allowlist
func (m *Manager) CheckEmailAllowlist(ctx context.Context, email string) (bool, error) {
	result, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		return q.CheckEmailAllowlist(ctx, CheckEmailAllowlistParams{
			Pattern:   email,
			Pattern_2: email,
		})
	})
	if err != nil {
		return false, err
	}
	count := result.(int64)
	return count > 0, nil
}

// GetAccountMembersByLoginID gets all account members for a login
func (m *Manager) GetAccountMembersByLoginID(ctx context.Context, loginID string) ([]AccountMember, error) {
	result, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		return q.GetAccountMembersByLoginID(ctx, loginID)
	})
	if err != nil {
		return nil, err
	}
	return result.([]AccountMember), nil
}

// GetAccount gets an account by ID
func (m *Manager) GetAccount(ctx context.Context, accountID string) (*Account, error) {
	result, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		account, err := q.GetAccount(ctx, accountID)
		if err != nil {
			return nil, err
		}
		return &account, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*Account), nil
}

// GetAccountByDisplayName gets an account by display name
func (m *Manager) GetAccountByDisplayName(ctx context.Context, displayName string) (*Account, error) {
	result, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		account, err := q.GetAccountByDisplayName(ctx, displayName)
		if err != nil {
			return nil, err
		}
		return &account, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*Account), nil
}

// ListTriflesByAccountID lists all trifles for an account
func (m *Manager) ListTriflesByAccountID(ctx context.Context, accountID string) ([]Trifle, error) {
	result, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		return q.ListTriflesByAccountID(ctx, accountID)
	})
	if err != nil {
		return nil, err
	}
	return result.([]Trifle), nil
}

// CreateTrifle creates a new trifle
func (m *Manager) CreateTrifle(ctx context.Context, id, accountID, title, description string, parentID sql.NullString) error {
	_, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		err := q.CreateTrifle(ctx, CreateTrifleParams{
			ID:          id,
			AccountID:   accountID,
			Title:       title,
			Description: sql.NullString{String: description, Valid: description != ""},
			ParentID:    parentID,
		})
		return nil, err
	})
	return err
}

// GetTrifle gets a trifle by ID
func (m *Manager) GetTrifle(ctx context.Context, trifleID string) (*Trifle, error) {
	result, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		trifle, err := q.GetTrifle(ctx, trifleID)
		if err != nil {
			return nil, err
		}
		return &trifle, nil
	})
	if err != nil {
		return nil, err
	}
	return result.(*Trifle), nil
}

// ListTrifleFilesByTrifleID lists all files in a trifle
func (m *Manager) ListTrifleFilesByTrifleID(ctx context.Context, trifleID string) ([]TrifleFile, error) {
	result, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		return q.ListTrifleFilesByTrifleID(ctx, trifleID)
	})
	if err != nil {
		return nil, err
	}
	return result.([]TrifleFile), nil
}

// CreateTrifleFile creates a new file in a trifle
func (m *Manager) CreateTrifleFile(ctx context.Context, id, trifleID, path, content string) error {
	_, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		err := q.CreateTrifleFile(ctx, CreateTrifleFileParams{
			ID:       id,
			TrifleID: trifleID,
			Path:     path,
			Content:  content,
		})
		return nil, err
	})
	return err
}

// UpdateTrifleFileByPath updates a file's content by path
func (m *Manager) UpdateTrifleFileByPath(ctx context.Context, trifleID, path, content string) error {
	_, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		err := q.UpdateTrifleFileByPath(ctx, UpdateTrifleFileByPathParams{
			Content:  content,
			TrifleID: trifleID,
			Path:     path,
		})
		return nil, err
	})
	return err
}

// Transaction executes multiple operations in a transaction
func (m *Manager) Transaction(ctx context.Context, fn func(*sql.Tx, *Queries) error) error {
	_, err := m.execute(ctx, func(db *sql.DB, q *Queries) (interface{}, error) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return nil, err
		}

		qtx := q.WithTx(tx)

		err = fn(tx, qtx)
		if err != nil {
			if rbErr := tx.Rollback(); rbErr != nil {
				log.Printf("rollback error: %v (original error: %v)", rbErr, err)
			}
			return nil, err
		}

		if err := tx.Commit(); err != nil {
			return nil, err
		}

		return nil, nil
	})
	return err
}
