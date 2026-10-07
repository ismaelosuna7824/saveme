package store

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// searchSeed es un resumen de prueba con lo que estas pruebas necesitan
// controlar: fecha de creación, estado, etiquetas, línea de resumen y cuerpo.
type searchSeed struct {
	id, project, title, line, body, status string
	tags                                   []string
	created                                time.Time
}

func seedSearchable(t *testing.T, s *Store, in searchSeed) {
	t.Helper()
	if in.project == "" {
		in.project = "saveme"
	}
	if in.status == "" {
		in.status = domain.StatusConfirmed
	}
	if in.created.IsZero() {
		in.created = time.Now()
	}
	m := domain.SummaryMeta{
		ID:          in.id,
		ProjectSlug: in.project,
		Category:    "feature",
		Title:       in.title,
		SummaryLine: in.line,
		RelPath:     in.project + "/feature/" + in.id + ".md",
		ContentHash: "hash-" + in.id,
		Status:      in.status,
		Author:      "agent",
		Tags:        in.tags,
		CreatedAt:   in.created,
		UpdatedAt:   in.created,
	}
	if err := s.UpsertSummary(context.Background(), m, in.body); err != nil {
		t.Fatalf("UpsertSummary(%s): %v", in.id, err)
	}
}

func ids(items []domain.SummaryMeta) []string {
	out := make([]string, 0, len(items))
	for _, m := range items {
		out = append(out, m.ID)
	}
	slices.Sort(out)
	return out
}

func marked(word string) string { return domain.SnippetOpen + word + domain.SnippetClose }

// La búsqueda FTS fallaba en silencio (columna `id` ambigua en el JOIN) y Search
// caía siempre a LIKE. Se llama a searchFTS directamente para que un error así
// no vuelva a quedar escondido detrás de la degradación.
func TestSearchFTSNoFallaYDevuelveFragmentoMarcado(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	if !s.UsesFTS() {
		t.Skip("este SQLite no trae FTS5")
	}
	seedProject(t, s, "saveme")
	body := strings.Repeat("Texto de relleno sin nada especial. ", 20) +
		"Integramos CodeMirror con vista previa en vivo. " +
		strings.Repeat("Más relleno al final del cuerpo. ", 20)
	seedSearchable(t, s, searchSeed{id: "sm_1", title: "Editor", line: "Un editor nuevo", body: body})

	items, total, err := s.searchFTS(ctx, SummaryFilter{Limit: 10}, "codemirror")
	if err != nil {
		t.Fatalf("searchFTS: %v", err)
	}
	if total != 1 || len(items) != 1 {
		t.Fatalf("total=%d items=%d, want 1", total, len(items))
	}
	snippet := items[0].Snippet
	if !strings.Contains(snippet, marked("CodeMirror")) {
		t.Fatalf("el fragmento no marca la coincidencia con su caja original: %q", snippet)
	}
	// Es un trozo, no el cuerpo entero, y se nota que está recortado.
	if len(snippet) >= len(body) || !strings.HasPrefix(snippet, snippetEllipsis) {
		t.Fatalf("el fragmento debería ser un recorte con «…»: %q", snippet)
	}
	if strings.ContainsAny(snippet, "\n\t") {
		t.Fatalf("el fragmento debería ir en una línea: %q", snippet)
	}
}

func TestSearchFragmentoPrefiereLaLineaDeResumenYCalla(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")
	seedSearchable(t, s, searchSeed{
		id: "sm_line", title: "Uno", line: "Arreglamos el watcher de archivos",
		body: "## Contexto\n\nEl watcher perdía eventos.",
	})
	seedSearchable(t, s, searchSeed{
		id: "sm_tag", title: "Dos", line: "Nada que ver", body: "cuerpo sin la palabra",
		tags: []string{"watcher"},
	})

	items, _, err := s.Search(ctx, SummaryFilter{Query: "watcher"})
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	byID := map[string]domain.SummaryMeta{}
	for _, m := range items {
		byID[m.ID] = m
	}
	if got := byID["sm_line"].Snippet; got != "Arreglamos el "+marked("watcher")+" de archivos" {
		t.Errorf("con coincidencia en la línea de resumen, el fragmento es esa línea marcada: %q", got)
	}
	// Solo casó la etiqueta: no hay trozo de texto que enseñar.
	if got := byID["sm_tag"].Snippet; got != "" {
		t.Errorf("sin coincidencia en línea ni cuerpo el fragmento va vacío: %q", got)
	}

	// Un listado sin texto no trae fragmentos.
	items, _, err = s.ListSummaries(ctx, SummaryFilter{Project: "saveme"})
	if err != nil {
		t.Fatalf("ListSummaries: %v", err)
	}
	for _, m := range items {
		if m.Snippet != "" {
			t.Errorf("un listado no debería traer fragmento: %s=%q", m.ID, m.Snippet)
		}
	}
}

