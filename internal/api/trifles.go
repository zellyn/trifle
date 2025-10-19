package api

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/zellyn/trifle/internal/db"
)

// TrifleResponse represents a trifle in API responses
type TrifleResponse struct {
	ID          string              `json:"id"`
	AccountID   string              `json:"account_id"`
	Title       string              `json:"title"`
	Description string              `json:"description,omitempty"`
	ParentID    string              `json:"parent_id,omitempty"`
	CreatedAt   string              `json:"created_at"`
	UpdatedAt   string              `json:"updated_at"`
	Files       []TrifleFileResponse `json:"files,omitempty"`
}

// TrifleFileResponse represents a file in API responses
type TrifleFileResponse struct {
	ID        string `json:"id"`
	TrifleID  string `json:"trifle_id"`
	Path      string `json:"path"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// CreateTrifleRequest represents the request body for creating a trifle
type CreateTrifleRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

// UpdateTrifleRequest represents the request body for updating a trifle
type UpdateTrifleRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

// CreateFileRequest represents the request body for creating a file
type CreateFileRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// BatchUpdateFilesRequest represents the request body for batch updating files
type BatchUpdateFilesRequest struct {
	Files []FileUpdate `json:"files"`
}

// FileUpdate represents a single file update in a batch operation
type FileUpdate struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// TrifleHandlers contains all trifle-related HTTP handlers
type TrifleHandlers struct {
	dbManager *db.Manager
}

// NewTrifleHandlers creates a new TrifleHandlers instance
func NewTrifleHandlers(dbManager *db.Manager) *TrifleHandlers {
	return &TrifleHandlers{
		dbManager: dbManager,
	}
}

// HandleListTrifles handles GET /api/trifles
func (h *TrifleHandlers) HandleListTrifles(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Get all trifles for the user's account
	trifles, err := h.dbManager.ListTriflesByAccountID(r.Context(), session.AccountID)
	if err != nil {
		slog.Error("Failed to list trifles", "error", err, "account_id", session.AccountID)
		JSONInternalError(w, "Failed to retrieve trifles")
		return
	}

	// Convert to response format
	response := make([]TrifleResponse, len(trifles))
	for i, t := range trifles {
		response[i] = TrifleResponse{
			ID:          t.ID,
			AccountID:   t.AccountID,
			Title:       t.Title,
			Description: t.Description.String,
			ParentID:    t.ParentID.String,
			CreatedAt:   t.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt:   t.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	JSONResponse(w, http.StatusOK, response)
}

// HandleCreateTrifle handles POST /api/trifles
func (h *TrifleHandlers) HandleCreateTrifle(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Parse request body
	var req CreateTrifleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONBadRequest(w, "Invalid request body")
		return
	}

	// Validate input
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		JSONBadRequest(w, "Title is required")
		return
	}
	if len(req.Title) > 200 {
		JSONBadRequest(w, "Title must be 200 characters or less")
		return
	}

	// Generate ID
	trifleID, err := db.NewTrifleID()
	if err != nil {
		slog.Error("Failed to generate trifle ID", "error", err)
		JSONInternalError(w, "Failed to create trifle")
		return
	}

	// Create trifle
	err = h.dbManager.CreateTrifle(r.Context(), trifleID, session.AccountID, req.Title, req.Description, sql.NullString{})
	if err != nil {
		slog.Error("Failed to create trifle", "error", err, "account_id", session.AccountID)
		JSONInternalError(w, "Failed to create trifle")
		return
	}

	// Return the created trifle
	trifle, err := h.dbManager.GetTrifle(r.Context(), trifleID)
	if err != nil {
		slog.Error("Failed to get created trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve created trifle")
		return
	}

	response := TrifleResponse{
		ID:          trifle.ID,
		AccountID:   trifle.AccountID,
		Title:       trifle.Title,
		Description: trifle.Description.String,
		ParentID:    trifle.ParentID.String,
		CreatedAt:   trifle.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   trifle.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	JSONResponse(w, http.StatusCreated, response)
}

// HandleGetTrifle handles GET /api/trifles/:id
func (h *TrifleHandlers) HandleGetTrifle(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Extract trifle ID from path
	trifleID := strings.TrimPrefix(r.URL.Path, "/api/trifles/")
	if trifleID == "" || trifleID == r.URL.Path {
		JSONBadRequest(w, "Invalid trifle ID")
		return
	}

	// Get trifle
	trifle, err := h.dbManager.GetTrifle(r.Context(), trifleID)
	if err == sql.ErrNoRows {
		JSONNotFound(w, "Trifle not found")
		return
	}
	if err != nil {
		slog.Error("Failed to get trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve trifle")
		return
	}

	// Verify ownership
	if trifle.AccountID != session.AccountID {
		JSONForbidden(w, "Access denied")
		return
	}

	// Get all files for this trifle
	files, err := h.dbManager.ListTrifleFilesByTrifleID(r.Context(), trifleID)
	if err != nil {
		slog.Error("Failed to get trifle files", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve trifle files")
		return
	}

	// Convert files to response format
	fileResponses := make([]TrifleFileResponse, len(files))
	for i, f := range files {
		fileResponses[i] = TrifleFileResponse{
			ID:        f.ID,
			TrifleID:  f.TrifleID,
			Path:      f.Path,
			Content:   f.Content,
			CreatedAt: f.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt: f.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	response := TrifleResponse{
		ID:          trifle.ID,
		AccountID:   trifle.AccountID,
		Title:       trifle.Title,
		Description: trifle.Description.String,
		ParentID:    trifle.ParentID.String,
		CreatedAt:   trifle.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   trifle.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		Files:       fileResponses,
	}

	JSONResponse(w, http.StatusOK, response)
}

// HandleUpdateTrifle handles PUT /api/trifles/:id
func (h *TrifleHandlers) HandleUpdateTrifle(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Extract trifle ID from path
	trifleID := strings.TrimPrefix(r.URL.Path, "/api/trifles/")
	if trifleID == "" || trifleID == r.URL.Path {
		JSONBadRequest(w, "Invalid trifle ID")
		return
	}

	// Parse request body
	var req UpdateTrifleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONBadRequest(w, "Invalid request body")
		return
	}

	// Validate input
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		JSONBadRequest(w, "Title is required")
		return
	}
	if len(req.Title) > 200 {
		JSONBadRequest(w, "Title must be 200 characters or less")
		return
	}

	// Get trifle to verify ownership
	trifle, err := h.dbManager.GetTrifle(r.Context(), trifleID)
	if err == sql.ErrNoRows {
		JSONNotFound(w, "Trifle not found")
		return
	}
	if err != nil {
		slog.Error("Failed to get trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve trifle")
		return
	}

	// Verify ownership
	if trifle.AccountID != session.AccountID {
		JSONForbidden(w, "Access denied")
		return
	}

	// Update trifle
	err = h.dbManager.UpdateTrifle(r.Context(), trifleID, req.Title, req.Description)
	if err != nil {
		slog.Error("Failed to update trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to update trifle")
		return
	}

	// Get updated trifle
	trifle, err = h.dbManager.GetTrifle(r.Context(), trifleID)
	if err != nil {
		slog.Error("Failed to get updated trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve updated trifle")
		return
	}

	response := TrifleResponse{
		ID:          trifle.ID,
		AccountID:   trifle.AccountID,
		Title:       trifle.Title,
		Description: trifle.Description.String,
		ParentID:    trifle.ParentID.String,
		CreatedAt:   trifle.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:   trifle.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	JSONResponse(w, http.StatusOK, response)
}

// HandleDeleteTrifle handles DELETE /api/trifles/:id
func (h *TrifleHandlers) HandleDeleteTrifle(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Extract trifle ID from path
	trifleID := strings.TrimPrefix(r.URL.Path, "/api/trifles/")
	if trifleID == "" || trifleID == r.URL.Path {
		JSONBadRequest(w, "Invalid trifle ID")
		return
	}

	// Get trifle to verify ownership
	trifle, err := h.dbManager.GetTrifle(r.Context(), trifleID)
	if err == sql.ErrNoRows {
		JSONNotFound(w, "Trifle not found")
		return
	}
	if err != nil {
		slog.Error("Failed to get trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve trifle")
		return
	}

	// Verify ownership
	if trifle.AccountID != session.AccountID {
		JSONForbidden(w, "Access denied")
		return
	}

	// Delete trifle (will cascade to files)
	err = h.dbManager.DeleteTrifle(r.Context(), trifleID)
	if err != nil {
		slog.Error("Failed to delete trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to delete trifle")
		return
	}

	// Return success with no content
	w.WriteHeader(http.StatusNoContent)
}

// HandleListFiles handles GET /api/trifles/:id/files
func (h *TrifleHandlers) HandleListFiles(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Extract trifle ID from path (remove "/api/trifles/" and "/files")
	path := strings.TrimPrefix(r.URL.Path, "/api/trifles/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 2 || parts[0] == "" {
		JSONBadRequest(w, "Invalid trifle ID")
		return
	}
	trifleID := parts[0]

	// Get trifle to verify ownership
	trifle, err := h.dbManager.GetTrifle(r.Context(), trifleID)
	if err == sql.ErrNoRows {
		JSONNotFound(w, "Trifle not found")
		return
	}
	if err != nil {
		slog.Error("Failed to get trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve trifle")
		return
	}

	// Verify ownership
	if trifle.AccountID != session.AccountID {
		JSONForbidden(w, "Access denied")
		return
	}

	// Get all files
	files, err := h.dbManager.ListTrifleFilesByTrifleID(r.Context(), trifleID)
	if err != nil {
		slog.Error("Failed to list files", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve files")
		return
	}

	// Convert to response format
	response := make([]TrifleFileResponse, len(files))
	for i, f := range files {
		response[i] = TrifleFileResponse{
			ID:        f.ID,
			TrifleID:  f.TrifleID,
			Path:      f.Path,
			Content:   f.Content,
			CreatedAt: f.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt: f.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	JSONResponse(w, http.StatusOK, response)
}

// HandleCreateFile handles POST /api/trifles/:id/files
func (h *TrifleHandlers) HandleCreateFile(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Extract trifle ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/trifles/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 2 || parts[0] == "" {
		JSONBadRequest(w, "Invalid trifle ID")
		return
	}
	trifleID := parts[0]

	// Parse request body
	var req CreateFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONBadRequest(w, "Invalid request body")
		return
	}

	// Validate input
	req.Path = strings.TrimSpace(req.Path)
	if req.Path == "" {
		JSONBadRequest(w, "File path is required")
		return
	}

	// Basic path validation (prevent directory traversal, etc.)
	if strings.Contains(req.Path, "..") || strings.HasPrefix(req.Path, "/") {
		JSONBadRequest(w, "Invalid file path")
		return
	}

	// Get trifle to verify ownership
	trifle, err := h.dbManager.GetTrifle(r.Context(), trifleID)
	if err == sql.ErrNoRows {
		JSONNotFound(w, "Trifle not found")
		return
	}
	if err != nil {
		slog.Error("Failed to get trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve trifle")
		return
	}

	// Verify ownership
	if trifle.AccountID != session.AccountID {
		JSONForbidden(w, "Access denied")
		return
	}

	// Generate file ID
	fileID, err := db.NewFileID()
	if err != nil {
		slog.Error("Failed to generate file ID", "error", err)
		JSONInternalError(w, "Failed to create file")
		return
	}

	// Create file
	err = h.dbManager.CreateTrifleFile(r.Context(), fileID, trifleID, req.Path, req.Content)
	if err != nil {
		// Check if it's a duplicate path error
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			JSONBadRequest(w, "A file with this path already exists")
			return
		}
		slog.Error("Failed to create file", "error", err, "trifle_id", trifleID, "path", req.Path)
		JSONInternalError(w, "Failed to create file")
		return
	}

	// Get the created file (we could optimize this by constructing the response directly)
	files, err := h.dbManager.ListTrifleFilesByTrifleID(r.Context(), trifleID)
	if err != nil {
		slog.Error("Failed to get created file", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve created file")
		return
	}

	// Find the file we just created
	var createdFile *db.TrifleFile
	for _, f := range files {
		if f.ID == fileID {
			createdFile = &f
			break
		}
	}

	if createdFile == nil {
		slog.Error("Created file not found", "file_id", fileID)
		JSONInternalError(w, "Failed to retrieve created file")
		return
	}

	response := TrifleFileResponse{
		ID:        createdFile.ID,
		TrifleID:  createdFile.TrifleID,
		Path:      createdFile.Path,
		Content:   createdFile.Content,
		CreatedAt: createdFile.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: createdFile.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}

	JSONResponse(w, http.StatusCreated, response)
}

// HandleBatchUpdateFiles handles PUT /api/trifles/:id/files
func (h *TrifleHandlers) HandleBatchUpdateFiles(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Extract trifle ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/trifles/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 2 || parts[0] == "" {
		JSONBadRequest(w, "Invalid trifle ID")
		return
	}
	trifleID := parts[0]

	// Parse request body
	var req BatchUpdateFilesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		JSONBadRequest(w, "Invalid request body")
		return
	}

	// Get trifle to verify ownership
	trifle, err := h.dbManager.GetTrifle(r.Context(), trifleID)
	if err == sql.ErrNoRows {
		JSONNotFound(w, "Trifle not found")
		return
	}
	if err != nil {
		slog.Error("Failed to get trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve trifle")
		return
	}

	// Verify ownership
	if trifle.AccountID != session.AccountID {
		JSONForbidden(w, "Access denied")
		return
	}

	// Update files in a transaction
	err = h.dbManager.Transaction(r.Context(), func(tx *sql.Tx, q *db.Queries) error {
		for _, fileUpdate := range req.Files {
			// Validate path
			fileUpdate.Path = strings.TrimSpace(fileUpdate.Path)
			if fileUpdate.Path == "" {
				continue // Skip empty paths
			}

			// Basic path validation
			if strings.Contains(fileUpdate.Path, "..") || strings.HasPrefix(fileUpdate.Path, "/") {
				return sql.ErrConnDone // Using this as a signal for validation error
			}

			// Try to update existing file, or create if it doesn't exist
			err := q.UpdateTrifleFileByPath(r.Context(), db.UpdateTrifleFileByPathParams{
				Content:  fileUpdate.Content,
				TrifleID: trifleID,
				Path:     fileUpdate.Path,
			})

			if err == sql.ErrNoRows {
				// File doesn't exist, create it
				fileID, err := db.NewFileID()
				if err != nil {
					return err
				}

				err = q.CreateTrifleFile(r.Context(), db.CreateTrifleFileParams{
					ID:       fileID,
					TrifleID: trifleID,
					Path:     fileUpdate.Path,
					Content:  fileUpdate.Content,
				})
				if err != nil {
					return err
				}
			} else if err != nil {
				return err
			}
		}
		return nil
	})

	if err == sql.ErrConnDone {
		JSONBadRequest(w, "Invalid file path detected")
		return
	}
	if err != nil {
		slog.Error("Failed to batch update files", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to update files")
		return
	}

	// Return updated file list
	files, err := h.dbManager.ListTrifleFilesByTrifleID(r.Context(), trifleID)
	if err != nil {
		slog.Error("Failed to list updated files", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve updated files")
		return
	}

	response := make([]TrifleFileResponse, len(files))
	for i, f := range files {
		response[i] = TrifleFileResponse{
			ID:        f.ID,
			TrifleID:  f.TrifleID,
			Path:      f.Path,
			Content:   f.Content,
			CreatedAt: f.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
			UpdatedAt: f.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	JSONResponse(w, http.StatusOK, response)
}

// HandleDeleteFile handles DELETE /api/trifles/:id/files?path=...
func (h *TrifleHandlers) HandleDeleteFile(w http.ResponseWriter, r *http.Request) {
	session := GetSessionFromContext(r)
	if session == nil {
		JSONUnauthorized(w, "Authentication required")
		return
	}

	// Extract trifle ID from path
	path := strings.TrimPrefix(r.URL.Path, "/api/trifles/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) < 2 || parts[0] == "" {
		JSONBadRequest(w, "Invalid trifle ID")
		return
	}
	trifleID := parts[0]

	// Get file path from query parameter
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		JSONBadRequest(w, "File path is required")
		return
	}

	// Get trifle to verify ownership
	trifle, err := h.dbManager.GetTrifle(r.Context(), trifleID)
	if err == sql.ErrNoRows {
		JSONNotFound(w, "Trifle not found")
		return
	}
	if err != nil {
		slog.Error("Failed to get trifle", "error", err, "trifle_id", trifleID)
		JSONInternalError(w, "Failed to retrieve trifle")
		return
	}

	// Verify ownership
	if trifle.AccountID != session.AccountID {
		JSONForbidden(w, "Access denied")
		return
	}

	// Delete the file
	err = h.dbManager.DeleteTrifleFileByPath(r.Context(), trifleID, filePath)
	if err != nil {
		slog.Error("Failed to delete file", "error", err, "trifle_id", trifleID, "path", filePath)
		JSONInternalError(w, "Failed to delete file")
		return
	}

	// Return success with no content
	w.WriteHeader(http.StatusNoContent)
}
