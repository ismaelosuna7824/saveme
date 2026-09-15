package api

import (
	"net/http"
	"strconv"
	"strings"
)

// Notas.
//
// Es una API aparte de la de resúmenes a propósito: las notas son de la interfaz y
// no tienen nada que ver con el MCP. Comparten workspace y base de datos, pero no
// contrato: si mañana cambia una cosa, no arrastra la otra.
//
// Las rutas de las notas son **relativas a la carpeta de notas** (`ideas/nota.md`),
// no a la raíz. El prefijo `notes/` lo pone el servidor.

// handleNotesTree devuelve el árbol completo, en plano.
func (s *Server) handleNotesTree(w http.ResponseWriter, r *http.Request) {
	entries, err := s.svc.NoteTree(r.Context())
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": entries})
}

// handleNoteRead devuelve el contenido de una nota.
func (s *Server) handleNoteRead(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	content, err := s.svc.NoteRead(r.Context(), rel)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": rel, "content": content})
}

// handleNoteSave guarda el contenido de una nota.
func (s *Server) handleNoteSave(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	meta, err := s.svc.NoteSave(r.Context(), body.Path, body.Content)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"note": meta})
}

// handleNoteCreate crea una nota o una carpeta.
func (s *Server) handleNoteCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path string `json:"path"`
		// Kind es "file" o "dir". Por defecto, archivo.
		Kind  string `json:"kind"`
		Title string `json:"title"`
	}
	if !decodeBody(w, r, &body) {
		return
	}

	if body.Kind == "dir" {
		if err := s.svc.NoteMkdir(r.Context(), body.Path); err != nil {
			s.writeServiceError(w, r, err)
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "path": body.Path, "is_dir": true})
		return
	}

	meta, err := s.svc.NoteCreate(r.Context(), body.Path, body.Title)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"note": meta})
}

// handleNoteMove mueve o renombra una nota o una carpeta con su contenido.
func (s *Server) handleNoteMove(w http.ResponseWriter, r *http.Request) {
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	moved, err := s.svc.NoteMove(r.Context(), body.From, body.To)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "moved": moved})
}

// handleNoteDelete archiva una nota o una carpeta entera.
func (s *Server) handleNoteDelete(w http.ResponseWriter, r *http.Request) {
	rel := r.URL.Query().Get("path")
	if strings.TrimSpace(rel) == "" {
		writeErr(w, http.StatusBadRequest, "missing_path", "falta la ruta de la nota")
		return
	}
	trash, err := s.svc.NoteDelete(r.Context(), rel)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "archived_path": trash})
}

// handleNoteSearch busca en el título y el cuerpo de las notas.
func (s *Server) handleNoteSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if query == "" {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
		return
	}
	items, err := s.svc.NoteSearch(r.Context(), query, limit)
	if err != nil {
		s.writeServiceError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
