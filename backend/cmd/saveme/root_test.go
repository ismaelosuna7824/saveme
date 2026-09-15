package main

import "testing"

// Un `--root` es de esta ejecución y no puede acabar escrito en la configuración.
//
// Esto no es una precaución teórica: `Save()` escribe el archivo entero, así que
// persistir la lista de recientes arrastraba el `--root` con ella. Pasó de
// verdad — un `serve --root /tmp/x` de prueba dejó la app abriendo una carpeta
// temporal vacía, y el diario del usuario desapareció de su vista sin un aviso.
func TestUnRootDePasoNoSePersiste(t *testing.T) {
	casos := []struct {
		nombre   string
		rootFlag string
		fromEnv  bool
		quiero   bool
	}{
		{"sin flag ni entorno: la raíz es la del usuario y se recuerda", "", false, true},
		{"con --root no se toca el archivo", "/tmp/prueba", false, false},
		{"con SAVEME_ROOT tampoco", "", true, false},
		{"con los dos, menos", "/tmp/prueba", true, false},
	}

	for _, caso := range casos {
		t.Run(caso.nombre, func(t *testing.T) {
			if got := shouldPersistRoot(caso.rootFlag, caso.fromEnv); got != caso.quiero {
				t.Errorf("shouldPersistRoot(%q, %v) = %v, esperaba %v",
					caso.rootFlag, caso.fromEnv, got, caso.quiero)
			}
		})
	}
}
