package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// ErrorResponse represents a standard JSON error response
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

// JSONResponse writes a JSON response with the given status code
func JSONResponse(w http.ResponseWriter, statusCode int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	if err := json.NewEncoder(w).Encode(data); err != nil {
		slog.Error("Failed to encode JSON response", "error", err)
	}
}

// JSONError writes a JSON error response with the given status code and error message
func JSONError(w http.ResponseWriter, statusCode int, errorType string, message string) {
	JSONResponse(w, statusCode, ErrorResponse{
		Error:   errorType,
		Message: message,
	})
}

// JSONBadRequest writes a 400 Bad Request JSON error
func JSONBadRequest(w http.ResponseWriter, message string) {
	JSONError(w, http.StatusBadRequest, "bad_request", message)
}

// JSONUnauthorized writes a 401 Unauthorized JSON error
func JSONUnauthorized(w http.ResponseWriter, message string) {
	JSONError(w, http.StatusUnauthorized, "unauthorized", message)
}

// JSONForbidden writes a 403 Forbidden JSON error
func JSONForbidden(w http.ResponseWriter, message string) {
	JSONError(w, http.StatusForbidden, "forbidden", message)
}

// JSONNotFound writes a 404 Not Found JSON error
func JSONNotFound(w http.ResponseWriter, message string) {
	JSONError(w, http.StatusNotFound, "not_found", message)
}

// JSONInternalError writes a 500 Internal Server Error JSON error
func JSONInternalError(w http.ResponseWriter, message string) {
	JSONError(w, http.StatusInternalServerError, "internal_error", message)
}
