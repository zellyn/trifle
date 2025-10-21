package auth

import (
	"encoding/json"
	"net/http"
)

// HandleWhoAmI returns the current user's email if authenticated
func HandleWhoAmI(sessionMgr *SessionManager) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		session, err := sessionMgr.GetSession(r)
		if err != nil || !session.Authenticated {
			http.Error(w, "Not authenticated", http.StatusUnauthorized)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"email": session.Email,
		})
	}
}
