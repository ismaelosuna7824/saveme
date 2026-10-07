package workspace

import (
	"testing"
	"time"
)

// El nombre lleva el día en que lo vivió quien lo escribió. Un resumen de las
// 22:00 en Los Ángeles son ya las 05:00 del día siguiente en UTC, y con la fecha
// UTC el nombre y la fecha que enseña la interfaz no coincidían.
func TestSummaryFilenameUsaLaFechaLocal(t *testing.T) {
	la, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Skipf("sin base de zonas horarias: %v", err)
	}
	prev := time.Local
	time.Local = la
	t.Cleanup(func() { time.Local = prev })

	created := time.Date(2026, 9, 16, 5, 0, 52, 0, time.UTC) // 2026-09-15 22:00 en LA
	got := SummaryFilename(created, "Chrome reutilizado conserva sus colores")
	if want := "2026-09-15-chrome-reutilizado-conserva-sus-colores.md"; got != want {
		t.Errorf("SummaryFilename = %q; esperaba %q", got, want)
	}
}
