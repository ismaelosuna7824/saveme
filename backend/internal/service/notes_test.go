package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ismaelosuna/saveme/backend/internal/store"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// El camino completo: crear, buscar en el índice, mover y borrar.
func TestNotasDePuntaAPunta(t *testing.T) {
	svc, root := newTestService(t)
	ctx := context.Background()

	// Crear.
	if _, err := svc.NoteCreate(ctx, "ideas/una-idea.md", "Una idea"); err != nil {
		t.Fatalf("NoteCreate: %v", err)
	}
	// Guardar contenido de verdad.
	if _, err := svc.NoteSave(ctx, "ideas/una-idea.md", "# Una idea\n\nSobre murcielagos."); err != nil {
		t.Fatalf("NoteSave: %v", err)
	}

	// Está en disco, que es la promesa.
	abs := filepath.Join(root, "notes", "ideas", "una-idea.md")
	if _, err := os.Stat(abs); err != nil {
		t.Fatalf("la nota no está en disco: %v", err)
	}

	// Y se encuentra por el cuerpo.
	got, err := svc.NoteSearch(ctx, "murcielagos", 10)
	if err != nil {
		t.Fatalf("NoteSearch: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("la búsqueda devolvió %d notas", len(got))
	}
	if got[0].RelPath != "notes/ideas/una-idea.md" {
		t.Errorf("rel_path = %q", got[0].RelPath)
	}
	// El título sale del encabezado, no del nombre del archivo.
	if got[0].Title != "Una idea" {
		t.Errorf("título = %q, esperaba el del encabezado", got[0].Title)
	}

	// Mover la carpeta entera.
	moved, err := svc.NoteMove(ctx, "ideas", "archivo/ideas")
	if err != nil {
		t.Fatalf("NoteMove: %v", err)
	}
	if moved != 1 {
		t.Errorf("movidos = %d, esperaba 1", moved)
	}
	got, _ = svc.NoteSearch(ctx, "murcielagos", 10)
	if len(got) != 1 || got[0].RelPath != "notes/archivo/ideas/una-idea.md" {
		t.Errorf("el índice no siguió a la nota: %+v", got)
	}

	// Borrar: va a la papelera y sale del índice.
	trash, err := svc.NoteDelete(ctx, "archivo/ideas/una-idea.md")
	if err != nil {
		t.Fatalf("NoteDelete: %v", err)
	}
	if !strings.Contains(trash, "trash") {
		t.Errorf("no se archivó: %q", trash)
	}
	if got, _ := svc.NoteSearch(ctx, "murcielagos", 10); len(got) != 0 {
		t.Error("la nota borrada sigue en la búsqueda")
	}
}

// Borrar una carpeta se lleva del índice todo lo que tenía dentro.
func TestNoteDeleteDeCarpetaLimpiaElIndiceEntero(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	for _, rel := range []string{"carpeta/a.md", "carpeta/dentro/b.md"} {
		if _, err := svc.NoteSave(ctx, rel, "# "+rel+"\n\npalabra xilofono"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.NoteDelete(ctx, "carpeta"); err != nil {
		t.Fatalf("NoteDelete: %v", err)
	}
	if got, _ := svc.NoteSearch(ctx, "xilofono", 10); len(got) != 0 {
		t.Errorf("quedaron %d notas en el índice tras borrar la carpeta", len(got))
	}
}

// El reindexado tiene que reconstruir el índice desde el disco: es lo que hace
// cierta la promesa de que la base es caché.
func TestReindexNotesReconstruyeDesdeElDisco(t *testing.T) {
	svc, root := newTestService(t)
	ctx := context.Background()

	// Una nota escrita a mano, sin pasar por el servicio, como si la hubiera
	// dejado otro editor.
	dir := filepath.Join(root, "notes", "a-mano")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "suelta.md"),
		[]byte("# Escrita a mano\n\ntiene la palabra ornitorrinco\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.ReindexNotes(ctx); err != nil {
		t.Fatalf("ReindexNotes: %v", err)
	}
	got, err := svc.NoteSearch(ctx, "ornitorrinco", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("el reindexado no encontró la nota escrita a mano: %d resultados", len(got))
	}
	if got[0].Title != "Escrita a mano" {
		t.Errorf("título = %q", got[0].Title)
	}

	// Y si el archivo desaparece por fuera, el reindexado lo olvida.
	if err := os.Remove(filepath.Join(dir, "suelta.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReindexNotes(ctx); err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.NoteSearch(ctx, "ornitorrinco", 10); len(got) != 0 {
		t.Error("el índice conserva una nota que ya no está en disco")
	}
}

// Las notas no pueden colarse en el historial de resúmenes.
func TestLasNotasNoEntranEnElIndiceDeResumenes(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.NoteSave(ctx, "una-nota.md", "# Una nota\n\ntexto"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	items, _, err := svc.List(ctx, store.SummaryFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range items {
		if strings.HasPrefix(it.RelPath, workspace.NotesDirName+"/") {
			t.Errorf("una nota acabó en el historial de resúmenes: %q", it.RelPath)
		}
	}
}

// El watcher avisa de **cualquier** .md que cambie, incluidas las notas, y no pasa
// por `Walk`. Excluir la carpeta solo ahí dejaba que cada nota editada acabara
// indexada como un resumen: aparecía en el historial del proyecto con categoría
// «sin categoría».
//
// Esta prueba ejercita justo ese camino, que es el que la API no toca.
func TestElWatcherNoMeteLasNotasEnLosResumenes(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.NoteSave(ctx, "una-nota.md", "# Una nota\n\ntexto con xilofono"); err != nil {
		t.Fatal(err)
	}

	// Esto es exactamente lo que hace el watcher al ver el archivo cambiar.
	if err := svc.ReindexFile(ctx, "notes/una-nota.md"); err != nil {
		t.Fatalf("ReindexFile: %v", err)
	}

	items, _, err := svc.List(ctx, store.SummaryFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range items {
		if strings.HasPrefix(it.RelPath, workspace.NotesDirName+"/") {
			t.Errorf("el watcher metió una nota en los resúmenes: %q", it.RelPath)
		}
	}
	// Y sí quedó en el índice de notas, que es donde tiene que estar.
	got, _ := svc.NoteSearch(ctx, "xilofono", 10)
	if len(got) != 1 {
		t.Errorf("la nota no se indexó como nota: %d resultados", len(got))
	}
}

// Y si el archivo desaparece por fuera, el watcher lo saca del índice de notas.
func TestElWatcherOlvidaUnaNotaBorrada(t *testing.T) {
	svc, root := newTestService(t)
	ctx := context.Background()

	if _, err := svc.NoteSave(ctx, "efimera.md", "# Efímera\n\npalabra ornitorrinco"); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, "notes", "efimera.md")); err != nil {
		t.Fatal(err)
	}
	if err := svc.ReindexFile(ctx, "notes/efimera.md"); err != nil {
		t.Fatalf("ReindexFile: %v", err)
	}
	if got, _ := svc.NoteSearch(ctx, "ornitorrinco", 10); len(got) != 0 {
		t.Error("la nota borrada sigue en la búsqueda")
	}
}
