package domain

import (
	"strings"
	"testing"
	"time"
)

func TestSlug(t *testing.T) {
	cases := map[string]string{
		"Implementación del Editor Márkdown!": "implementacion-del-editor-markdown",
		"  SaveMe App  ":                      "saveme-app",
		"fix: race en el watcher":             "fix-race-en-el-watcher",
		"a___b":                               "a-b",
		"Ñandú y Çedilla":                     "nandu-y-cedilla",
		"":                                    "",
		"!!!":                                 "",
	}
	for in, want := range cases {
		if got := Slug(in); got != want {
			t.Errorf("Slug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSlugTruncated(t *testing.T) {
	long := strings.Repeat("palabra ", 30)
	got := SlugTruncated(long)
	if len(got) > SlugLimit {
		t.Fatalf("len = %d, want <= %d", len(got), SlugLimit)
	}
	if strings.HasSuffix(got, "-") {
		t.Fatalf("no debe terminar en guion: %q", got)
	}
}

func TestNewIDIsSortableAndPrefixed(t *testing.T) {
	a := NewID()
	if !strings.HasPrefix(a, "sm_") {
		t.Fatalf("esperaba prefijo sm_, obtuve %q", a)
	}
	if len(a) != 3+26 {
		t.Fatalf("largo = %d, want 29 (%q)", len(a), a)
	}

	// La garantía es que el prefijo de timestamp (los 10 primeros caracteres
	// tras "sm_") no retrocede: por eso los IDs sirven como criterio de orden.
	prefix := func(id string) string { return id[3:13] }
	prev := prefix(a)
	for i := 0; i < 200; i++ {
		got := prefix(NewID())
		if got < prev {
			t.Fatalf("el prefijo de timestamp retrocedió: %q -> %q", prev, got)
		}
		prev = got
	}

	// Cruzando a otro milisegundo el ID completo sí es estrictamente mayor.
	// Dentro del mismo milisegundo manda la parte aleatoria, así que hay que
	// esperar para poder afirmar un orden total.
	time.Sleep(3 * time.Millisecond)
	b := NewID()
	if a >= b {
		t.Fatalf("IDs en milisegundos distintos deben ordenar: %q >= %q", a, b)
	}
}

func TestNewTokenUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 1000; i++ {
		tok := NewToken()
		if !strings.HasPrefix(tok, "pt_") {
			t.Fatalf("esperaba prefijo pt_: %q", tok)
		}
		if seen[tok] {
			t.Fatalf("token duplicado: %q", tok)
		}
		seen[tok] = true
	}
}

func TestCategoryLookup(t *testing.T) {
	for _, in := range []string{"fix", "FIX", "fixes", "Fix "} {
		c, ok := CategoryByKey(in)
		if !ok || c.Key != "fix" {
			t.Errorf("CategoryByKey(%q) = %+v, %v", in, c, ok)
		}
	}
	if _, ok := CategoryByKey("banana"); ok {
		t.Error("banana no es una categoría válida")
	}
	if c := CategoryByFolder("carpeta-inventada"); c.Key != CategoryUncategorized {
		t.Errorf("carpeta desconocida debería caer en uncategorized, dio %q", c.Key)
	}
	if len(Categories()) != 9 {
		t.Errorf("esperaba 9 categorías canónicas, hay %d", len(Categories()))
	}
}

func TestInferCategory(t *testing.T) {
	cases := []struct {
		name  string
		title string
		body  string
		want  string
	}{
		{
			name:  "feature por implementación",
			title: "Implementación del editor markdown con preview",
			body:  "Se agregó un editor CodeMirror que permite ver el markdown renderizado.",
			want:  "feature",
		},
		{
			name:  "fix por bug",
			title: "Fix: el watcher crasheaba con archivos vacíos",
			body:  "El error ocurría porque el parser recibía un buffer vacío.",
			want:  "fix",
		},
		{
			name:  "chore por dependencias",
			title: "Bump de dependencias y limpieza",
			body:  "Se actualizó la versión de sqlite y se corrió el linter.",
			want:  "chore",
		},
		{
			name:  "infra por CI",
			title: "Pipeline de CI con github actions",
			body:  "Se agregó un workflow que corre los tests en cada push.",
			want:  "infra",
		},
		{
			name:  "docs",
			title: "Documentación del contrato de la API",
			body:  "Se escribió la guía de endpoints en el README.",
			want:  "docs",
		},
		{
			name:  "incident",
			title: "Incidente: caída de producción por migración",
			body:  "El post-mortem muestra que el rollback tardó 20 minutos.",
			want:  "incident",
		},
		{
			name:  "refactor",
			title: "Refactor del store para desacoplar SQL",
			body:  "Se extrajo la capa de consultas sin cambiar comportamiento.",
			want:  "refactor",
		},
		{
			name:  "sin señales cae en feature con baja confianza",
			title: "Zzz",
			body:  "Qqq",
			want:  "feature",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := InferCategory(tc.title, tc.body)
			if got.Category != tc.want {
				t.Errorf("categoría = %q, want %q (razón: %s)", got.Category, tc.want, got.Reason)
			}
			if got.Reason == "" {
				t.Error("la inferencia siempre debe explicar su razón")
			}
			if got.Confidence < 0.15 || got.Confidence > 1 {
				t.Errorf("confianza fuera de rango: %v", got.Confidence)
			}
		})
	}
}

func TestContainsSignalRespectsWordBoundaries(t *testing.T) {
	text := normalizeForSignals("Additional metadata for the add flow")
	if containsSignal(text, "add") != true {
		t.Error("debería encontrar la palabra add")
	}
	text2 := normalizeForSignals("Additional metadata")
	if containsSignal(text2, "add") {
		t.Error("add no debe matchear dentro de additional")
	}
	if !containsSignal(normalizeForSignals("Root Cause Analysis"), "root cause") {
		t.Error("debería encontrar la frase root cause")
	}
}

func TestAlternativesNeverEmptyAndExcludeWinner(t *testing.T) {
	alts := Alternatives("Fix: crash al arrancar", "Se corrigió un panic.", "fix", 3)
	if len(alts) != 3 {
		t.Fatalf("esperaba 3 alternativas, hay %d", len(alts))
	}
	for _, a := range alts {
		if a.Key == "fix" {
			t.Error("las alternativas no deben incluir la categoría ya elegida")
		}
	}
}

func TestCreateRequestValidate(t *testing.T) {
	if err := (CreateRequest{Project: "p", Title: "t", Body: "b"}).Validate(); err != nil {
		t.Errorf("un request completo no debe fallar: %v", err)
	}
	for _, bad := range []CreateRequest{
		{Title: "t", Body: "b"},
		{Project: "p", Body: "b"},
		{Project: "p", Title: "t", Body: "   "},
	} {
		if err := bad.Validate(); err == nil {
			t.Errorf("esperaba error de validación para %+v", bad)
		}
	}
}

// TestInferCategorySpanishConjugations protege el caso más común en la vida
// real: alguien que escribe en español usa la primera persona del plural
// ("implementamos", "arreglamos"), no el infinitivo. Si esto se rompe, la
// inferencia deja de servir para su público principal.
func TestInferCategorySpanishConjugations(t *testing.T) {
	cases := []struct {
		name  string
		title string
		body  string
		want  string
	}{
		{
			name:  "feature en primera persona del plural",
			title: "Editor markdown con preview",
			body:  "Implementamos el editor con CodeMirror y agregamos sincronización de scroll.",
			want:  "feature",
		},
		{
			name:  "fix en primera persona",
			title: "El watcher perdía eventos",
			body:  "Arreglamos la carrera que hacía que se perdieran eventos al guardar rápido.",
			want:  "fix",
		},
		{
			name:  "chore al actualizar dependencias",
			title: "Mantenimiento de dependencias",
			body:  "Actualizamos sqlite y el linter, y limpiamos los scripts del Makefile.",
			want:  "chore",
		},
		{
			name:  "refactor al desacoplar",
			title: "Separación de la capa de datos",
			body:  "Extraemos las consultas a un paquete propio y simplificamos el servicio.",
			want:  "refactor",
		},
		{
			name:  "docs al documentar",
			title: "Guía de contribución",
			body:  "Documentamos el flujo de trabajo y explicamos cómo correr los tests.",
			want:  "docs",
		},
		{
			name:  "infra al desplegar",
			title: "Automatización del release",
			body:  "Automatizamos el despliegue con un pipeline de GitHub Actions.",
			want:  "infra",
		},
		{
			name:  "design al decidir",
			title: "Elección del esquema del índice",
			body:  "Decidimos duplicar el cuerpo en SQLite para poder buscar sin abrir archivos.",
			want:  "design",
		},
		{
			name:  "research al evaluar",
			title: "Comparación de editores",
			body:  "Evaluamos CodeMirror contra ProseMirror y medimos el rendimiento.",
			want:  "research",
		},
		{
			name:  "incident al caerse",
			title: "Caída del servicio de sincronización",
			body:  "El post mortem muestra que el rollback tardó veinte minutos.",
			want:  "incident",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := InferCategory(tc.title, tc.body)
			if got.Category != tc.want {
				t.Fatalf("categoría = %q, want %q\nrazón: %s\nevidencia: %v",
					got.Category, tc.want, got.Reason, got.Evidence)
			}
			if got.Confidence <= 0.15 {
				t.Errorf("con señales claras la confianza no debería ser la mínima: %v", got.Confidence)
			}
		})
	}
}

