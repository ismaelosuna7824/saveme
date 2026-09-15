package main

import (
	"strings"
	"testing"
	"time"

	"github.com/ismaelosuna/saveme/backend/internal/service"
)

// `--until` es la trampa clásica de las fechas: pidiendo «hasta el 14» lo que
// nadie espera es que se quede fuera todo lo del día 14.
func TestParseFechaFinIncluyeElDiaEntero(t *testing.T) {
	fin, err := parseFechaFin("2026-02-14")
	if err != nil {
		t.Fatalf("parseFechaFin: %v", err)
	}
	if fin.Format("2006-01-02") != "2026-02-14" {
		t.Errorf("fin = %s, esperaba seguir siendo el día 14", fin.Format(time.RFC3339))
	}

	tarde := time.Date(2026, 2, 14, 23, 59, 0, 0, time.Local)
	if tarde.After(fin) {
		t.Error("lo escrito a las 23:59 del día 14 se está quedando fuera")
	}

	siguiente := time.Date(2026, 2, 15, 0, 0, 0, 0, time.Local)
	if !siguiente.After(fin) {
		t.Error("lo del día 15 no puede entrar")
	}
}

// La fecha de inicio empieza el día, y vacío significa «lo que corresponda»: el
// núcleo pone entonces su ventana por defecto.
func TestParseFechaInicio(t *testing.T) {
	inicio, err := parseFechaInicio("2026-02-01")
	if err != nil {
		t.Fatalf("parseFechaInicio: %v", err)
	}
	if inicio.Format("2006-01-02") != "2026-02-01" {
		t.Errorf("inicio = %s, esperaba el 1 de febrero", inicio.Format(time.RFC3339))
	}

	vacio, err := parseFechaInicio("")
	if err != nil {
		t.Fatalf("una fecha vacía no es un error: %v", err)
	}
	if !vacio.IsZero() {
		t.Error("una fecha vacía debería quedarse en cero, no inventarse una")
	}

	if _, err := parseFechaInicio("14/02/2026"); err == nil {
		t.Error("un formato que no es AAAA-MM-DD tiene que avisar, no adivinar")
	}
}

// El documento sale con los nombres de la taxonomía, no con la clave cruda, y
// lleva el día y la ruta para poder rastrear cada línea.
func TestRenderChangelog(t *testing.T) {
	cuando := time.Date(2026, 2, 10, 12, 0, 0, 0, time.UTC)
	out := renderChangelog(&service.Changelog{
		Project: "alfa",
		From:    time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC),
		To:      time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC),
		Count:   1,
		Sections: []service.ChangelogSection{{
			Category: "feature",
			Entries: []service.ChangelogEntry{{
				Title:       "Añado el briefing",
				SummaryLine: "Una pantalla que dice dónde se dejó el proyecto.",
				RelPath:     "alfa/features/briefing.md",
				CreatedAt:   cuando,
				CommitSHA:   "abcdef1234567890",
			}},
		}},
	})

	for _, esperado := range []string{
		"# alfa — cambios del 2026-02-01 al 2026-02-14",
		"## Feature",
		"**Añado el briefing**",
		"2026-02-10",
		"abcdef1", // el hash corto, no los dieciséis caracteres
		"`alfa/features/briefing.md`",
		"Una pantalla que dice dónde se dejó el proyecto.",
	} {
		if !strings.Contains(out, esperado) {
			t.Errorf("el documento no contiene %q:\n%s", esperado, out)
		}
	}
	if strings.Contains(out, "abcdef1234567890") {
		t.Error("el hash entero no debería salir: estorba y no aporta")
	}
}

// Un rango sin nada lo dice con palabras. Un documento con solo el título parece
// roto.
func TestRenderChangelogVacio(t *testing.T) {
	out := renderChangelog(&service.Changelog{
		Project: "alfa",
		From:    time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC),
		To:      time.Date(2026, 2, 14, 0, 0, 0, 0, time.UTC),
	})

	if !strings.Contains(out, "Sin cambios apuntados") {
		t.Errorf("un changelog vacío tiene que decirlo:\n%s", out)
	}
}
