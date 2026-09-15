package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func newTrashWorkspace(t *testing.T) *Workspace {
	t.Helper()
	ws, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("workspace.New: %v", err)
	}
	return ws
}

func writeFile(t *testing.T, ws *Workspace, rel, body string) {
	t.Helper()
	abs, err := ws.Abs(rel)
	if err != nil {
		t.Fatalf("Abs(%q): %v", rel, err)
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(abs, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func exists(t *testing.T, ws *Workspace, rel string) bool {
	t.Helper()
	abs, err := ws.Abs(rel)
	if err != nil {
		t.Fatalf("Abs(%q): %v", rel, err)
	}
	_, err = os.Stat(abs)
	return err == nil
}

// Borrar y listar tiene que devolver la ruta original: es lo único que permite
// restaurar después, y es lo que el usuario reconoce en la lista.
func TestTrashListaLaRutaOriginal(t *testing.T) {
	ws := newTrashWorkspace(t)
	writeFile(t, ws, "api-pagos/features/2026-02-14-algo.md", "hola")

	if _, err := ws.Delete("api-pagos/features/2026-02-14-algo.md", false); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	entries, err := ws.Trash()
	if err != nil {
		t.Fatalf("Trash: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("esperaba 1 entrada, hay %d", len(entries))
	}
	got := entries[0]
	if got.RelPath != "api-pagos/features/2026-02-14-algo.md" {
		t.Errorf("RelPath = %q", got.RelPath)
	}
	if got.Name != "2026-02-14-algo.md" {
		t.Errorf("Name = %q", got.Name)
	}
	if got.Size != int64(len("hola")) {
		t.Errorf("Size = %d", got.Size)
	}
	if got.DeletedAt.IsZero() {
		t.Error("DeletedAt salió vacío: el sello no se pudo leer")
	}
}

// Restaurar devuelve el archivo a su sitio con su contenido.
func TestTrashRestauraEnSuSitio(t *testing.T) {
	ws := newTrashWorkspace(t)
	writeFile(t, ws, "api-pagos/docs/nota.md", "contenido original")

	if _, err := ws.Delete("api-pagos/docs/nota.md", false); err != nil {
		t.Fatal(err)
	}
	if exists(t, ws, "api-pagos/docs/nota.md") {
		t.Fatal("el archivo sigue en su sitio tras borrarlo")
	}

	entries, _ := ws.Trash()
	restored, err := ws.Restore(entries[0].TrashRel)
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if restored != "api-pagos/docs/nota.md" {
		t.Errorf("restaurado en %q", restored)
	}

	abs, _ := ws.Abs(restored)
	body, err := os.ReadFile(abs)
	if err != nil {
		t.Fatalf("leer restaurado: %v", err)
	}
	if string(body) != "contenido original" {
		t.Errorf("el contenido no sobrevivió: %q", body)
	}
	// Y la papelera queda limpia: las carpetas del sello no se acumulan.
	if entries, _ := ws.Trash(); len(entries) != 0 {
		t.Errorf("la papelera debería quedar vacía, hay %d", len(entries))
	}
}

// Restaurar encima de algo más nuevo sería perder trabajo en silencio: se niega.
func TestTrashNoPisaUnArchivoMasNuevo(t *testing.T) {
	ws := newTrashWorkspace(t)
	writeFile(t, ws, "p/docs/nota.md", "viejo")
	if _, err := ws.Delete("p/docs/nota.md", false); err != nil {
		t.Fatal(err)
	}
	writeFile(t, ws, "p/docs/nota.md", "nuevo")

	entries, _ := ws.Trash()
	_, err := ws.Restore(entries[0].TrashRel)
	if err == nil {
		t.Fatal("debería haberse negado a pisar el archivo nuevo")
	}
	var existsErr *ExistsError
	if !errors.As(err, &existsErr) {
		t.Errorf("el error debería ser ExistsError, es %T: %v", err, err)
	}

	abs, _ := ws.Abs("p/docs/nota.md")
	body, _ := os.ReadFile(abs)
	if string(body) != "nuevo" {
		t.Errorf("se perdió el archivo nuevo: %q", body)
	}
}

// Dos borrados del mismo archivo en el mismo segundo no pueden pisarse: el sello
// tiene resolución de un segundo y sin sufijo el segundo rename reemplazaría al
// primero.
func TestTrashNoPierdeDosBorradosSeguidos(t *testing.T) {
	ws := newTrashWorkspace(t)
	writeFile(t, ws, "p/docs/nota.md", "primera")
	if _, err := ws.Delete("p/docs/nota.md", false); err != nil {
		t.Fatal(err)
	}
	writeFile(t, ws, "p/docs/nota.md", "segunda")
	if _, err := ws.Delete("p/docs/nota.md", false); err != nil {
		t.Fatal(err)
	}

	entries, err := ws.Trash()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("se perdió un borrado: hay %d entradas, esperaba 2", len(entries))
	}
}

// La ruta que llega para restaurar es del cliente: no puede sacar nada de la
// papelera ni tocar archivos de fuera.
func TestTrashRechazaRutasQueSeEscapan(t *testing.T) {
	ws := newTrashWorkspace(t)
	writeFile(t, ws, "p/docs/nota.md", "x")
	if _, err := ws.Delete("p/docs/nota.md", false); err != nil {
		t.Fatal(err)
	}

	for _, bad := range []string{
		"",
		"..",
		"p/docs/nota.md",                // no está en la papelera
		".saveme/trash",                 // sin sello ni archivo
		".saveme/trash/20260101-000000", // sin archivo
		".saveme/trash/20260101-000000/../../../etc", // intento de escape
		"/etc/passwd", // absoluta
		".saveme/trash/20260101-000000/.saveme/x.md", // la original apunta al estado
	} {
		if _, err := ws.Restore(bad); err == nil {
			t.Errorf("Restore(%q) debería fallar", bad)
		}
	}
}

// Vaciar cuenta lo que se lleva y deja la papelera utilizable.
func TestTrashVacia(t *testing.T) {
	ws := newTrashWorkspace(t)
	writeFile(t, ws, "p/docs/a.md", "a")
	writeFile(t, ws, "p/docs/b.md", "b")
	for _, rel := range []string{"p/docs/a.md", "p/docs/b.md"} {
		if _, err := ws.Delete(rel, false); err != nil {
			t.Fatal(err)
		}
	}

	n, err := ws.EmptyTrash()
	if err != nil {
		t.Fatalf("EmptyTrash: %v", err)
	}
	if n != 2 {
		t.Errorf("vaciado = %d, esperaba 2", n)
	}
	if entries, _ := ws.Trash(); len(entries) != 0 {
		t.Errorf("quedan %d entradas tras vaciar", len(entries))
	}
}

// Una papelera que no existe no es un error: es que no hay nada borrado.
func TestTrashVaciaNoEsUnError(t *testing.T) {
	ws := newTrashWorkspace(t)
	entries, err := ws.Trash()
	if err != nil {
		t.Fatalf("Trash sin papelera: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("esperaba 0 entradas, hay %d", len(entries))
	}
}

// --- enlaces simbólicos ------------------------------------------------------

// Un enlace dentro del workspace que apunte fuera no puede dejar escribir fuera.
//
// Las comprobaciones de `SafeRel` y `Abs` son léxicas: miran la cadena, y
// `proyecto/features -> /etc` es una cadena perfectamente normal. Sin resolver el
// enlace, un agente podía escribir dónde quisiera con una ruta que parecía de
// dentro.
func TestAbsRechazaUnEnlaceQueSaleDeLaRaiz(t *testing.T) {
	ws := newTrashWorkspace(t)

	// Un directorio fuera de la raíz, y un enlace dentro que apunta a él.
	outside := t.TempDir()
	linkAbs, err := ws.Abs("proyecto")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(linkAbs, 0o755); err != nil {
		t.Fatal(err)
	}
	inside := filepath.Join(linkAbs, "features")
	if err := os.Symlink(outside, inside); err != nil {
		t.Skipf("no pude crear el enlace: %v", err)
	}

	if _, err := ws.Abs("proyecto/features/colado.md"); err == nil {
		t.Fatal("debería haber rechazado la ruta que cruza el enlace")
	}
}

// El caso normal tiene que seguir funcionando: directorios y archivos de verdad.
func TestAbsSigueAceptandoRutasNormales(t *testing.T) {
	ws := newTrashWorkspace(t)
	for _, rel := range []string{
		"proyecto/features/2026-01-01-nota.md",
		"proyecto/docs/otra.md",
		"proyecto",
	} {
		if _, err := ws.Abs(rel); err != nil {
			t.Errorf("Abs(%q) falló en una ruta normal: %v", rel, err)
		}
	}
}

// Un enlace que apunta **dentro** de la raíz no es un problema y no puede
// rechazarse: hay gente que organiza su workspace así.
func TestAbsAceptaUnEnlaceQueNoSale(t *testing.T) {
	ws := newTrashWorkspace(t)
	real, err := ws.Abs("proyecto/docs")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(real, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(filepath.Dir(real), "enlace")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("no pude crear el enlace: %v", err)
	}

	if _, err := ws.Abs("proyecto/enlace/nota.md"); err != nil {
		t.Errorf("un enlace que no sale de la raíz debería aceptarse: %v", err)
	}
}
