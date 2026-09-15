package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func notesWs(t *testing.T) *Workspace {
	t.Helper()
	ws, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("workspace.New: %v", err)
	}
	return ws
}

// El árbol tiene que devolver las carpetas **y** los archivos, con rutas relativas
// a la carpeta de notas: es lo que la interfaz usa para pintarlo.
func TestNotesTreeDevuelveCarpetasYArchivos(t *testing.T) {
	ws := notesWs(t)

	if err := ws.NoteMkdir("ideas/2026"); err != nil {
		t.Fatalf("NoteMkdir: %v", err)
	}
	if err := ws.NoteWrite("ideas/2026/una-idea.md", "contenido"); err != nil {
		t.Fatal(err)
	}
	if err := ws.NoteWrite("suelta.md", "otra"); err != nil {
		t.Fatal(err)
	}

	got := map[string]NoteEntry{}
	entries, err := ws.NotesTree()
	if err != nil {
		t.Fatalf("NotesTree: %v", err)
	}
	for _, e := range entries {
		got[e.RelPath] = e
	}

	for _, rel := range []string{"ideas", "ideas/2026", "ideas/2026/una-idea.md", "suelta.md"} {
		if _, ok := got[rel]; !ok {
			t.Errorf("falta %q en el árbol; hay %v", rel, keysOf(got))
		}
	}
	if !got["ideas"].IsDir {
		t.Error("«ideas» debería venir marcada como carpeta")
	}
	if got["suelta.md"].IsDir {
		t.Error("«suelta.md» no es una carpeta")
	}
	if got["suelta.md"].Size != int64(len("otra")) {
		t.Errorf("tamaño = %d", got["suelta.md"].Size)
	}
	// Las rutas que se devuelven no llevan el prefijo: son las mismas que se
	// mandan luego para leer o mover.
	for rel := range got {
		if strings.HasPrefix(rel, "notes/") {
			t.Errorf("la ruta %q debería venir sin el prefijo «notes/»", rel)
		}
	}
}

func keysOf(m map[string]NoteEntry) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// Las notas son archivos de verdad, no filas de una base.
func TestNoteWriteLeeDeDisco(t *testing.T) {
	ws := notesWs(t)
	if err := ws.NoteWrite("a/b/c.md", "hola"); err != nil {
		t.Fatalf("NoteWrite: %v", err)
	}

	got, err := ws.NoteRead("a/b/c.md")
	if err != nil {
		t.Fatalf("NoteRead: %v", err)
	}
	if got != "hola" {
		t.Errorf("contenido = %q", got)
	}

	// Y está donde dice, con las carpetas creadas por el camino.
	abs := filepath.Join(ws.Root(), NotesDirName, "a", "b", "c.md")
	if data, err := os.ReadFile(abs); err != nil || string(data) != "hola" {
		t.Errorf("el archivo no está en %s: %v", abs, err)
	}
}

// Mover una carpeta se lleva su contenido: es lo que promete un arrastre.
func TestNoteMoveSeLlevaElContenido(t *testing.T) {
	ws := notesWs(t)
	if err := ws.NoteWrite("origen/dentro/nota.md", "lo que sea"); err != nil {
		t.Fatal(err)
	}
	if err := ws.NoteWrite("origen/otra.md", "más"); err != nil {
		t.Fatal(err)
	}

	if err := ws.NoteMove("origen", "destino"); err != nil {
		t.Fatalf("NoteMove: %v", err)
	}

	if _, err := ws.NoteRead("destino/dentro/nota.md"); err != nil {
		t.Errorf("la nota de dentro no se movió: %v", err)
	}
	if _, err := ws.NoteRead("destino/otra.md"); err != nil {
		t.Errorf("la otra nota no se movió: %v", err)
	}
	if _, err := ws.NoteRead("origen/dentro/nota.md"); err == nil {
		t.Error("el origen sigue existiendo")
	}
	// La carpeta de origen queda podada: mover no deja cascarones vacíos.
	if _, err := os.Stat(filepath.Join(ws.Root(), NotesDirName, "origen")); !errors.Is(err, os.ErrNotExist) {
		t.Error("la carpeta de origen debería haberse ido al quedar vacía")
	}
}

// Mover una carpeta dentro de sí misma dejaría un árbol imposible.
func TestNoteMoveRechazaMeterUnaCarpetaEnSiMisma(t *testing.T) {
	ws := notesWs(t)
	if err := ws.NoteWrite("a/nota.md", "x"); err != nil {
		t.Fatal(err)
	}
	if err := ws.NoteMove("a", "a/b"); err == nil {
		t.Fatal("debería rechazar mover «a» dentro de «a»")
	}
	if _, err := ws.NoteRead("a/nota.md"); err != nil {
		t.Errorf("la nota debería seguir donde estaba: %v", err)
	}
}

