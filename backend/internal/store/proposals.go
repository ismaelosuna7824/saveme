package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// ProposalRecord es la fila completa de una propuesta, con el cuerpo incluido.
//
// Guardamos el cuerpo en la base en vez de reenviarlo desde el agente en el
// segundo paso a propósito: así lo que se escribe es exactamente lo que se le
// mostró al usuario, y no lo que el modelo diga recordar un turno después.
type ProposalRecord struct {
	Token           string
	ProjectSlug     string
	Category        string
	Title           string
	RelPath         string
	Body            string
	SummaryLine     string
	PayloadHash     string
	InferenceReason string
	Confidence      float64
	Evidence        []string
	Alternatives    []domain.Alternative
	CreatedAt       time.Time
	ExpiresAt       time.Time
	Status          string
	Decision        string
	ResolvedVia     string
	ResolvedAt      *time.Time
	OverrideRelPath string
	SummaryID       string
	Agent           string
	Tags            []string
	FilesTouched    []string
	CommitSHA       string
	// TargetID es el resumen que esta propuesta **actualiza**. Vacío cuando crea
	// uno nuevo, que es el caso de siempre.
	TargetID string
	// BaseHash es el hash del archivo cuando se propuso la actualización. Es lo
	// que permite detectar que alguien lo tocó por medio y no pisarlo.
	BaseHash string
}

const proposalCols = `token, project_slug, category, title, rel_path, body, summary_line,
	payload_hash, inference_reason, confidence, evidence_json, alternatives_json,
	created_at, expires_at, status, COALESCE(decision, ''), COALESCE(resolved_via, ''),
	resolved_at, COALESCE(override_rel_path, ''), COALESCE(summary_id, ''), COALESCE(agent, ''),
	tags_json, files_json, COALESCE(commit_sha, ''), target_id, base_hash`

func scanProposal(sc scanner) (ProposalRecord, error) {
	var p ProposalRecord
	var evidenceJSON, alternativesJSON, tagsJSON, filesJSON string
	var createdStr, expiresStr string
	var resolvedAt sql.NullString

	if err := sc.Scan(
		&p.Token, &p.ProjectSlug, &p.Category, &p.Title, &p.RelPath, &p.Body, &p.SummaryLine,
		&p.PayloadHash, &p.InferenceReason, &p.Confidence, &evidenceJSON, &alternativesJSON,
		&createdStr, &expiresStr, &p.Status, &p.Decision, &p.ResolvedVia,
		&resolvedAt, &p.OverrideRelPath, &p.SummaryID, &p.Agent,
		&tagsJSON, &filesJSON, &p.CommitSHA, &p.TargetID, &p.BaseHash,
	); err != nil {
		return p, err
	}

	p.CreatedAt = parseTS(createdStr)
	p.ExpiresAt = parseTS(expiresStr)
	if resolvedAt.Valid {
		t := parseTS(resolvedAt.String)
		p.ResolvedAt = &t
	}
	p.Evidence = decodeStrings(evidenceJSON)
	p.Tags = decodeStrings(tagsJSON)
	p.FilesTouched = decodeStrings(filesJSON)
	if alternativesJSON != "" {
		_ = json.Unmarshal([]byte(alternativesJSON), &p.Alternatives)
	}
	if p.Alternatives == nil {
		p.Alternatives = []domain.Alternative{}
	}
	return p, nil
}

