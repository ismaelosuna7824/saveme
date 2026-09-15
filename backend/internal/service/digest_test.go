package service

import (
	"context"
	"testing"
	"time"
)

// escribeConFecha deja un resumen con una fecha de creación concreta.
func escribeConFecha(t *testing.T, svc *Service, rel, id, title, fecha string) {
	t.Helper()
	contenido := "---\n" +
		"id: " + id + "\n" +
		"title: " + title + "\n" +
		"category: feature\n" +
		"project: alfa\n" +
		"created_at: " + fecha + "\n" +
		"updated_at: " + fecha + "\n" +
		"author: human\n" +
		"status: active\n" +
		"---\n\nUn cuerpo.\n"
	if err := svc.Workspace().WriteAtomic(rel, []byte(contenido), false); err != nil {
		t.Fatalf("escribir %s: %v", rel, err)
	}
}

// El digest enseña lo de la ventana y **nada más**. Un resumen de hace un mes
// colándose en «esta semana» hace que el digest mienta, y eso se nota al leerlo.
func TestDigestSoloTraeLoDeLaVentana(t *testing.T) {
	svc, _ := newTestService(t)
	ctx := context.Background()

	if _, err := svc.EnsureProject(ctx, "Alfa", "alfa"); err != nil {
		t.Fatalf("EnsureProject: %v", err)
	}

	// Fechas relativas a hoy: así la prueba no caduca sola dentro de un año.
	ahora := time.Now().UTC()
	escribeConFecha(t, svc, "alfa/features/reciente.md", "sm_r", "Reciente",
		ahora.AddDate(0, 0, -1).Format(time.RFC3339))
	// Dentro del tope de 365 días pero fuera de la ventana por defecto.
	escribeConFecha(t, svc, "alfa/features/viejo.md", "sm_v", "Viejo",
		ahora.AddDate(0, 0, -60).Format(time.RFC3339))
	if _, err := svc.Reindex(ctx); err != nil {
		t.Fatalf("Reindex: %v", err)
	}

	// Con la ventana máxima entran los dos; sirve para comprobar que lo que deja
	// fuera al viejo es la fecha, no que no esté indexado.
	todos, err := svc.Digest(ctx, DigestMaxDias)
	if err != nil {
		t.Fatalf("Digest: %v", err)
	}
	if todos.Count != 2 {
		t.Fatalf("con ventana máxima count = %d, esperaba 2", todos.Count)
	}

	// Y con la ventana por defecto se queda fuera el viejo.
	reciente, err := svc.Digest(ctx, DigestDaysPorDefecto)
	if err != nil {
		t.Fatalf("Digest: %v", err)
	}
	for _, grupo := range reciente.Groups {
		for _, entrada := range grupo.Entries {
			if entrada.ID == "sm_v" {
				t.Error("el resumen viejo no debería estar en la ventana por defecto")
			}
		}
	}
	if reciente.Projects != 0 && reciente.Projects != 1 {
		t.Errorf("projects = %d, esperaba 0 o 1", reciente.Projects)
	}
}

// Un digest sin nada es una respuesta válida, no un error: «no hiciste nada» es
// exactamente lo que hay que poder decir.
func TestDigestVacioNoEsUnError(t *testing.T) {
	svc, _ := newTestService(t)

	out, err := svc.Digest(context.Background(), 7)
	if err != nil {
		t.Fatalf("un digest vacío no debería fallar: %v", err)
	}
	if out.Count != 0 {
		t.Errorf("count = %d, esperaba 0", out.Count)
	}
	if out.Groups == nil {
		t.Error("Groups debería ser una lista vacía, no nulo: el JSON tiene que salir []")
	}
	if out.Days != 7 {
		t.Errorf("days = %d, esperaba 7", out.Days)
	}
}

// Los días pedidos se acotan: `days=100000` no puede obligar a recorrerlo todo.
func TestDigestAcotaLosDias(t *testing.T) {
	svc, _ := newTestService(t)

	out, err := svc.Digest(context.Background(), 100000)
	if err != nil {
		t.Fatalf("Digest: %v", err)
	}
	if out.Days != DigestMaxDias {
		t.Errorf("days = %d, esperaba el tope %d", out.Days, DigestMaxDias)
	}

	cero, err := svc.Digest(context.Background(), 0)
	if err != nil {
		t.Fatalf("Digest: %v", err)
	}
	if cero.Days != DigestDaysPorDefecto {
		t.Errorf("days = %d, esperaba el de por defecto %d", cero.Days, DigestDaysPorDefecto)
	}
}
