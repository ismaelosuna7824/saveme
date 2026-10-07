package service

import (
	"context"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// Resúmenes sustituidos.
//
// Un resumen de diseño de hace seis meses sigue siendo historia, pero si una
// decisión posterior lo revirtió ya no es la verdad vigente. Sin marcarlo, un
// agente que pregunta qué se hizo en un archivo recibe las dos decisiones como
// si valieran igual, y puede «respetar» justo la que se abandonó.
//
// El enlace vive en el resumen nuevo (`supersedes` en su frontmatter), así que el
// viejo no se toca: que lo sustituyan se calcula al leer.

// markSuperseded rellena `SupersededBy` en cada resumen que otro sustituye.
func (s *Service) markSuperseded(ctx context.Context, metas []domain.SummaryMeta) error {
	if len(metas) == 0 {
		return nil
	}
	index, err := s.st.SupersededIndex(ctx)
	if err != nil || len(index) == 0 {
		return err
	}
	for i := range metas {
		by := index[metas[i].ID]
		if by == "" {
			by = index[metas[i].RelPath]
		}
		// Un resumen que se nombra a sí mismo no se sustituye: sería un frontmatter
		// mal escrito a mano, no una decisión.
		if by != metas[i].ID {
			metas[i].SupersededBy = by
		}
	}
	return nil
}

// markOneSuperseded es `markSuperseded` para un solo resumen.
func (s *Service) markOneSuperseded(ctx context.Context, meta *domain.SummaryMeta) error {
	one := []domain.SummaryMeta{*meta}
	if err := s.markSuperseded(ctx, one); err != nil {
		return err
	}
	meta.SupersededBy = one[0].SupersededBy
	return nil
}