// InsertProposal guarda una propuesta pendiente. Todavía no se escribe ningún
// archivo: esto solo deja constancia de la intención.
func (s *Store) InsertProposal(ctx context.Context, p ProposalRecord) error {
	evidence, _ := json.Marshal(p.Evidence)
	alternatives, _ := json.Marshal(p.Alternatives)

	_, err := s.db.ExecContext(ctx, `
		INSERT INTO proposals(
			token, project_slug, category, title, rel_path, body, summary_line,
			payload_hash, inference_reason, confidence, evidence_json, alternatives_json,
			created_at, expires_at, status, agent, tags_json, files_json, commit_sha,
			target_id, base_hash)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		p.Token, p.ProjectSlug, p.Category, p.Title, p.RelPath, p.Body, p.SummaryLine,
		p.PayloadHash, p.InferenceReason, p.Confidence, string(evidence), string(alternatives),
		ts(p.CreatedAt), ts(p.ExpiresAt), domain.ProposalPending,
		nullify(p.Agent), encodeStrings(p.Tags), encodeStrings(p.FilesTouched), nullify(p.CommitSHA),
		p.TargetID, p.BaseHash,
	)
	if err != nil {
		return fmt.Errorf("guardar la propuesta %s: %w", p.Token, err)
	}
	return nil
}

// GetProposal lee una propuesta por token.
func (s *Store) GetProposal(ctx context.Context, token string) (ProposalRecord, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+proposalCols+` FROM proposals WHERE token = ?`, token)
	p, err := scanProposal(row)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	if err != nil {
		return p, fmt.Errorf("leer la propuesta %s: %w", token, err)
	}
	return p, nil
}

// ListProposals devuelve las propuestas de un estado, más recientes primero.
// Con status vacío devuelve todas.
func (s *Store) ListProposals(ctx context.Context, status string, limit int) ([]ProposalRecord, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	q := `SELECT ` + proposalCols + ` FROM proposals`
	var args []any
	if status != "" {
		q += ` WHERE status = ?`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("listar propuestas: %w", err)
	}
	defer rows.Close()

	var out []ProposalRecord
	for rows.Next() {
		p, err := scanProposal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CountPending proposals pending. Se usa para el badge del inbox.
func (s *Store) CountPendingProposals(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM proposals WHERE status = ?`, domain.ProposalPending).Scan(&n)
	return n, err
}

