package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
	"github.com/ismaelosuna/saveme/backend/internal/workspace"
)

// confirmaNuevo escribe un resumen por el camino de siempre y devuelve su meta.
func confirmaNuevo(t *testing.T, svc *Service) domain.SummaryMeta {
	t.Helper()
	ctx := context.Background()
	prep, err := svc.Propose(ctx, sampleRequest())
	if err != nil {
		t.Fatalf("Propose: %v", err)
	}
	res, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: domain.ResolvedViaUI})
	if err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	return res.Meta
}

// actualizaComoAgente reescribe un resumen con una propuesta con target.
func actualizaComoAgente(t *testing.T, svc *Service, id, body string) {
	t.Helper()
	ctx := context.Background()
	req := sampleRequest()
	req.Body = body
	req.Target = id
	prep, err := svc.Propose(ctx, req)
	if err != nil {
		t.Fatalf("Propose con target: %v", err)
	}
	if _, err := svc.Confirm(ctx, prep.Proposal.Token, Decision{Accepted: true, Via: domain.ResolvedViaUI}); err != nil {
		t.Fatalf("Confirm de la actualización: %v", err)
	}
}

func versiones(t *testing.T, svc *Service, id string) []workspace.VersionEntry {
	t.Helper()
	list, err := svc.Versions(context.Background(), id)
	if err != nil {
		t.Fatalf("Versions: %v", err)
	}
	return list
}

// El caso para el que existe el historial: el agente reescribe un resumen y se
// deja una sección. Lo que había tiene que poder verse y volver, y volver también
// tiene que poder deshacerse.
func TestHistorialRecuperaLoQueElAgenteReescribio(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)
	meta := confirmaNuevo(t, svc)
	original := readBody(t, root, meta.RelPath)

	actualizaComoAgente(t, svc, meta.ID, "Versión nueva, sin la sección de detalles.")
	reescrito := readBody(t, root, meta.RelPath)
	if strings.Contains(reescrito, "## Detalles") {
		t.Fatal("la actualización debería haber reemplazado el cuerpo")
	}

	list := versiones(t, svc, meta.ID)
	if len(list) != 1 || list[0].Reason != workspace.VersionAgent {
		t.Fatalf("esperaba una versión del agente, hay %+v", list)
	}
	_, content, enDisco, err := svc.VersionContent(ctx, meta.ID, list[0].Version)
	if err != nil {
		t.Fatalf("VersionContent: %v", err)
	}
	if content != original {
		t.Fatalf("la versión guardada no es lo que había:\n%s", content)
	}
	if enDisco != reescrito {
		t.Fatal("la versión tiene que llegar junto a lo que hay ahora en disco, para compararlas")
	}

	actual, _, _ := svc.Read(ctx, meta.ID)
	res, err := svc.RestoreVersion(ctx, meta.ID, list[0].Version, actual.ContentHash)
	if err != nil || res.Mismatch {
		t.Fatalf("RestoreVersion: res=%+v err=%v", res, err)
	}
	if got := readBody(t, root, meta.RelPath); got != original {
		t.Fatalf("restaurar no devolvió el texto original:\n%s", got)
	}

	// Lo que había antes de restaurar también queda: restaurar se deshace igual.
	list = versiones(t, svc, meta.ID)
	if len(list) != 2 || list[0].Reason != workspace.VersionRestore {
		t.Fatalf("esperaba la versión de antes de restaurar arriba, hay %+v", list)
	}
	if _, content, _, _ := svc.VersionContent(ctx, meta.ID, list[0].Version); content != reescrito {
		t.Fatalf("la versión previa a restaurar no es el texto del agente:\n%s", content)
	}
}

// El editor guarda cada segundo: eso no puede convertirse en cien versiones a
// mitad de frase. Pero lo que escribió el agente justo antes sí tiene que
// quedar, aunque el usuario lo edite al momento.
func TestHistorialAgrupaEdicionesPeroNoLasDelAgente(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)
	meta := confirmaNuevo(t, svc)
	original := readBody(t, root, meta.RelPath)

	guarda := func(content string) {
		t.Helper()
		m, _, _ := svc.Read(ctx, meta.ID)
		if _, err := svc.Save(ctx, meta.ID, content, m.ContentHash); err != nil {
			t.Fatalf("Save: %v", err)
		}
	}
	guarda(original + "\nuno\n")
	guarda(original + "\nuno dos\n")
	guarda(original + "\nuno dos tres\n")

	list := versiones(t, svc, meta.ID)
	if len(list) != 1 || list[0].Reason != workspace.VersionEdit {
		t.Fatalf("tres guardados seguidos deberían dejar una versión, hay %+v", list)
	}
	if _, content, _, _ := svc.VersionContent(ctx, meta.ID, list[0].Version); content != original {
		t.Fatal("la versión de la sesión de edición tiene que ser lo de antes de empezar")
	}

	actualizaComoAgente(t, svc, meta.ID, "El agente lo reescribe.")
	delAgente := readBody(t, root, meta.RelPath)
	guarda(delAgente + "\nretoque\n")

	list = versiones(t, svc, meta.ID)
	if len(list) != 3 {
		t.Fatalf("esperaba edición, agente y edición: %+v", list)
	}
	if _, content, _, _ := svc.VersionContent(ctx, meta.ID, list[0].Version); content != delAgente {
		t.Fatal("editar justo después del agente perdió el texto del agente")
	}
}

