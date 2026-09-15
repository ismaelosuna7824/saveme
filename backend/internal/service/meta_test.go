package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Cambiar la categoría mueve el archivo de carpeta, conserva el contenido y el
// id, y no deja nada atrás.
func TestUpdateMetaMueveSinPerderNada(t *testing.T) {
	svc, root := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}
	escribeResumen(t, svc, "alfa/fixes/watcher.md", "sm_m1", "Arreglo del watcher", "fix", "El cuerpo original.")
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	meta, err := svc.UpdateMeta(ctx, "sm_m1", "feature", "")
	if err != nil {
		t.Fatalf("UpdateMeta: %v", err)
	}

	if meta.Category != "feature" {
		t.Errorf("category = %q, esperaba feature", meta.Category)
	}
	if meta.RelPath != "alfa/features/watcher.md" {
		t.Errorf("rel_path = %q, esperaba alfa/features/watcher.md", meta.RelPath)
	}
	if meta.ID != "sm_m1" {
		t.Errorf("id = %q: el id no puede cambiar", meta.ID)
	}

	// El archivo viejo no está y el nuevo sí.
	if _, err := os.Stat(filepath.Join(root, "alfa", "fixes", "watcher.md")); err == nil {
		t.Error("el archivo viejo sigue ahí")
	}
	data, err := os.ReadFile(filepath.Join(root, "alfa", "features", "watcher.md"))
	if err != nil {
		t.Fatalf("el archivo nuevo no está: %v", err)
	}
	if !strings.Contains(string(data), "El cuerpo original.") {
		t.Error("el cuerpo no se conservó")
	}
	if !strings.Contains(string(data), "title: Arreglo del watcher") {
		t.Error("el frontmatter perdió el título")
	}

}

// Una categoría que no existe se rechaza en vez de crear una carpeta inventada.
func TestUpdateMetaRechazaCategoriaDesconocida(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}
	escribeResumen(t, svc, "alfa/fixes/x.md", "sm_m2", "Algo", "fix", "Cuerpo.")
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	if _, err := svc.UpdateMeta(ctx, "sm_m2", "inventada", ""); err == nil {
		t.Fatal("una categoría desconocida debería fallar")
	}
}

// Mover encima de otro resumen se rechaza: perder uno sería el peor final
// posible para una operación de ordenar.
func TestUpdateMetaNoPisaOtroResumen(t *testing.T) {
	svc, root := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}
	escribeResumen(t, svc, "alfa/fixes/choque.md", "sm_m3", "Uno", "fix", "Cuerpo uno.")
	escribeResumen(t, svc, "alfa/features/choque.md", "sm_m4", "Otro", "feature", "Cuerpo otro.")
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	if _, err := svc.UpdateMeta(ctx, "sm_m3", "feature", ""); err == nil {
		t.Fatal("mover encima de otro resumen debería fallar")
	}
	// Y el que ya estaba sigue intacto.
	data, err := os.ReadFile(filepath.Join(root, "alfa", "features", "choque.md"))
	if err != nil {
		t.Fatalf("el resumen que ya estaba desapareció: %v", err)
	}
	if !strings.Contains(string(data), "Cuerpo otro.") {
		t.Error("se pisó el contenido del que ya estaba")
	}
}
