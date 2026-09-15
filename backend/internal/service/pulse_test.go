package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// escribeResumen deja un resumen con proyecto, categoría, fecha y archivos
// concretos, para poder montar escenarios de briefing y de mapa de actividad.
func escribeResumenEn(
	t *testing.T,
	svc *Service,
	rel, id, title, project, category, fecha string,
	files []string,
) {
	t.Helper()
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString("id: " + id + "\n")
	b.WriteString("title: " + title + "\n")
	b.WriteString("category: " + category + "\n")
	b.WriteString("project: " + project + "\n")
	b.WriteString("created_at: " + fecha + "\n")
	b.WriteString("updated_at: " + fecha + "\n")
	b.WriteString("author: human\n")
	b.WriteString("status: active\n")
	if len(files) > 0 {
		b.WriteString("files_touched:\n")
		for _, f := range files {
			b.WriteString("  - " + f + "\n")
		}
	}
	b.WriteString("---\n\nUn cuerpo.\n")

	if err := svc.Workspace().WriteAtomic(rel, []byte(b.String()), false); err != nil {
		t.Fatalf("escribir %s: %v", rel, err)
	}
}

// El briefing es lo que se mira al volver a un proyecto, así que tiene que traer lo
// de la ventana —y no lo viejo—, los archivos por donde se anduvo y nada inventado.
func TestBriefingReuneLoDeLaVentana(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	ahora := time.Now()
	fecha := func(dias int) string {
		return ahora.AddDate(0, 0, -dias).Format(time.RFC3339)
	}

	escribeResumenEn(t, svc, "alfa/features/a.md", "sm_a", "Lo de ayer", "alfa", "feature",
		fecha(1), []string{"backend/a.go", "backend/b.go"})
	escribeResumenEn(t, svc, "alfa/fixes/b.md", "sm_b", "El arreglo", "alfa", "fix",
		fecha(3), []string{"backend/a.go"})
	escribeResumenEn(t, svc, "alfa/chores/c.md", "sm_c", "La limpieza", "alfa", "chore",
		fecha(10), []string{"docs/x.md"})
	// Fuera de la ventana por defecto: solo tiene que contar en el total.
	escribeResumenEn(t, svc, "alfa/features/viejo.md", "sm_v", "Muy viejo", "alfa", "feature",
		fecha(60), []string{"backend/a.go"})

	// Una propuesta esperando en este proyecto, y otra en otro: la del otro no pinta
	// nada aquí.
	if _, err := svc.EnsureProject(ctx, "Beta", "beta"); err != nil {
		t.Fatalf("EnsureProject beta: %v", err)
	}
	if _, err := svc.Propose(ctx, domain.CreateRequest{
		Project: "alfa", Title: "Pendiente de alfa", Body: "Un cuerpo.",
	}); err != nil {
		t.Fatalf("Propose alfa: %v", err)
	}
	if _, err := svc.Propose(ctx, domain.CreateRequest{
		Project: "beta", Title: "Pendiente de beta", Body: "Otro cuerpo.",
	}); err != nil {
		t.Fatalf("Propose beta: %v", err)
	}

	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	out, err := svc.Briefing(ctx, "alfa", BriefingDaysPorDefecto)
	if err != nil {
		t.Fatalf("Briefing: %v", err)
	}

	// El total es el proyecto entero; la lista, solo la ventana.
	if out.Total != 4 {
		t.Errorf("total = %d, esperaba 4 (el proyecto entero)", out.Total)
	}
	if len(out.Last) != 3 {
		t.Fatalf("last = %d entradas, esperaba 3 (el viejo no entra)", len(out.Last))
	}
	if out.Last[0].ID != "sm_a" {
		t.Errorf("la primera entrada es %q, esperaba sm_a: van de lo más nuevo a lo más viejo", out.Last[0].ID)
	}

	if out.ActiveDays != 3 {
		t.Errorf("active_days = %d, esperaba 3", out.ActiveDays)
	}
	if out.LastAt == nil {
		t.Fatal("last_at no puede ser nulo con resúmenes en la ventana")
	}

	// Los archivos van por menciones: `a.go` sale en dos resúmenes de la ventana.
	if len(out.Files) != 3 {
		t.Fatalf("files = %d, esperaba 3", len(out.Files))
	}
	if out.Files[0].Path != "backend/a.go" || out.Files[0].Count != 2 {
		t.Errorf("el primer archivo es %+v, esperaba backend/a.go con 2 menciones", out.Files[0])
	}

	// Y las propuestas se filtran por proyecto.
	if len(out.Pending) != 1 {
		t.Fatalf("pending = %d, esperaba solo la de alfa", len(out.Pending))
	}
	if out.Pending[0].Title != "Pendiente de alfa" {
		t.Errorf("la pendiente es %q, esperaba la de alfa", out.Pending[0].Title)
	}
}