// Guardar el mismo texto no es reemplazar nada: no deja versión.
func TestHistorialNoGuardaSiNoCambiaNada(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)
	meta := confirmaNuevo(t, svc)

	if _, err := svc.Save(ctx, meta.ID, readBody(t, root, meta.RelPath), meta.ContentHash); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if list := versiones(t, svc, meta.ID); len(list) != 0 {
		t.Fatalf("guardar sin cambios dejó versiones: %+v", list)
	}
}

// Restaurar pasa por el mismo control que el editor: si el archivo cambió desde
// que se cargó, no se pisa.
func TestRestaurarVersionRespetaElHashBase(t *testing.T) {
	ctx := context.Background()
	svc, root := newTestService(t)
	meta := confirmaNuevo(t, svc)
	actualizaComoAgente(t, svc, meta.ID, "Segunda.")
	antes := readBody(t, root, meta.RelPath)

	list := versiones(t, svc, meta.ID)
	res, err := svc.RestoreVersion(ctx, meta.ID, list[0].Version, "hash-viejo")
	if err != nil {
		t.Fatalf("RestoreVersion: %v", err)
	}
	if !res.Mismatch {
		t.Fatal("con un hash base viejo debería avisar del conflicto")
	}
	if got := readBody(t, root, meta.RelPath); got != antes {
		t.Fatal("un conflicto no debería escribir nada")
	}
}

// La versión llega por la URL: nada con forma de ruta puede leerse.
func TestVersionConFormaDeRutaSeRechaza(t *testing.T) {
	ctx := context.Background()
	svc, _ := newTestService(t)
	meta := confirmaNuevo(t, svc)

	for _, hostil := range []string{"../../saveme", "20260101-000000.000.edit/../../x", "", "20260101-000000.000.borrar"} {
		if _, _, _, err := svc.VersionContent(ctx, meta.ID, hostil); !errors.Is(err, ErrInvalid) {
			t.Errorf("VersionContent(%q) = %v, esperaba ErrInvalid", hostil, err)
		}
	}
	if _, _, _, err := svc.VersionContent(ctx, meta.ID, "20260101-000000.000.edit"); !errors.Is(err, ErrNotFound) {
		t.Errorf("una versión que no existe debería ser ErrNotFound, dio %v", err)
	}
}

// Borrar de verdad se lleva las versiones; archivar no, y vaciar la papelera sí.
func TestBorrarDeVerdadSeLlevaElHistorial(t *testing.T) {
	ctx := context.Background()

	t.Run("borrado duro", func(t *testing.T) {
		svc, _ := newTestService(t)
		meta := confirmaNuevo(t, svc)
		actualizaComoAgente(t, svc, meta.ID, "Segunda.")
		if _, err := svc.Delete(ctx, meta.ID, true); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if list, _ := svc.Workspace().Versions(meta.ID); len(list) != 0 {
			t.Fatalf("el borrado duro dejó versiones: %+v", list)
		}
	})

	t.Run("papelera", func(t *testing.T) {
		svc, _ := newTestService(t)
		meta := confirmaNuevo(t, svc)
		actualizaComoAgente(t, svc, meta.ID, "Segunda.")
		if _, err := svc.Delete(ctx, meta.ID, false); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if list, _ := svc.Workspace().Versions(meta.ID); len(list) != 1 {
			t.Fatalf("archivar no debería tocar el historial: %+v", list)
		}
		if _, err := svc.EmptyTrash(ctx); err != nil {
			t.Fatalf("EmptyTrash: %v", err)
		}
		if list, _ := svc.Workspace().Versions(meta.ID); len(list) != 0 {
			t.Fatalf("vaciar la papelera dejó el historial: %+v", list)
		}
	})
}
