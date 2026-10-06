package api

import (
	"fmt"
	"net/http"

	"github.com/ismaelosuna/saveme/backend/internal/mcpserver"
)

// handleGuide devuelve las instrucciones para que un agente use SaveMe bien.
//
// Es deliberadamente un endpoint y no solo documentación: la forma más fiable de
// que un agente escriba buenos resúmenes es darle el texto exacto que debe
// seguir, y que ese texto viva junto al código que lo hace cumplir. El texto es
// el mismo que sirve el MCP (`mcpserver.Guide`): una sola guía, no dos copias que
// acaben diciendo cosas distintas.
func (s *Server) handleGuide(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	fmt.Fprint(w, mcpserver.Guide(s.svc.Workspace().Root()))
}
