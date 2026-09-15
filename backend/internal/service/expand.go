package service

import (
	"context"
	"sort"
	"strings"
	"unicode"

	"github.com/ismaelosuna/saveme/backend/internal/store"
)

// Expansión por co-ocurrencia.
//
// La idea es la de la que salen los embeddings —dos palabras que aparecen juntas
// quieren decir cosas parecidas— pero sin red neuronal y sin modelo: se calcula
// del propio diario. Si en tus resúmenes «watcher» y «reindexado» salen siempre
// juntos, buscar uno encuentra el otro.
//
// No es semántica de verdad: es asociación aprendida de tu vocabulario. Y por eso
// solo funciona si escribes de verdad sobre lo que buscas, que en un diario
// técnico es exactamente el caso.
//
// Se calcula al vuelo y no en una tabla. A esta escala —unos miles de markdown—
// recorrer los que casan con la consulta son milisegundos, y una tabla habría que
// mantenerla, migrarla y reconstruirla. El disco manda; esto es una caché.

// ExpansiónDocs acota cuántos documentos se miran para sacar los vecinos.
const ExpansiónDocs = 30

// ExpansiónTerminos es cuántos términos se añaden a la consulta.
const ExpansiónTerminos = 6

// palabrasVacias son las que no aportan asociación ninguna. Lista corta a
// propósito: en un diario técnico, casi todo lo que se repite significa algo.
var palabrasVacias = map[string]bool{
	"the": true, "and": true, "for": true, "with": true, "that": true, "this": true,
	"los": true, "las": true, "del": true, "con": true, "por": true, "para": true,
	"una": true, "uno": true, "que": true, "como": true, "más": true, "mas": true,
	"pero": true, "desde": true, "cuando": true, "todo": true, "todos": true,
}

// ExpandirConsulta añade a la consulta términos que suelen acompañarla.
//
// Devuelve la consulta original primero y luego los vecinos, sin repetir. Si algo
// falla por el camino se devuelve solo la original: una búsqueda que no se puede
// ampliar sigue siendo una búsqueda, y perderla por un fallo del expansor sería
// peor que no ampliarla.
func (s *Service) ExpandirConsulta(ctx context.Context, consulta string, max int) []string {
	original := tokens(consulta)
	if len(original) == 0 {
		return nil
	}
	if max <= 0 {
		max = ExpansiónTerminos
	}

	// Se pasa por `List` y no por `ListSummaries` a propósito: solo la primera
	// enruta las consultas con texto a la búsqueda. Llamando a la del store, el
	// `Query` se ignora en silencio y los vecinos saldrían de los primeros
	// resúmenes que hubiera, que no tienen nada que ver con lo que se busca.
	metas, _, err := s.List(ctx, store.SummaryFilter{
		Query: consulta,
		Limit: ExpansiónDocs,
	})
	if err != nil || len(metas) == 0 {
		return original
	}

	// Se cuentan los términos de los documentos que ya casan con la consulta. El
	// corpus relevante es ese, no el diario entero: lo que acompaña a «watcher»
	// en los resúmenes que hablan de él, no en todos.
	yaEsta := make(map[string]bool, len(original))
	for _, t := range original {
		yaEsta[t] = true
	}
	frecuencia := map[string]int{}
	for _, meta := range metas {
		cuerpo, err := s.st.GetSummaryBody(ctx, meta.ID)
		if err != nil {
			continue
		}
		vistos := map[string]bool{}
		for _, t := range tokens(meta.Title + " " + meta.SummaryLine + " " + cuerpo) {
			if yaEsta[t] || vistos[t] {
				continue
			}
			// Una vez por documento: si no, una palabra repetida cien veces en un
			// resumen dominaría la expansión entera.
			vistos[t] = true
			frecuencia[t]++
		}
	}

	type par struct {
		termino string
		veces   int
	}
	vecinos := make([]par, 0, len(frecuencia))
	for termino, veces := range frecuencia {
		// Un término que solo sale en un documento no es una asociación: es
		// casualidad.
		if veces > 1 {
			vecinos = append(vecinos, par{termino, veces})
		}
	}
	sort.Slice(vecinos, func(i, j int) bool {
		if vecinos[i].veces != vecinos[j].veces {
			return vecinos[i].veces > vecinos[j].veces
		}
		return vecinos[i].termino < vecinos[j].termino
	})

	out := append([]string{}, original...)
	for _, v := range vecinos {
		if len(out) >= len(original)+max {
			break
		}
		out = append(out, v.termino)
	}
	return out
}

// tokens parte un texto en términos comparables: sin mayúsculas, sin acentos y
// sin las palabras que no significan nada.
func tokens(texto string) []string {
	// Primero minúsculas y **después** los acentos. Al revés, una «Ó» mayúscula no
	// coincide con ninguna de las vocales acentuadas de la lista y se cuela sin
	// plegar, así que «REINDEXACIÓN» y «reindexación» acababan siendo dos términos.
	minusculas := strings.ToLower(texto)
	sinAcentos := strings.Map(func(r rune) rune {
		switch r {
		case 'á', 'à', 'ä', 'â':
			return 'a'
		case 'é', 'è', 'ë', 'ê':
			return 'e'
		case 'í', 'ì', 'ï', 'î':
			return 'i'
		case 'ó', 'ò', 'ö', 'ô':
			return 'o'
		case 'ú', 'ù', 'ü', 'û':
			return 'u'
		case 'ñ':
			return 'n'
		}
		return r
	}, minusculas)

	campos := strings.FieldsFunc(sinAcentos, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})

	out := make([]string, 0, len(campos))
	for _, c := range campos {
		if len([]rune(c)) < 3 || palabrasVacias[c] {
			continue
		}
		out = append(out, c)
	}
	return out
}