func TestSearchLikeGeneraFragmentoEquivalente(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")
	body := strings.Repeat("palabra ", 30) + "El Watcher perdía eventos\n\npor un mutex. " + strings.Repeat("fin ", 30)
	seedSearchable(t, s, searchSeed{id: "sm_1", title: "Uno", line: "Línea sin nada", body: body})

	items, total, err := s.searchLike(ctx, SummaryFilter{Limit: 10}, "watcher perdía")
	if err != nil {
		t.Fatalf("searchLike: %v", err)
	}
	if total != 1 {
		t.Fatalf("total=%d, want 1", total)
	}
	snippet := items[0].Snippet
	// La coincidencia conserva la caja del texto.
	if !strings.Contains(snippet, marked("Watcher perdía")) {
		t.Fatalf("el fragmento LIKE no marca la coincidencia: %q", snippet)
	}
	// Recortado por los dos lados, sin partir palabras y en una sola línea.
	if !strings.HasPrefix(snippet, snippetEllipsis+"palabra ") || !strings.HasSuffix(snippet, "fin"+snippetEllipsis) {
		t.Fatalf("el fragmento LIKE debería ir recortado por palabras enteras: %q", snippet)
	}
	if !strings.Contains(snippet, "eventos por un mutex") {
		t.Fatalf("el fragmento LIKE debería juntar los saltos de línea: %q", snippet)
	}
}

func TestCleanSnippetQuitaTitulosSinCoincidenciaYSintaxisSuelta(t *testing.T) {
	in := "## Contexto\n\nEl " + marked("watcher") + " perdía\n- eventos\n```\n### Por qué " + marked("watcher")
	want := "El " + marked("watcher") + " perdía eventos Por qué " + marked("watcher")
	if got := cleanSnippet(in); got != want {
		t.Fatalf("cleanSnippet = %q, want %q", got, want)
	}
}

func TestMarkFirstSinCoincidenciaDevuelveVacio(t *testing.T) {
	if got := markFirst("nada por aquí", "watcher"); got != "" {
		t.Fatalf("markFirst = %q, want vacío", got)
	}
	if got := markFirst("Ñandú veloz", "ñandú"); got != marked("Ñandú")+" veloz" {
		t.Fatalf("markFirst con mayúsculas no ASCII = %q", got)
	}
}

// Los días de los filtros son los de la zona de la fecha pedida (la API las lee
// en hora local), no los de UTC, y los dos bordes son inclusivos.
func TestFiltroDeFechasUsaDiasLocalesConBordesInclusivos(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")
	// UTC-5: un día local acaba a las 05:00 UTC del día siguiente.
	loc := time.FixedZone("UTC-5", -5*3600)
	at := func(day, h, m, sec, nsec int) time.Time {
		return time.Date(2026, 3, day, h, m, sec, nsec, loc)
	}
	for _, seed := range []searchSeed{
		{id: "antes", created: at(8, 23, 59, 59, 999_000_000)},
		{id: "inicio", created: at(9, 0, 0, 0, 0)},
		// Fracción de segundo: guardado como «…05:00:00.25Z», que como texto
		// queda por debajo de «…05:00:00Z». El límite no puede tropezar con eso.
		{id: "inicio_fraccion", created: at(9, 0, 0, 0, 250_000_000)},
		// 23:59 local del día 10 son las 04:59 UTC del 11: con días UTC se
		// quedaría fuera de «hasta el 10».
		{id: "final", created: at(10, 23, 59, 59, 500_000_000)},
		{id: "despues", created: at(11, 0, 0, 0, 0)},
	} {
		seed.title = "Resumen " + seed.id
		seed.line = "línea"
		seed.body = "cuerpo con watcher"
		seedSearchable(t, s, seed)
	}

	// La hora de From y To no cuenta: se usa su día entero.
	from, to := at(9, 15, 30, 0, 0), at(10, 8, 0, 0, 0)
	cases := []struct {
		name     string
		from, to time.Time
		want     []string
	}{
		{"desde y hasta", from, to, []string{"final", "inicio", "inicio_fraccion"}},
		{"solo desde", from, time.Time{}, []string{"despues", "final", "inicio", "inicio_fraccion"}},
		{"solo hasta", time.Time{}, to, []string{"antes", "final", "inicio", "inicio_fraccion"}},
		{"un único día", at(10, 0, 0, 0, 0), at(10, 0, 0, 0, 0), []string{"final"}},
	}
	for _, tc := range cases {
		// Limit explícito: searchLike no normaliza, eso lo hace Search.
		f := SummaryFilter{Project: "saveme", From: tc.from, To: tc.to, Limit: 50}
		items, total, err := s.ListSummaries(ctx, f)
		if err != nil {
			t.Fatalf("%s: ListSummaries: %v", tc.name, err)
		}
		if got := ids(items); !slices.Equal(got, tc.want) || total != len(tc.want) {
			t.Errorf("%s: listado = %v (total %d), want %v", tc.name, got, total, tc.want)
		}

		f.Query = "watcher"
		items, total, err = s.Search(ctx, f)
		if err != nil {
			t.Fatalf("%s: Search: %v", tc.name, err)
		}
		if got := ids(items); !slices.Equal(got, tc.want) || total != len(tc.want) {
			t.Errorf("%s: búsqueda = %v (total %d), want %v", tc.name, got, total, tc.want)
		}

		items, total, err = s.searchLike(ctx, f, "watcher")
		if err != nil {
			t.Fatalf("%s: searchLike: %v", tc.name, err)
		}
		if got := ids(items); !slices.Equal(got, tc.want) || total != len(tc.want) {
			t.Errorf("%s: búsqueda LIKE = %v (total %d), want %v", tc.name, got, total, tc.want)
		}
	}
}

