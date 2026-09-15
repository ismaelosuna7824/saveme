package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Un changelog agrupa por categoría en el orden de la taxonomía y de lo viejo a lo
// nuevo: se lee como una historia, y al revés obliga a leerlo de abajo arriba.
func TestChangelogAgrupaPorCategoriaYEnOrden(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	ahora := time.Now()
	fecha := func(dias int) string {
		return ahora.AddDate(0, 0, -dias).Format(time.RFC3339)
	}

	// A propósito desordenados en el tiempo y con la categoría `fix` antes que
	// `feature`: la salida no puede depender del orden en que se escribieron.
	escribeResumenEn(t, svc, "alfa/fixes/b.md", "sm_b", "Arreglo posterior", "alfa", "fix",
		fecha(2), nil)
	escribeResumenEn(t, svc, "alfa/features/a.md", "sm_a", "Feature anterior", "alfa", "feature",
		fecha(5), nil)
	escribeResumenEn(t, svc, "alfa/fixes/c.md", "sm_c", "Arreglo anterior", "alfa", "fix",
		fecha(6), nil)

	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	out, err := svc.ChangelogProject(ctx, "alfa", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("ChangelogProject: %v", err)
	}

	if out.Count != 3 {
		t.Fatalf("count = %d, esperaba 3", out.Count)
	}
	if len(out.Sections) != 2 {
		t.Fatalf("sections = %d, esperaba 2", len(out.Sections))
	}
	// La taxonomía pone `feature` antes que `fix`.
	if out.Sections[0].Category != "feature" {
		t.Errorf("la primera sección es %q, esperaba feature", out.Sections[0].Category)
	}
	if out.Sections[1].Category != "fix" {
		t.Errorf("la segunda sección es %q, esperaba fix", out.Sections[1].Category)
	}

	// Y dentro de la sección, lo más viejo primero.
	fixes := out.Sections[1].Entries
	if len(fixes) != 2 {
		t.Fatalf("la sección de fixes trae %d entradas, esperaba 2", len(fixes))
	}
	if fixes[0].ID != "sm_c" || fixes[1].ID != "sm_b" {
		t.Errorf("los fixes salen %s, %s; esperaba sm_c (viejo) y luego sm_b",
			fixes[0].ID, fixes[1].ID)
	}
}

// El rango manda: lo de fuera no entra, ni por delante ni por detrás. Es lo que
// permite generar las notas de una entrega ya cerrada sin que se cuele lo de
// después.
func TestChangelogRespetaElRango(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	ahora := time.Now()
	fecha := func(dias int) string {
		return ahora.AddDate(0, 0, -dias).Format(time.RFC3339)
	}

	escribeResumenEn(t, svc, "alfa/features/dentro.md", "sm_dentro", "Dentro", "alfa", "feature",
		fecha(10), nil)
	escribeResumenEn(t, svc, "alfa/features/dentro2.md", "sm_dentro2", "Dentro también", "alfa",
		"feature", fecha(15), nil)
	escribeResumenEn(t, svc, "alfa/features/fuera.md", "sm_fuera", "Antes del rango", "alfa",
		"feature", fecha(40), nil)
	escribeResumenEn(t, svc, "alfa/features/posterior.md", "sm_posterior", "Después del rango",
		"alfa", "feature", fecha(1), nil)

	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	// Un rango que termina hace tres días: lo de ayer se queda fuera aunque sea lo
	// más reciente del proyecto.
	desde := ahora.AddDate(0, 0, -20)
	hasta := ahora.AddDate(0, 0, -3)

	out, err := svc.ChangelogProject(ctx, "alfa", desde, hasta)
	if err != nil {
		t.Fatalf("ChangelogProject: %v", err)
	}

	if out.Count != 2 {
		t.Fatalf("count = %d, esperaba 2 (solo lo del rango)", out.Count)
	}
	for _, seccion := range out.Sections {
		for _, entrada := range seccion.Entries {
			if entrada.ID == "sm_fuera" {
				t.Error("un resumen anterior al rango no puede entrar")
			}
			if entrada.ID == "sm_posterior" {
				t.Error("un resumen posterior al rango no puede entrar")
			}
		}
	}
}

// Un rango del revés es un error de quien lo pide, y decirlo es más útil que
// devolver un documento vacío que parece que no hubo nada.
func TestChangelogConRangoDelReves(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	ahora := time.Now()
	_, err := svc.ChangelogProject(ctx, "alfa", ahora, ahora.AddDate(0, 0, -10))
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, esperaba ErrInvalid", err)
	}
}

// Sin fechas, la ventana es la de por defecto, y las secciones salen vacías como
// lista y no como nulo.
func TestChangelogPorDefectoYVacio(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Solo", "solo"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	out, err := svc.ChangelogProject(ctx, "solo", time.Time{}, time.Time{})
	if err != nil {
		t.Fatalf("un changelog vacío no debería fallar: %v", err)
	}
	if out.Count != 0 {
		t.Errorf("count = %d, esperaba 0", out.Count)
	}
	if out.Sections == nil {
		t.Error("sections debería ser una lista vacía, no nulo")
	}
	// La ventana por defecto son treinta días contados hasta ahora.
	esperado := out.To.AddDate(0, 0, -ChangelogDaysPorDefecto)
	if out.From.Sub(esperado).Abs() > time.Minute {
		t.Errorf("from = %s, esperaba alrededor de %s", out.From, esperado)
	}
}
