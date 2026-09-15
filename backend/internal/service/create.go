package service

import (
	"context"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// CreateNow escribe un resumen de una vez, sin pasar por el inbox.
//
// Existe porque hasta ahora la app era la única puerta por la que **no** se podía
// escribir: un resumen entraba si lo proponía un agente o si lo tecleabas en la
// terminal, pero no desde la interfaz, que es la casa del diario. No añade ninguna
// capacidad —el camino ya estaba entero—, solo quita la que faltaba.
//
// Pasa por las mismas dos fases que un agente en vez de escribir por su cuenta,
// así que hereda la deduplicación, la inferencia de categoría, el hash de
// contenido y el conflicto de edición sin duplicar una sola regla. La espera de
// las dos fases existe para que un agente no escriba sin permiso; aquí el permiso
// es haber pulsado guardar.
//
// `via` distingue quién lo pidió. Importa para una cosa concreta: una persona
// puede aprobar una propuesta vencida y un agente no, y ese permiso se decide por
// esta cadena.
func (s *Service) CreateNow(ctx context.Context, req domain.CreateRequest, via string) (*WriteResult, error) {
	prep, err := s.Propose(ctx, req)
	if err != nil {
		return nil, err
	}

	// Ese contenido exacto ya se escribió antes: se devuelve el que hay en vez de
	// crear un duplicado, que es lo mismo que promete el flujo de dos fases.
	if prep.AlreadySaved != nil {
		return &WriteResult{
			Meta:    *prep.AlreadySaved,
			Created: false,
			RelPath: prep.AlreadySaved.RelPath,
			AbsPath: prep.AlreadySaved.AbsPath,
		}, nil
	}

	return s.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: via})
}
