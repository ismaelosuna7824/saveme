package service

import (
	"context"
	"testing"
)

func escribeConArchivos(t *testing.T, svc *Service, rel, id, title string, archivos string) {
	t.Helper()
	contenido := "---\n" +
		"id: " + id + "\n" +
		"title: " + title + "\n" +
		"category: fix\n" +
		"project: alfa\n" +
		"created_at: 2026-03-10T09:00:00Z\n" +
		"updated_at: 2026-03-10T09:00:00Z\n" +
		"author: human\n" +
		"status: active\n" +
		"files_touched: [" + archivos + "]\n" +
		"---\n\nUn cuerpo.\n"
	if err := svc.Workspace().WriteAtomic(rel, []byte(contenido), false); err != nil {
		t.Fatalf("escribir %s: %v", rel, err)
	}
}

// La pregunta que responde esto es «voy a tocar watch.go, ¿qué se hizo aquí?».
func TestContextForFilesEncuentraPorArchivo(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}
	escribeConArchivos(t, svc, "alfa/fixes/watcher.md", "sm_c1", "Arreglo el watcher",
		`"backend/internal/watch/watch.go"`)
	escribeConArchivos(t, svc, "alfa/fixes/otro.md", "sm_c2", "Otra cosa",
		`"backend/internal/api/server.go"`)
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	items, err := svc.ContextForFiles(ctx, []string{"backend/internal/watch/watch.go"}, 10)
	if err != nil {
		t.Fatalf("ContextForFiles: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("devolvió %d resúmenes, esperaba 1", len(items))
	}
	if items[0].ID != "sm_c1" {
		t.Errorf("id = %q, esperaba sm_c1", items[0].ID)
	}

	// El parecido no vale: «watch.go» no puede casar con «watch.go.bak» ni con una
	// ruta que solo lo contenga por dentro.
	items, err = svc.ContextForFiles(ctx, []string{"backend/internal/watch/watch.go.bak"}, 10)
	if err != nil {
		t.Fatalf("ContextForFiles: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("una ruta parecida no debería casar; devolvió %d", len(items))
	}

	// Y varios archivos se deduplican.
	items, err = svc.ContextForFiles(ctx,
		[]string{"backend/internal/watch/watch.go", "backend/internal/api/server.go", ""}, 10)
	if err != nil {
		t.Fatalf("ContextForFiles: %v", err)
	}
	if len(items) != 2 {
		t.Errorf("con dos archivos esperaba 2 resúmenes, obtuve %d", len(items))
	}
}
