package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Tipos de evento que se publican por SSE. Son parte del contrato con el
// frontend: si se renombra uno, hay que actualizar el hook de eventos.
const (
	EventHello          = "hello"
	EventSummaryCreated = "summary.created"
	EventSummaryUpdated = "summary.updated"
	EventSummaryDeleted = "summary.deleted"
	EventProposalNew    = "proposal.created"
	EventProposalDone   = "proposal.resolved"
	EventProjectCreated = "project.created"
	EventIndexRebuilt   = "index.rebuilt"
)

// Event es una entrada de la bitácora.
type Event struct {
	ID      int64          `json:"id"`
	TS      time.Time      `json:"ts"`
	Type    string         `json:"type"`
	Payload map[string]any `json:"payload"`
}

// AppendEvent registra un evento. Devuelve el id asignado, que es lo que el
// stream SSE usa como Last-Event-ID para reanudar sin perder novedades.
func (s *Store) AppendEvent(ctx context.Context, eventType string, payload any) (int64, error) {
	raw := "{}"
	if payload != nil {
		if b, err := json.Marshal(payload); err == nil {
			raw = string(b)
		}
	}
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO events(ts, type, payload_json) VALUES(?, ?, ?)`,
		ts(time.Now().UTC()), eventType, raw)
	if err != nil {
		return 0, fmt.Errorf("registrar el evento %s: %w", eventType, err)
	}
	return res.LastInsertId()
}

// EventsSince devuelve los eventos posteriores a sinceID, en orden ascendente.
func (s *Store) EventsSince(ctx context.Context, sinceID int64, limit int) ([]Event, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, ts, type, payload_json FROM events WHERE id > ? ORDER BY id ASC LIMIT ?`,
		sinceID, limit)
	if err != nil {
		return nil, fmt.Errorf("leer eventos: %w", err)
	}
	defer rows.Close()

	var out []Event
	for rows.Next() {
		var e Event
		var tsStr, payload string
		if err := rows.Scan(&e.ID, &tsStr, &e.Type, &payload); err != nil {
			return nil, err
		}
		e.TS = parseTS(tsStr)
		e.Payload = map[string]any{}
		_ = json.Unmarshal([]byte(payload), &e.Payload)
		out = append(out, e)
	}
	return out, rows.Err()
}

// LastEventID devuelve el id del evento más reciente, o 0 si no hay ninguno.
// El stream SSE lo usa para saber desde dónde emitir al conectarse.
func (s *Store) LastEventID(ctx context.Context) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(id), 0) FROM events`).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("leer el último evento: %w", err)
	}
	return id, nil
}

// PruneEvents borra eventos anteriores a la retención indicada.
func (s *Store) PruneEvents(ctx context.Context, olderThan time.Time) (int, error) {
	res, err := s.db.ExecContext(ctx, `DELETE FROM events WHERE ts < ?`, ts(olderThan))
	if err != nil {
		return 0, fmt.Errorf("podar eventos: %w", err)
	}
	n, err := res.RowsAffected()
	return int(n), err
}