func TestContainsWordWithPrefixDoesNotMatchInsideWords(t *testing.T) {
	if !containsSignal(normalizeForSignals("implementamos algo"), "implement*") {
		t.Error("implement* debería encontrar implementamos")
	}
	if containsSignal(normalizeForSignals("recrear la escena"), "crea*") {
		t.Error("crea* no debería matchear dentro de recrear")
	}
	if !containsSignal(normalizeForSignals("creamos el paquete"), "crea*") {
		t.Error("crea* debería encontrar creamos")
	}
}

// TestAlternativesFallbackIsSensible: sin señales, las alternativas deben ser
// las categorías habituales, no "incident".
func TestAlternativesFallbackIsSensible(t *testing.T) {
	alts := Alternatives("Zzz", "Qqq", "feature", 3)
	want := []string{"fix", "chore", "refactor"}
	for i, a := range alts {
		if i < len(want) && a.Key != want[i] {
			t.Errorf("alternativa %d = %q, want %q (todas: %+v)", i, a.Key, want[i], alts)
		}
	}
}

// TestInferCategoryIgnoresChangeNarrative protege contra un falso positivo real:
// un resumen de una mejora que describe el comportamiento anterior ("antes
// devolvía X, ahora Y") se clasificaba como fix por la palabra "devolvía", que
// describe un cambio y no un defecto.
func TestInferCategoryIgnoresChangeNarrative(t *testing.T) {
	got := InferCategory(
		"Búsqueda de texto completo con ranking",
		"Agregamos búsqueda FTS5 con pesos por columna. Antes buscar «editor» devolvía "+
			"primero una nota que solo lo mencionaba en una etiqueta; ahora gana el título.",
	)
	if got.Category != "feature" {
		t.Fatalf("categoría = %q, want feature\nevidencia: %v\nrazón: %s",
			got.Category, got.Evidence, got.Reason)
	}
}

// TestInferCategoryDoesNotTreatWritingAsDocs: "escribía" describe una acción
// cualquiera en pasado, no documentación. Antes generaba empates falsos contra
// fix en relatos de bugs.
func TestInferCategoryDoesNotTreatWritingAsDocs(t *testing.T) {
	got := InferCategory(
		"El watcher perdía eventos al guardar rápido",
		"Arreglamos una carrera: el ticker leía el mapa mientras el manejador de "+
			"eventos lo escribía. Ahora todo ocurre en un solo goroutine.",
	)
	if got.Category != "fix" {
		t.Fatalf("categoría = %q, want fix (evidencia: %v, razón: %s)",
			got.Category, got.Evidence, got.Reason)
	}
	if strings.Contains(got.Reason, "empate") {
		t.Errorf("no debería haber empate: %s", got.Reason)
	}
}
