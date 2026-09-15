package service

import (
	"context"
	"strings"
	"testing"
)

// La expansión saca los términos que acompañan a la consulta en los resúmenes que
// ya casan con ella. Es asociación aprendida del propio diario: sin modelo, sin
// descarga y sin tabla que mantener.
func TestExpandirConsultaConVecinos(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}
	// «watcher» y «reindexado» aparecen juntos en dos resúmenes.
	escribeResumen(t, svc, "alfa/fixes/a.md", "sm_e1", "Arreglo el watcher", "fix",
		"El watcher reindexado se disparaba solo.")
	escribeResumen(t, svc, "alfa/fixes/b.md", "sm_e2", "Watcher otra vez", "fix",
		"El watcher volvía a reindexado sin cambios.")
	// Y una palabra que solo sale en uno: no es asociación, es casualidad.
	escribeResumen(t, svc, "alfa/fixes/c.md", "sm_e3", "Watcher y nada más", "fix",
		"El watcher con zarandaja.")
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	got := svc.ExpandirConsulta(ctx, "watcher", 6)
	juntos := strings.Join(got, ",")
	if !strings.Contains(juntos, "reindexado") {
		t.Errorf("esperaba que apareciera «reindexado»; obtuve %v", got)
	}
	if strings.Contains(juntos, "zarandaja") {
		t.Errorf("una palabra de un solo documento no es una asociación: %v", got)
	}
	// La original va primero: ampliar no puede perder lo que se pidió.
	if len(got) == 0 || got[0] != "watcher" {
		t.Errorf("la consulta original tiene que ir primero; obtuve %v", got)
	}
}

// Sin consulta no hay nada que ampliar, y no puede fallar.
func TestExpandirConsultaSinTerminos(t *testing.T) {
	svc, _ := newTestService(t)

	if got := svc.ExpandirConsulta(context.Background(), "   ", 6); got != nil {
		t.Errorf("una consulta vacía no debería ampliarse: %v", got)
	}
	// Las palabras vacías se caen: no asocian nada.
	if got := svc.ExpandirConsulta(context.Background(), "para con", 6); got != nil {
		t.Errorf("solo palabras vacías no debería devolver nada: %v", got)
	}
}

// Los acentos y las mayúsculas no pueden separar dos términos que son el mismo.
func TestLosAcentosNoSeparanTerminos(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}
	escribeResumen(t, svc, "alfa/fixes/acc.md", "sm_e4", "Reindexación", "fix",
		"La reindexación fallaba. Otra reindexacion distinta.")
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	got := svc.ExpandirConsulta(ctx, "REINDEXACIÓN", 6)
	if len(got) != 1 || got[0] != "reindexacion" {
		t.Errorf("esperaba [reindexacion]; obtuve %v", got)
	}
}