// Y no puede pisar lo que ya hay en el destino.
func TestNoteMoveNoPisaElDestino(t *testing.T) {
	ws := notesWs(t)
	if err := ws.NoteWrite("uno.md", "primero"); err != nil {
		t.Fatal(err)
	}
	if err := ws.NoteWrite("dos.md", "segundo"); err != nil {
		t.Fatal(err)
	}

	err := ws.NoteMove("uno.md", "dos.md")
	if err == nil {
		t.Fatal("debería negarse a pisar «dos.md»")
	}
	var exists *ExistsError
	if !errors.As(err, &exists) {
		t.Errorf("error = %T (%v)", err, err)
	}

	if got, _ := ws.NoteRead("dos.md"); got != "segundo" {
		t.Errorf("se perdió el archivo de destino: %q", got)
	}
}

// Ninguna ruta de nota puede salirse de la carpeta de notas.
func TestNoteRechazaRutasQueSeEscapan(t *testing.T) {
	ws := notesWs(t)
	for _, bad := range []string{
		"",
		"../fuera.md",
		"a/../../fuera.md",
		"/etc/passwd",
		"notes/../../fuera.md",
		".saveme/saveme.db",
	} {
		if err := ws.NoteWrite(bad, "x"); err == nil {
			t.Errorf("NoteWrite(%q) debería fallar", bad)
		}
		if err := ws.NoteMkdir(bad); err == nil {
			t.Errorf("NoteMkdir(%q) debería fallar", bad)
		}
	}
}

// Borrar una nota la archiva: se puede recuperar, igual que un resumen.
func TestNoteDeleteVaALaPapelera(t *testing.T) {
	ws := notesWs(t)
	if err := ws.NoteWrite("importante.md", "no me pierdas"); err != nil {
		t.Fatal(err)
	}

	trash, err := ws.NoteDelete("importante.md")
	if err != nil {
		t.Fatalf("NoteDelete: %v", err)
	}
	if !strings.Contains(trash, "trash") {
		t.Errorf("la ruta de papelera no lo parece: %q", trash)
	}
	entries, err := ws.Trash()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("esperaba 1 entrada en la papelera, hay %d", len(entries))
	}
	if entries[0].RelPath != "notes/importante.md" {
		t.Errorf("ruta archivada = %q", entries[0].RelPath)
	}
}

// La carpeta de notas no puede colarse en el indexado de resúmenes: si no, cada
// nota aparecería como un proyecto con categoría desconocida.
func TestWalkIgnoraLaCarpetaDeNotas(t *testing.T) {
	ws := notesWs(t)
	if err := ws.NoteWrite("una-nota.md", "texto"); err != nil {
		t.Fatal(err)
	}
	// Y un resumen de verdad, para comprobar que el resto sí se recorre.
	if err := ws.WriteAtomic("proyecto/features/2026-01-01-algo.md", []byte("# algo\n"), true); err != nil {
		t.Fatal(err)
	}

	entries, err := ws.Walk()
	if err != nil {
		t.Fatalf("Walk: %v", err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.RelPath, NotesDirName+"/") {
			t.Errorf("el indexado se coló en las notas: %q", e.RelPath)
		}
	}
	if len(entries) != 1 {
		t.Errorf("esperaba solo el resumen, hay %d: %v", len(entries), entries)
	}
}

// El marcador es lo que distingue «aquí había un SaveMe» de «aquí no hay nada»,
// que es justo lo que hace falta para reconocer un workspace movido.
func TestHasMarkerSoloEnUnWorkspaceDeVerdad(t *testing.T) {
	dir := t.TempDir()

	if HasMarker(dir) {
		t.Error("una carpeta vacía no es un workspace")
	}

	ws, err := New(dir)
	if err != nil {
		t.Fatalf("workspace.New: %v", err)
	}
	if !HasMarker(dir) {
		t.Error("tras abrirlo, el marcador debería estar")
	}
	_ = ws

	// Y una carpeta que no existe no es un workspace, en vez de reventar.
	if HasMarker(filepath.Join(dir, "no-existe")) {
		t.Error("una carpeta que no existe no puede tener marcador")
	}
	if HasMarker("") {
		t.Error("la cadena vacía no es un workspace")
	}
}
