package store

import (
	"context"
	"testing"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

func nota(rel, title, body string) (domain.NoteMeta, string) {
	return domain.NoteMeta{
		RelPath:    "notes/" + rel,
		Title:      title,
		SizeBytes:  int64(len(body)),
		ModifiedAt: time.Now().UTC(),
	}, body
}

func TestNotesSeIndexanYSeBuscan(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	for _, args := range []struct{ rel, title, body string }{
		{"ideas/una-idea.md", "Una idea", "Sobre murciélagos y otras aves."},
		{"recetas/tarta.md", "Tarta de queso", "Con mascarpone y huevos."},
	} {
		meta, body := nota(args.rel, args.title, args.body)
		if err := s.UpsertNote(ctx, meta, body); err != nil {
			t.Fatalf("UpsertNote: %v", err)
		}
	}

	// Por título.
	got, err := s.SearchNotes(ctx, "tarta", 10)
	if err != nil {
		t.Fatalf("SearchNotes: %v", err)
	}
	if len(got) != 1 || got[0].RelPath != "notes/recetas/tarta.md" {
		t.Errorf("búsqueda por título = %+v", got)
	}

	// Por cuerpo, que es lo que no se puede hacer sin índice.
	got, err = s.SearchNotes(ctx, "murcielagos", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Errorf("la búsqueda por cuerpo no encontró la nota: %+v", got)
	}

	// Y una que no existe no devuelve nada, en vez de devolverlo todo.
	got, _ = s.SearchNotes(ctx, "ornitorrinco", 10)
	if len(got) != 0 {
		t.Errorf("esperaba 0 resultados, hay %d", len(got))
	}
}

// Volver a indexar la misma nota la actualiza: no puede duplicarla.
func TestNoteUpsertEsIdempotente(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	meta, body := nota("a.md", "Título viejo", "cuerpo viejo")
	if err := s.UpsertNote(ctx, meta, body); err != nil {
		t.Fatal(err)
	}
	meta.Title = "Título nuevo"
	if err := s.UpsertNote(ctx, meta, "cuerpo nuevo"); err != nil {
		t.Fatal(err)
	}

	n, err := s.CountNotes(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("hay %d notas, debería haber 1", n)
	}
	got, _ := s.SearchNotes(ctx, "nuevo", 10)
	if len(got) != 1 {
		t.Errorf("no se actualizó el contenido: %+v", got)
	}
	if got, _ := s.SearchNotes(ctx, "viejo", 10); len(got) != 0 {
		t.Error("el contenido viejo sigue en el índice")
	}
}

// Mover una carpeta tiene que reescribir las rutas de todo lo que lleva dentro.
func TestMoveNotePrefixArrastraLasDeDentro(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	for _, rel := range []string{"carpeta/a.md", "carpeta/dentro/b.md"} {
		meta, body := nota(rel, rel, "contenido")
		if err := s.UpsertNote(ctx, meta, body); err != nil {
			t.Fatal(err)
		}
	}

	n, err := s.MoveNotePrefix(ctx, "notes/carpeta", "notes/movida")
	if err != nil {
		t.Fatalf("MoveNotePrefix: %v", err)
	}
	if n != 2 {
		t.Errorf("movidas = %d, esperaba 2", n)
	}

	for _, want := range []string{"notes/movida/a.md", "notes/movida/dentro/b.md"} {
		if _, err := s.GetNote(ctx, want); err != nil {
			t.Errorf("falta %q tras mover: %v", want, err)
		}
	}
	if _, err := s.GetNote(ctx, "notes/carpeta/a.md"); err == nil {
		t.Error("la ruta vieja sigue en el índice")
	}
	// Y la búsqueda sigue encontrando la nota, con la ruta nueva.
	got, _ := s.SearchNotes(ctx, "contenido", 10)
	if len(got) != 2 {
		t.Errorf("la búsqueda se quedó sin las notas movidas: %+v", got)
	}
	for _, g := range got {
		if g.RelPath == "notes/carpeta/a.md" {
			t.Error("la búsqueda devuelve una ruta que ya no existe")
		}
	}
}

// El `LIKE` del prefijo va con el separador pegado: sin él, mover `notas/a`
// arrastraría también `notas/ab`, que no tiene nada que ver.
func TestMoveNotePrefixNoArrastraVecinosConElMismoPrefijo(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)

	for _, rel := range []string{"a/uno.md", "ab/dos.md"} {
		meta, body := nota(rel, rel, "contenido")
		if err := s.UpsertNote(ctx, meta, body); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := s.MoveNotePrefix(ctx, "notes/a", "notes/z"); err != nil {
		t.Fatal(err)
	}

	if _, err := s.GetNote(ctx, "notes/z/uno.md"); err != nil {
		t.Errorf("no se movió el de dentro: %v", err)
	}
	if _, err := s.GetNote(ctx, "notes/ab/dos.md"); err != nil {
		t.Errorf("se movió un vecino que no tocaba: %v", err)
	}
}

// Olvidar una nota la saca del índice y de la búsqueda.
func TestForgetNoteLaSacaDeLaBusqueda(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	meta, body := nota("a.md", "Algo", "palabra única xilofono")
	if err := s.UpsertNote(ctx, meta, body); err != nil {
		t.Fatal(err)
	}
	if err := s.ForgetNote(ctx, meta.RelPath); err != nil {
		t.Fatalf("ForgetNote: %v", err)
	}
	if n, _ := s.CountNotes(ctx); n != 0 {
		t.Errorf("quedan %d notas", n)
	}
	if got, _ := s.SearchNotes(ctx, "xilofono", 10); len(got) != 0 {
		t.Error("la nota olvidada sigue apareciendo en la búsqueda")
	}
}