func TestSearchCombinaEtiquetaEstadoYTexto(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")
	seedProject(t, s, "otro")
	for _, seed := range []searchSeed{
		{id: "si", tags: []string{"backend"}, status: domain.StatusDraft, body: "el watcher pierde eventos"},
		{id: "confirmado", tags: []string{"backend"}, status: domain.StatusConfirmed, body: "el watcher pierde eventos"},
		{id: "otra_etiqueta", tags: []string{"frontend"}, status: domain.StatusDraft, body: "el watcher pierde eventos"},
		{id: "sin_texto", tags: []string{"backend"}, status: domain.StatusDraft, body: "otra cosa"},
		{id: "otro_proyecto", project: "otro", tags: []string{"backend"}, status: domain.StatusDraft, body: "el watcher pierde eventos"},
	} {
		seed.title = "Resumen " + seed.id
		seed.line = "línea"
		seedSearchable(t, s, seed)
	}

	f := SummaryFilter{Project: "saveme", Tag: "Backend", Status: domain.StatusDraft, Query: "watcher"}
	items, total, err := s.Search(ctx, f)
	if err != nil {
		t.Fatalf("Search: %v", err)
	}
	if got := ids(items); total != 1 || !slices.Equal(got, []string{"si"}) {
		t.Fatalf("búsqueda combinada = %v (total %d), want [si]", got, total)
	}
	if !strings.Contains(items[0].Snippet, marked("watcher")) {
		t.Errorf("el resultado filtrado sigue trayendo fragmento: %q", items[0].Snippet)
	}

	f.Normalize()
	items, total, err = s.searchLike(ctx, f, "watcher")
	if err != nil {
		t.Fatalf("searchLike: %v", err)
	}
	if got := ids(items); total != 1 || !slices.Equal(got, []string{"si"}) {
		t.Fatalf("búsqueda LIKE combinada = %v (total %d), want [si]", got, total)
	}

	// Sin texto, los mismos filtros también acotan el listado.
	f.Query = ""
	items, total, err = s.ListSummaries(ctx, f)
	if err != nil {
		t.Fatalf("ListSummaries: %v", err)
	}
	if got := ids(items); total != 2 || !slices.Equal(got, []string{"si", "sin_texto"}) {
		t.Fatalf("listado combinado = %v (total %d), want [si sin_texto]", got, total)
	}
}

func TestAllTagsAcotaPorProyecto(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	seedProject(t, s, "saveme")
	seedProject(t, s, "otro")
	seedSearchable(t, s, searchSeed{id: "a", tags: []string{"backend", "fts"}})
	seedSearchable(t, s, searchSeed{id: "b", tags: []string{"backend"}})
	seedSearchable(t, s, searchSeed{id: "c", project: "otro", tags: []string{"backend", "ui"}})

	got, err := s.AllTags(ctx, "saveme")
	if err != nil {
		t.Fatalf("AllTags(saveme): %v", err)
	}
	if len(got) != 2 || got["backend"] != 2 || got["fts"] != 1 {
		t.Fatalf("etiquetas de saveme = %v, want backend:2 fts:1", got)
	}

	all, err := s.AllTags(ctx, "")
	if err != nil {
		t.Fatalf("AllTags(todas): %v", err)
	}
	if len(all) != 3 || all["backend"] != 3 || all["ui"] != 1 {
		t.Fatalf("todas las etiquetas = %v, want backend:3 fts:1 ui:1", all)
	}
}