// Un proyecto vacío es una respuesta válida: «aquí no hay nada todavía» es
// exactamente lo que hay que poder decir. Y las listas tienen que salir `[]` en el
// JSON, no `null`, o la interfaz tendría que defenderse de nulos.
func TestBriefingVacioNoEsUnError(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Solo", "solo"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	out, err := svc.Briefing(ctx, "solo", 0)
	if err != nil {
		t.Fatalf("un briefing vacío no debería fallar: %v", err)
	}
	if out.Total != 0 || out.ActiveDays != 0 {
		t.Errorf("total/active = %d/%d, esperaba 0/0", out.Total, out.ActiveDays)
	}
	if out.LastAt != nil {
		t.Error("last_at debería ser nulo: nunca se escribió nada")
	}
	if out.Last == nil || out.Files == nil || out.Pending == nil {
		t.Error("las listas deberían ser vacías, no nulas")
	}
	if out.Days != BriefingDaysPorDefecto {
		t.Errorf("days = %d, esperaba el de por defecto %d", out.Days, BriefingDaysPorDefecto)
	}
}

// Un proyecto que no existe es un error, no un briefing vacío: confundir «no hay
// nada» con «no existe» manda a buscar donde no es.
func TestBriefingProyectoDesconocido(t *testing.T) {
	svc, _ := newTestService(t)

	_, err := svc.Briefing(context.Background(), "no-existe", 30)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v, esperaba ErrNotFound", err)
	}
}

// El mapa cubre el calendario entero, con los días vacíos incluidos: la interfaz
// pinta las celdas recorriendo el array, así que un hueco se convertiría en una
// celda corrida.
func TestActivityCubreTodosLosDiasDelCalendario(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	ahora := time.Now()
	fecha := func(dias int) string {
		return ahora.AddDate(0, 0, -dias).Format(time.RFC3339)
	}
	diaDe := func(dias int) string {
		return ahora.AddDate(0, 0, -dias).In(time.Local).Format("2006-01-02")
	}

	escribeResumenEn(t, svc, "alfa/features/a.md", "sm_a", "Una feature", "alfa", "feature",
		fecha(1), nil)
	escribeResumenEn(t, svc, "alfa/fixes/b.md", "sm_b", "Un arreglo", "alfa", "fix",
		fecha(1), nil)
	escribeResumenEn(t, svc, "alfa/chores/c.md", "sm_c", "Una limpieza", "alfa", "chore",
		fecha(3), nil)

	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	out, err := svc.ActivityMap(ctx, "alfa", 7)
	if err != nil {
		t.Fatalf("ActivityMap: %v", err)
	}

	if len(out.Entries) != 7 {
		t.Fatalf("entries = %d, esperaba 7 (todos los días de la ventana)", len(out.Entries))
	}
	if out.Entries[0].Date != diaDe(6) {
		t.Errorf("el primero es %s, esperaba %s (del más viejo al más nuevo)",
			out.Entries[0].Date, diaDe(6))
	}
	if out.Entries[6].Date != diaDe(0) {
		t.Errorf("el último es %s, esperaba hoy %s", out.Entries[6].Date, diaDe(0))
	}
	// Y son consecutivos, sin saltarse ninguno.
	for i := 1; i < len(out.Entries); i++ {
		anterior, err := time.Parse("2006-01-02", out.Entries[i-1].Date)
		if err != nil {
			t.Fatalf("fecha ilegible %q: %v", out.Entries[i-1].Date, err)
		}
		if out.Entries[i].Date != anterior.AddDate(0, 0, 1).Format("2006-01-02") {
			t.Fatalf("hueco entre %s y %s", out.Entries[i-1].Date, out.Entries[i].Date)
		}
	}

	if out.Total != 3 {
		t.Errorf("total = %d, esperaba 3", out.Total)
	}
	if out.Active != 2 {
		t.Errorf("active = %d, esperaba 2 días con algo", out.Active)
	}
	if out.Max != 2 {
		t.Errorf("max = %d, esperaba 2 (el día con dos resúmenes)", out.Max)
	}

	// El día cargado reparte por categoría, y los vacíos traen un mapa vacío y no
	// nulo.
	ayer := out.Entries[5]
	if ayer.Date != diaDe(1) {
		t.Fatalf("esperaba el día de ayer en la posición 5, hay %s", ayer.Date)
	}
	if ayer.Count != 2 || ayer.ByCategory["feature"] != 1 || ayer.ByCategory["fix"] != 1 {
		t.Errorf("ayer = %+v, esperaba 2 con una feature y un fix", ayer)
	}
	for _, entrada := range out.Entries {
		if entrada.ByCategory == nil {
			t.Fatalf("el día %s trae by_category nulo: el JSON tiene que salir {}", entrada.Date)
		}
	}
}

// El orden canónico es lo que hace que dos documentos del mismo diario salgan
// iguales: la taxonomía manda, y lo que no conoce va al final y ordenado.
func TestCanonicalOrderPoneLaTaxonomiaPrimero(t *testing.T) {
	got := canonicalOrder(map[string]bool{"zzz": true, "fix": true, "feature": true, "aaa": true})
	want := []string{"feature", "fix", "aaa", "zzz"}

	if len(got) != len(want) {
		t.Fatalf("got = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got = %v, want %v", got, want)
		}
	}
}
