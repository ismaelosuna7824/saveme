package workspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// El id sale del frontmatter, que puede escribir cualquiera: con uno hostil, la
// versión tiene que acabar igualmente dentro del historial y poder leerse.
func TestHistorialNoSaleDeSuCarpeta(t *testing.T) {
	ws := newTrashWorkspace(t)
	history := filepath.Join(ws.StateDir(), "history")

	for _, id := range []string{"../../fuera", "a/b", "sm_normal"} {
		entry, err := ws.SaveVersion(id, []byte("texto de "+id), VersionAgent, time.Now())
		if err != nil {
			t.Fatalf("SaveVersion(%q): %v", id, err)
		}
		_, data, err := ws.ReadVersion(id, entry.Version)
		if err != nil || string(data) != "texto de "+id {
			t.Fatalf("ReadVersion(%q) = %q, %v", id, data, err)
		}
	}

	err := filepath.WalkDir(ws.Root(), func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if strings.HasPrefix(filepath.Base(path), "2") && !strings.HasPrefix(path, history+string(filepath.Separator)) {
			t.Errorf("una versión se escribió fuera del historial: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(ws.Root()), "fuera")); err == nil {
		t.Error("un id con .. creó una carpeta fuera del workspace")
	}
}

// Dos versiones en el mismo milisegundo no pueden pisarse.
func TestHistorialNoPisaVersionesDelMismoInstante(t *testing.T) {
	ws := newTrashWorkspace(t)
	at := time.Date(2026, 2, 14, 10, 0, 0, 0, time.UTC)

	a, err := ws.SaveVersion("sm_x", []byte("uno"), VersionEdit, at)
	if err != nil {
		t.Fatal(err)
	}
	b, err := ws.SaveVersion("sm_x", []byte("dos"), VersionEdit, at)
	if err != nil {
		t.Fatal(err)
	}
	if a.Version == b.Version {
		t.Fatalf("las dos versiones comparten nombre: %s", a.Version)
	}
	list, err := ws.Versions("sm_x")
	if err != nil || len(list) != 2 {
		t.Fatalf("Versions = %+v, %v", list, err)
	}
	if list[0].Version != b.Version {
		t.Errorf("la más reciente debería ir primero: %+v", list)
	}
}
