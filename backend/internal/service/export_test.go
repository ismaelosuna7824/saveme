package service

import (
	"context"
	"strings"
	"testing"
)

// escribeResumen deja un archivo gestionado en disco, como lo dejaría el agente o
// una persona desde su editor, y devuelve su ruta relativa.
func escribeResumen(t *testing.T, svc *Service, rel, id, title, category, cuerpo string) {
	t.Helper()
	contenido := "---\n" +
		"id: " + id + "\n" +
		"title: " + title + "\n" +
		"category: " + category + "\n" +
		"project: alfa\n" +
		"created_at: 2026-01-0" + id[len(id)-1:] + "T00:00:00Z\n" +
		"updated_at: 2026-01-0" + id[len(id)-1:] + "T00:00:00Z\n" +
		"author: humano\n" +
		"status: active\n" +
		"---\n\n" + cuerpo + "\n"

	if err := svc.Workspace().WriteAtomic(rel, []byte(contenido), false); err != nil {
		t.Fatalf("escribir %s: %v", rel, err)
	}
}

// El documento tiene que salir agrupado por categoría y en el orden de la
// taxonomía, no en el que devuelva la consulta: si no, dos exportaciones del
// mismo proyecto saldrían con las secciones en distinto orden.
func TestExportAgrupaYOrdena(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	// Se escriben en un orden que NO es el de la taxonomía (que pone feature, fix,
	// chore), para que el resultado no pueda salir bien por casualidad.
	escribeResumen(t, svc, "alfa/chores/deps.md", "sm_a1", "Subo dependencias", "chore", "Nada visible.")
	escribeResumen(t, svc, "alfa/features/export.md", "sm_a2", "Añado exportación", "feature", "Un documento por proyecto.")
	escribeResumen(t, svc, "alfa/fixes/watcher.md", "sm_a3", "Arreglo del watcher", "fix", "El watcher reindexaba notas.")

	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	out, err := svc.ExportProject(ctx, "alfa")
	if err != nil {
		t.Fatalf("ExportProject: %v", err)
	}

	if out.Project != "alfa" {
		t.Errorf("proyecto = %q, esperaba alfa", out.Project)
	}
	if out.Count != 3 {
		t.Fatalf("count = %d, esperaba 3", out.Count)
	}
	if len(out.Sections) != 3 {
		t.Fatalf("secciones = %d, esperaba 3", len(out.Sections))
	}

	got := make([]string, 0, len(out.Sections))
	for _, section := range out.Sections {
		got = append(got, section.Category)
	}
	if strings.Join(got, ",") != "feature,fix,chore" {
		t.Errorf("secciones = %v, esperaba [feature fix chore]", got)
	}

	// El cuerpo va sin frontmatter: el documento es para leerlo, no para
	// reindexarlo.
	for _, section := range out.Sections {
		for _, entry := range section.Summaries {
			if strings.Contains(entry.Body, "status: active") {
				t.Errorf("%s llevaba frontmatter en el cuerpo", entry.RelPath)
			}
			if entry.Title == "" || entry.RelPath == "" {
				t.Errorf("entrada incompleta: %+v", entry)
			}
		}
	}

	// Y cada resumen cae en la sección de su categoría.
	for _, section := range out.Sections {
		for _, entry := range section.Summaries {
			if !strings.Contains(entry.RelPath, section.Category) &&
				section.Category != "fix" { // "fix" vive en la carpeta "fixes"
				t.Errorf("%s está en la sección %q", entry.RelPath, section.Category)
			}
		}
	}
}

// Exportar un proyecto que no existe tiene que decirlo, no devolver un documento
// vacío que se lea como un proyecto sin nada dentro.
func TestExportDeProyectoInexistente(t *testing.T) {
	svc, _ := newTestService(t)

	if _, err := svc.ExportProject(context.Background(), "no-existe"); err == nil {
		t.Fatal("exportar un proyecto inexistente debería fallar")
	}
	if _, err := svc.ExportProject(context.Background(), "   "); err == nil {
		t.Fatal("exportar sin proyecto debería fallar")
	}
}

// Un resumen cuya categoría no está en la taxonomía —un archivo escrito a mano, o
// una categoría retirada— no puede desaparecer del documento por el camino.
func TestExportNoPierdeCategoriasDesconocidas(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Beta", "beta"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	manual := "---\n" +
		"id: sm_manual\n" +
		"title: Algo de una carpeta que ya no existe\n" +
		"category: inventada\n" +
		"project: beta\n" +
		"created_at: 2026-01-01T00:00:00Z\n" +
		"updated_at: 2026-01-01T00:00:00Z\n" +
		"author: humano\n" +
		"status: active\n" +
		"---\n\nUn cuerpo cualquiera.\n"

	if err := svc.Workspace().WriteAtomic("beta/inventada/manual.md", []byte(manual), false); err != nil {
		t.Fatalf("escribir a mano: %v", err)
	}
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	out, err := svc.ExportProject(ctx, "beta")
	if err != nil {
		t.Fatalf("ExportProject: %v", err)
	}

	if out.Count != 1 {
		t.Fatalf("count = %d, esperaba 1: el resumen se perdió por el camino", out.Count)
	}
	last := out.Sections[len(out.Sections)-1]
	if last.Category != "uncategorized" {
		t.Errorf("la categoría desconocida salió como %q, esperaba uncategorized", last.Category)
	}
}
