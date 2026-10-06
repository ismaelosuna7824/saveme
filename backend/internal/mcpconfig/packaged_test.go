package mcpconfig

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// fakeProfile monta un perfil de Windows de mentira: AppData real y la carpeta
// de paquetes. La lógica no depende del sistema, así que se prueba en cualquiera.
func fakeProfile(t *testing.T) packagedRoots {
	t.Helper()
	base := t.TempDir()
	r := packagedRoots{
		roaming: filepath.Join(base, "AppData", "Roaming"),
		local:   filepath.Join(base, "AppData", "Local"),
	}
	r.packages = filepath.Join(r.local, "Packages")
	for _, dir := range []string{r.roaming, r.packages} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return r
}

func touch(t *testing.T, path string, mtime time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, mtime, mtime); err != nil {
		t.Fatal(err)
	}
}

// TestClaudeDeLaStoreLeeSuCopiaPrivada es el fallo de Windows que motivó esto:
// SaveMe escribía en %APPDATA%\Claude y Claude, instalado desde la Store, leía
// su copia en LocalCache. Con las dos presentes, gana la privada.
func TestClaudeDeLaStoreLeeSuCopiaPrivada(t *testing.T) {
	r := fakeProfile(t)
	real := filepath.Join(r.roaming, "Claude", "claude_desktop_config.json")
	private := filepath.Join(r.packages, "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude", "claude_desktop_config.json")
	touch(t, real, time.Now())
	touch(t, private, time.Now().Add(-time.Hour))

	if got := r.resolveFile(real); got != private {
		t.Fatalf("con copia privada hay que usar esa:\n got %s\nwant %s", got, private)
	}
}

func TestSinCopiaPrivadaValeLaReal(t *testing.T) {
	r := fakeProfile(t)
	real := filepath.Join(r.roaming, "Claude", "claude_desktop_config.json")
	touch(t, real, time.Now())
	// La app empaquetada ya se abrió (tiene su carpeta), pero el archivo real
	// existía antes: Windows le abre ese, así que es ese el que hay que tocar.
	if err := os.MkdirAll(filepath.Join(r.packages, "Claude_x", "LocalCache", "Roaming", "Claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := r.resolveFile(real); got != real {
		t.Fatalf("got %s, want la real %s", got, real)
	}
}

// Sin el archivo en ningún sitio se usa la ruta de siempre, aunque la app de la
// Store ya tenga su carpeta privada: al no encontrar su copia, Windows le abre la
// normal, así que escribir ahí le llega igual.
func TestSinArchivoEnNingunSitioValeLaRutaDeSiempre(t *testing.T) {
	r := fakeProfile(t)
	real := filepath.Join(r.roaming, "Claude", "claude_desktop_config.json")
	if err := os.MkdirAll(filepath.Join(r.packages, "Claude_x", "LocalCache", "Roaming", "Claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got := r.resolveFile(real); got != real {
		t.Fatalf("got %s, want %s", got, real)
	}
}

func TestVariosPaquetesGanaElMasReciente(t *testing.T) {
	r := fakeProfile(t)
	real := filepath.Join(r.roaming, "Claude", "claude_desktop_config.json")
	old := filepath.Join(r.packages, "Claude_viejo", "LocalCache", "Roaming", "Claude", "claude_desktop_config.json")
	recent := filepath.Join(r.packages, "Claude_nuevo", "LocalCache", "Roaming", "Claude", "claude_desktop_config.json")
	touch(t, old, time.Now().Add(-48*time.Hour))
	touch(t, recent, time.Now())
	if got := r.resolveFile(real); got != recent {
		t.Fatalf("got %s, want %s", got, recent)
	}
}

func TestLocalAppDataYRutasFueraDeAppData(t *testing.T) {
	r := fakeProfile(t)
	// Hermes vive en %LOCALAPPDATA%: se virtualiza en LocalCache\Local.
	hermes := filepath.Join(r.local, "hermes", "config.yaml")
	private := filepath.Join(r.packages, "Hermes_x", "LocalCache", "Local", "hermes", "config.yaml")
	touch(t, private, time.Now())
	if got := r.resolveFile(hermes); got != private {
		t.Fatalf("got %s, want %s", got, private)
	}

	// Lo que está en la carpeta personal no lo virtualiza Windows.
	cursor := filepath.Join(filepath.Dir(filepath.Dir(r.roaming)), ".cursor", "mcp.json")
	if got := r.resolveFile(cursor); got != cursor {
		t.Fatalf("fuera de AppData no se toca: got %s", got)
	}
	// Ni lo que ya apunta dentro de un paquete.
	if got := r.resolveFile(private); got != private {
		t.Fatalf("una ruta de paquete se queda como está: got %s", got)
	}
}

func TestLaCarpetaPrivadaCuentaComoInstalado(t *testing.T) {
	r := fakeProfile(t)
	real := filepath.Join(r.roaming, "Claude")
	if got := r.resolveDir(real); got != real {
		t.Fatalf("sin nada, la ruta de siempre: got %s", got)
	}
	private := filepath.Join(r.packages, "Claude_x", "LocalCache", "Roaming", "Claude")
	if err := os.MkdirAll(private, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := r.resolveDir(real); got != private {
		t.Fatalf("got %s, want %s", got, private)
	}
}

func TestAppListedAceptaColetillasPeroNoPrefijos(t *testing.T) {
	installed := []string{"Cursor (User)", "Microsoft Visual Studio Code (User)", "OrcaSlicer", "claude"}
	cases := []struct {
		wanted []string
		want   bool
	}{
		{[]string{"Cursor"}, true},
		{[]string{"Microsoft Visual Studio Code"}, true},
		{[]string{"Claude"}, true}, // sin distinguir mayúsculas
		{[]string{"Orca"}, false},  // «OrcaSlicer» es otra cosa
		{[]string{"Kiro"}, false},
	}
	for _, tc := range cases {
		if got := appListed(installed, tc.wanted); got != tc.want {
			t.Errorf("appListed(%v) = %v, want %v", tc.wanted, got, tc.want)
		}
	}
}