// ResolveProposal marca una propuesta como resuelta.
//
// El UPDATE lleva `AND status = 'pending'` en el WHERE, así que la garantía de
// un solo uso la aplica SQLite de forma atómica: si dos llamadas concurrentes
// intentan confirmar el mismo token, solo una ve RowsAffected == 1 y la otra
// recibe false. Esa es la barrera que impide una doble escritura por carrera.
func (s *Store) ResolveProposal(
	ctx context.Context,
	token, status, decision, via, overrideRelPath, summaryID string,
	now time.Time,
) (bool, error) {
	if status != domain.ProposalConfirmed && status != domain.ProposalCancelled &&
		status != domain.ProposalExpired {
		return false, fmt.Errorf("estado de propuesta inválido: %q", status)
	}
	// Una propuesta **vencida** todavía se puede reclamar para confirmarla: su
	// cuerpo sigue en la base intacto, y lo que de verdad la borra es la purga,
	// que llega mucho más tarde. Rechazarla convertía una decisión tardía en una
	// pérdida de trabajo.
	//
	// Solo para confirmar. Marcar como vencida o cancelada sigue exigiendo
	// `pending`: si no, el barrendero podría volver a marcar una ya confirmada.
	//
	// La garantía de un solo uso no se toca: el UPDATE sigue siendo condicional,
	// así que solo una confirmación puede sacarla de esos dos estados.
	condicion := "status = ?"
	estados := []any{domain.ProposalPending}
	if status == domain.ProposalConfirmed {
		condicion = "status IN (?, ?)"
		estados = append(estados, domain.ProposalExpired)
	}

	args := []any{
		status, nullify(decision), nullify(via), ts(now),
		nullify(overrideRelPath), nullify(summaryID), token,
	}
	args = append(args, estados...)

	res, err := s.db.ExecContext(ctx, `
		UPDATE proposals
		SET status = ?, decision = ?, resolved_via = ?, resolved_at = ?,
		    override_rel_path = ?, summary_id = ?
		WHERE token = ? AND `+condicion,
		args...)
	if err != nil {
		return false, fmt.Errorf("resolver la propuesta %s: %w", token, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n == 1, nil
}

// ExpireStaleProposals marca como expiradas las propuestas pendientes cuyo TTL
// ya venció y devuelve cuántas cambió.
func (s *Store) ExpireStaleProposals(ctx context.Context, now time.Time) (int, error) {
	res, err := s.db.ExecContext(ctx, `
		UPDATE proposals SET status = ?, resolved_at = ?
		WHERE status = ? AND expires_at < ?`,
		domain.ProposalExpired, ts(now), domain.ProposalPending, ts(now))
	if err != nil {
		return 0, fmt.Errorf("expirar propuestas vencidas: %w", err)
	}
	n, err := res.RowsAffected()
	return int(n), err
}

// PurgeOldProposals borra propuestas ya resueltas más viejas que la retención
// indicada, para que la tabla de auditoría no crezca sin límite.
func (s *Store) PurgeOldProposals(ctx context.Context, olderThan time.Time) (int, error) {
	res, err := s.db.ExecContext(ctx, `
		DELETE FROM proposals
		WHERE status != ? AND COALESCE(resolved_at, created_at) < ?`,
		domain.ProposalPending, ts(olderThan))
	if err != nil {
		return 0, fmt.Errorf("purgar propuestas antiguas: %w", err)
	}
	n, err := res.RowsAffected()
	return int(n), err
}

// DuplicateProposal busca una propuesta pendiente idéntica en contenido y
// destino. Sirve para avisarle al agente "esto ya lo propusiste hace un
// minuto" en vez de llenar el inbox de duplicados cuando reintenta.
func (s *Store) FindDuplicateProposal(ctx context.Context, projectSlug, relPath, payloadHash string) (ProposalRecord, bool, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+proposalCols+` FROM proposals
		WHERE status = ? AND project_slug = ? AND rel_path = ? AND payload_hash = ?
		ORDER BY created_at DESC LIMIT 1`,
		domain.ProposalPending, projectSlug, relPath, payloadHash)
	p, err := scanProposal(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ProposalRecord{}, false, nil
	}
	if err != nil {
		return ProposalRecord{}, false, err
	}
	return p, true, nil
}

// ResolvedProposalExists comprueba si este contenido exacto ya se escribió, para
// que un agente que reintenta tras una confirmación exitosa reciba "ya está
// guardado" en vez de crear un duplicado con sufijo -2.
func (s *Store) ResolvedProposalExists(ctx context.Context, projectSlug, payloadHash string) (ProposalRecord, bool, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+proposalCols+` FROM proposals
		WHERE status = ? AND project_slug = ? AND payload_hash = ?
		ORDER BY created_at DESC LIMIT 1`,
		domain.ProposalConfirmed, projectSlug, payloadHash)
	p, err := scanProposal(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ProposalRecord{}, false, nil
	}
	if err != nil {
		return ProposalRecord{}, false, err
	}
	return p, true, nil
}

// ReleaseProposal devuelve a "pending" una propuesta que se había reclamado
// como confirmada pero cuya escritura falló.
//
// Es la contraparte necesaria del orden "reclamar antes de escribir": si el
// disco falla después del reclamo, el usuario tiene que poder reintentar sin
// volver a proponer. El WHERE exige que siga en 'confirmed', así que liberar
// nunca puede resucitar una propuesta que el usuario canceló mientras tanto.
func (s *Store) ReleaseProposal(ctx context.Context, token string) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE proposals
		SET status = ?, decision = NULL, resolved_via = NULL, resolved_at = NULL,
		    override_rel_path = NULL, summary_id = NULL
		WHERE token = ? AND status = ?`,
		domain.ProposalPending, token, domain.ProposalConfirmed)
	if err != nil {
		return fmt.Errorf("liberar la propuesta %s: %w", token, err)
	}
	return nil
}

// TagList normaliza una lista de etiquetas: minúsculas, sin vacíos, sin
// repetidos y en orden de aparición.
func TagList(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}
