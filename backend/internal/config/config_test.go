package config

import "testing"


// La lista de raíces recientes es lo que permite reconocer un workspace que se ha
// movido: vive en el archivo de configuración, que está **fuera** de la carpeta
// que se mueve.
func TestRememberRootPoneLaUltimaPrimeroYSinRepetidos(t *testing.T) {
	cfg := Defaults()

	cfg = cfg.RememberRoot("/tmp/a")
	cfg = cfg.RememberRoot("/tmp/b")
	cfg = cfg.RememberRoot("/tmp/a")

	if len(cfg.RecentRoots) != 2 {
		t.Fatalf("raíces = %v, esperaba 2 sin repetidos", cfg.RecentRoots)
	}
	if cfg.RecentRoots[0] != "/tmp/a" {
		t.Errorf("la última debería ir primero: %v", cfg.RecentRoots)
	}
	if cfg.RecentRoots[1] != "/tmp/b" {
		t.Errorf("la anterior debería conservarse: %v", cfg.RecentRoots)
	}
}

func TestRememberRootNoCrecenSinLimite(t *testing.T) {
	cfg := Defaults()
	for _, root := range []string{"/tmp/1", "/tmp/2", "/tmp/3", "/tmp/4", "/tmp/5", "/tmp/6", "/tmp/7", "/tmp/8"} {
		cfg = cfg.RememberRoot(root)
	}
	if len(cfg.RecentRoots) > MaxRecentRoots {
		t.Errorf("se recuerdan %d raíces, el tope es %d", len(cfg.RecentRoots), MaxRecentRoots)
	}
	// Y la más reciente no se ha caído de la lista.
	if cfg.RecentRoots[0] != "/tmp/8" {
		t.Errorf("la última se perdió: %v", cfg.RecentRoots)
	}
}

func TestRememberRootIgnoraVacio(t *testing.T) {
	cfg := Defaults().RememberRoot("   ")
	if len(cfg.RecentRoots) != 0 {
		t.Errorf("una raíz vacía no debería recordarse: %v", cfg.RecentRoots)
	}
}
