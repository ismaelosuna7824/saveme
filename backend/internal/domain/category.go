package domain

import (
	"fmt"
	"sort"
	"strings"
)

// Category es una de las carpetas canónicas dentro de un proyecto.
type Category struct {
	Key         string `json:"key"`
	Folder      string `json:"folder"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// CategoryUncategorized es la categoría sintética que se asigna a los archivos
// .md que el usuario dejó en un directorio que no corresponde a ninguna
// categoría canónica. No se le ofrece nunca a un agente como destino.
const CategoryUncategorized = "uncategorized"

// categories es la taxonomía canónica, en el orden en que la UI la muestra.
var categories = []Category{
	{Key: "feature", Folder: "features", Label: "Feature",
		Description: "Funcionalidad nueva visible para quien usa el producto."},
	{Key: "fix", Folder: "fixes", Label: "Fix",
		Description: "Se corrigió un comportamiento incorrecto."},
	{Key: "chore", Folder: "chores", Label: "Chore",
		Description: "Dependencias, tooling, versiones, limpieza."},
	{Key: "refactor", Folder: "refactors", Label: "Refactor",
		Description: "Se reestructuró el código sin cambiar su comportamiento."},
	{Key: "docs", Folder: "docs", Label: "Docs",
		Description: "Documentación, guías y comentarios explicativos."},
	{Key: "infra", Folder: "infra", Label: "Infra",
		Description: "CI/CD, build, despliegue y observabilidad."},
	{Key: "design", Folder: "design", Label: "Design",
		Description: "Decisión de arquitectura o de diseño (ADR ligero)."},
	{Key: "research", Folder: "research", Label: "Research",
		Description: "Spike, exploración o comparación de opciones."},
	{Key: "incident", Folder: "incidents", Label: "Incident",
		Description: "Post-mortem de algo que se rompió."},
}

var uncategorized = Category{
	Key:         CategoryUncategorized,
	Folder:      "uncategorized",
	Label:       "Sin categoría",
	Description: "Archivos que no están en una carpeta de categoría conocida.",
}

var (
	byKey    = map[string]Category{}
	byFolder = map[string]Category{}
)

func init() {
	for _, c := range categories {
		byKey[c.Key] = c
		byFolder[c.Folder] = c
	}
	byKey[uncategorized.Key] = uncategorized
	byFolder[uncategorized.Folder] = uncategorized
}

// Categories devuelve la taxonomía canónica. El slice es una copia: el
// llamador no puede mutar el estado del paquete.
func Categories() []Category {
	out := make([]Category, len(categories))
	copy(out, categories)
	return out
}

// CategoryByKey resuelve por clave ("fix"). Acepta también el nombre de la
// carpeta ("fixes") y es tolerante a mayúsculas y acentos, porque los agentes
// escriben la categoría a mano.
func CategoryByKey(s string) (Category, bool) {
	norm := strings.TrimSpace(strings.ToLower(s))
	if c, ok := byKey[norm]; ok {
		return c, true
	}
	if c, ok := byFolder[norm]; ok {
		return c, true
	}
	// Última oportunidad: normalizar como slug ("Incidents" -> "incidents").
	if slug := Slug(norm); slug != "" {
		if c, ok := byKey[slug]; ok {
			return c, true
		}
		if c, ok := byFolder[slug]; ok {
			return c, true
		}
	}
	return Category{}, false
}

// CategoryByFolder resuelve por nombre de carpeta. Una carpeta desconocida cae
// en "uncategorized" en vez de fallar: el reconciliador debe poder indexar
// cualquier .md que el usuario haya dejado suelto.
func CategoryByFolder(folder string) Category {
	if c, ok := byFolder[strings.ToLower(strings.TrimSpace(folder))]; ok {
		return c
	}
	return uncategorized
}

// CategoryKeys devuelve solo las claves canónicas, útil para mensajes de error.
func CategoryKeys() []string {
	out := make([]string, 0, len(categories))
	for _, c := range categories {
		out = append(out, c.Key)
	}
	return out
}

// --- Inferencia de categoría -------------------------------------------------

// categorySignals asocia cada categoría con las señales léxicas que la delatan.
//
// Una señal sin espacios se compara como palabra completa ("add" no matchea
// "additional"); una señal con espacios se compara como frase ("root cause").
// Todas están normalizadas: minúsculas, sin acentos, sin puntuación.
var categorySignals = map[string][]string{
	"feature": {
		// Inglés
		"feat", "feature*", "add", "added", "adding", "implement*", "introduc*",
		"new", "endpoint*", "hook*", "wizard", "modal*",
		// Español: los stems cubren infinitivo, pasado y sustantivo
		// (implementar / implementamos / implementado / implementación).
		"nuev*", "agreg*", "anad*", "añad*", "crea*", "soport*", "permit*",
		"pantall*", "component*", "integra*", "habilit*", "incorp*", "anadi*",
		"muestra*", "visualiza*", "gestiona*", "configura*",
	},
	"fix": {
		"fix", "fixed", "fixes", "fixing", "bug*", "hotfix", "panic", "null pointer",
		"arregl*", "corrig*", "correg*", "correcc*", "solucion*", "repar*",
		"resolv*", "resuel*", "crash*", "crashe*", "error*", "fall*", "fallab*",
		"rot*", "romp*", "regres*", "exception*", "parche*",
		"no funcionaba", "dejaba de", "se corrige",
	},
	"chore": {
		"bump", "chore", "upgrad*", "tooling", "renovate", "lockfile", "gitignore",
		"makefile", "deps", "actualiz*", "dependenc*", "depend*", "lint*",
		"format*", "formate*", "limpi*", "limpiez*", "herramient*", "version*",
		"plantill*", "script*", "subi*", "subid*",
	},
	"refactor": {
		"refactor*", "rename*", "extract", "decoupl*", "split",
		"reestructur*", "renombr*", "extraj*", "extra*", "simplific*", "mov*",
		"reorganiz*", "desacopl*", "consolid*", "unific*", "abstra*", "divid*",
		"separ*", "movi*",
	},
	"docs": {
		"doc", "docs", "document*", "readme", "jsdoc", "godoc", "changelog",
		"guia", "guide", "coment*", "tutorial*", "explic*", "redact*", "anot*",
	},
	"infra": {
		"ci", "cd", "docker*", "build*", "terraform*", "kubernetes*", "logging",
		"deploy*", "pipeline*", "workflow*", "infra*", "observ*", "monitore*",
		"monitor*", "telemetr*", "release*", "empaquet*", "sidecar*", "bundle*",
		"desplieg*", "despleg*", "publica*", "automatiza*",
	},
	"design": {
		"adr", "design*", "architect*", "tradeoff*", "approach*",
		"decis*", "diseñ*", "disen*", "arquitect*", "enfoqu*", "contrat*",
		"esquem*", "elecci*", "elegi*", "acord*",
	},
	"research": {
		"spike", "poc", "research*", "benchmark*", "investig*", "explor*",
		"evalu*", "compar*", "prototip*", "viabilid*", "experiment*", "analiz*",
		"analis*", "medicion*", "sondeo*",
	},
	"incident": {
		"outage", "downtime", "sev1", "sev2", "rollback", "revert*", "revers*",
		"root cause", "post mortem", "incident*", "caid*", "postmortem*",
		"reversion*", "indisponibilidad*", "produccion rota", "se cayo", "tumbo*",
	},
}

// categoryOrder fija el desempate: si dos categorías empatan en puntaje, gana
// la que aparece antes. El orden prioriza lo específico sobre lo genérico, para
// que un empate entre "fix" y "feature" lo gane "fix" (es más informativo).
var categoryOrder = []string{
	"incident", "fix", "feature", "refactor", "infra", "docs", "chore", "design", "research",
}

// commonalityOrder ordena por frecuencia esperada en un proyecto real. Se usa
// solo para rellenar las alternativas cuando no hay señales: ofrecer "incident"
// como primera opción para un cambio cualquiera sería ruido.
var commonalityOrder = []string{
	"feature", "fix", "chore", "refactor", "docs", "infra", "design", "research", "incident",
}

// Inference explica por qué se propuso una categoría. Siempre viaja hasta el
// usuario: la inferencia nunca decide en silencio.
type Inference struct {
	Category   string   `json:"category"`
	Reason     string   `json:"reason"`
	Confidence float64  `json:"confidence"`
	Evidence   []string `json:"evidence"`
}

// InferCategory propone una categoría a partir del título y el cuerpo.
//
// El algoritmo es deliberadamente simple y auditable: cuenta señales léxicas
// ponderadas (título x3, cuerpo x1) y elige la de mayor puntaje. Nunca devuelve
// una categoría sin explicar por qué, porque el resultado se le muestra al
// usuario como sugerencia editable, no como una decisión tomada.
func InferCategory(title, body string) Inference {
	scores, hits := scoreCategories(title, body)

	if len(scores) == 0 {
		return Inference{
			Category: "feature",
			Reason: "No encontré señales claras en el título ni en el cuerpo, y feature " +
				"es el caso más común. Confírmalo o elige otra carpeta.",
			Confidence: 0.15,
			Evidence:   []string{},
		}
	}

	ordered := rankCategories(scores)
	winner := ordered[0]

	total := 0
	for _, v := range scores {
		total += v
	}
	dominance := float64(scores[winner]) / float64(total)
	evidence := float64(len(hits[winner]))
	if evidence > 3 {
		evidence = 3
	}
	confidence := round2(0.15 + dominance*(0.6+0.4*evidence/3)*0.85)

	reason := fmt.Sprintf("El título y el cuerpo mencionan %s, que es señal de %s.",
		quoteList(hits[winner]), categoryLabel(winner))
	if len(ordered) > 1 && scores[ordered[1]] == scores[winner] {
		// Con la misma evidencia la decisión es un desempate por prioridad, no
		// una conclusión: hay que decirlo así y pedir confirmación.
		reason = fmt.Sprintf(
			"%s y %s tienen la misma evidencia (%s), así que propongo %s por ser la más específica. Confírmalo o elige otra carpeta.",
			categoryLabel(winner), categoryLabel(ordered[1]),
			quoteList(hits[winner]), categoryLabel(winner))
	}

	return Inference{
		Category:   winner,
		Reason:     reason,
		Confidence: confidence,
		Evidence:   hits[winner],
	}
}

// Alternatives devuelve hasta n categorías alternativas ordenadas por puntaje,
// para ofrecérselas al usuario como "o guárdalo aquí". Siempre devuelve n
// opciones concretas, aunque no haya señales, para que el usuario nunca tenga
// que inventar un nombre de carpeta.
func Alternatives(title, body, exclude string, n int) []Category {
	scores, _ := scoreCategories(title, body)
	delete(scores, exclude)

	out := make([]Category, 0, n)
	for _, key := range rankCategories(scores) {
		if len(out) == n {
			return out
		}
		if c, ok := byKey[key]; ok {
			out = append(out, c)
		}
	}
	// Relleno determinista con las categorías más usadas.
	for _, key := range commonalityOrder {
		if len(out) == n {
			break
		}
		if key == exclude || containsCategory(out, key) {
			continue
		}
		if c, ok := byKey[key]; ok {
			out = append(out, c)
		}
	}
	return out
}

// scoreCategories cuenta señales ponderadas y devuelve, por categoría, el
// puntaje y las señales concretas que dispararon.
func scoreCategories(title, body string) (map[string]int, map[string][]string) {
	titleNorm := normalizeForSignals(title)
	bodyNorm := normalizeForSignals(body)

	scores := make(map[string]int, len(categories))
	hits := make(map[string][]string, len(categories))

	for key, signals := range categorySignals {
		for _, sig := range signals {
			score := 0
			// El título pesa triple: es la señal más intencional del autor.
			if containsSignal(titleNorm, sig) {
				score += 3
			}
			if containsSignal(bodyNorm, sig) {
				score++
			}
			if score > 0 {
				scores[key] += score
				hits[key] = append(hits[key], sig)
			}
		}
	}
	return scores, hits
}

// rankCategories ordena por puntaje descendente y desempata por categoryOrder.
func rankCategories(scores map[string]int) []string {
	ordered := make([]string, 0, len(scores))
	for key := range scores {
		ordered = append(ordered, key)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		if scores[ordered[i]] != scores[ordered[j]] {
			return scores[ordered[i]] > scores[ordered[j]]
		}
		return orderIndex(ordered[i]) < orderIndex(ordered[j])
	})
	return ordered
}

// containsSignal comprueba una señal contra un texto ya normalizado.
//
// Tres formas de comparar, según cómo esté escrita la señal:
//
//   - Terminada en "*": prefijo de palabra. "implement*" encuentra implementar,
//     implementamos, implementado e implementación. Es lo que permite cubrir las
//     conjugaciones del español sin enumerarlas una por una.
//   - Con espacios: la frase se busca como subcadena ("root cause").
//   - Palabra suelta: coincidencia de palabra completa, para que "add" no
//     matchee "additional".
func containsSignal(normalizedText, signal string) bool {
	if signal == "" {
		return false
	}
	if strings.HasSuffix(signal, "*") {
		return containsWordWithPrefix(normalizedText, strings.TrimSuffix(signal, "*"))
	}
	if strings.Contains(signal, " ") {
		return strings.Contains(normalizedText, signal)
	}
	return strings.Contains(" "+normalizedText+" ", " "+signal+" ")
}

// containsWordWithPrefix busca alguna palabra del texto que empiece por stem.
// Exigir el inicio de palabra evita que "crea*" matchee "recrear".
func containsWordWithPrefix(normalizedText, stem string) bool {
	if stem == "" {
		return false
	}
	for start := 0; start < len(normalizedText); {
		i := strings.Index(normalizedText[start:], stem)
		if i < 0 {
			return false
		}
		pos := start + i
		if pos == 0 || normalizedText[pos-1] == ' ' {
			return true
		}
		start = pos + 1
	}
	return false
}

// normalizeForSignals pasa un texto a minúsculas, sin acentos y sin puntuación,
// conservando los límites de palabra. "Implementación del Editor!" ->
// "implementacion del editor".
func normalizeForSignals(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	wrote := false   // ya se escribió al menos un carácter útil
	needSep := false // hay un separador pendiente antes del próximo carácter
	for _, r := range strings.ToLower(s) {
		var repl string
		if d, ok := diacritics[r]; ok {
			repl = d
		} else if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			repl = string(r)
		} else {
			if wrote {
				needSep = true
			}
			continue
		}
		if needSep {
			b.WriteByte(' ')
			needSep = false
		}
		b.WriteString(repl)
		wrote = true
	}
	return b.String()
}

func orderIndex(key string) int {
	for i, k := range categoryOrder {
		if k == key {
			return i
		}
	}
	return len(categoryOrder)
}

func categoryLabel(key string) string {
	if c, ok := byKey[key]; ok {
		return c.Label
	}
	return key
}

func containsCategory(list []Category, key string) bool {
	for _, c := range list {
		if c.Key == key {
			return true
		}
	}
	return false
}

// quoteList formatea la evidencia para el usuario.
//
// Los stems se guardan con un "*" final (ver containsSignal), que es sintaxis
// interna: mostrarlo tal cual filtraría un detalle de implementación a la
// explicación que lee la persona. Aquí se convierte en puntos suspensivos, que
// es lo que de verdad significa ("agreg…" = palabras que empiezan por agreg).
func quoteList(items []string) string {
	const max = 3
	shown := items
	suffix := ""
	if len(items) > max {
		shown = items[:max]
		suffix = fmt.Sprintf(" y %d más", len(items)-max)
	}
	quoted := make([]string, 0, len(shown))
	for _, s := range shown {
		if stem, ok := strings.CutSuffix(s, "*"); ok {
			s = stem + "…"
		}
		quoted = append(quoted, fmt.Sprintf("%q", s))
	}
	return strings.Join(quoted, ", ") + suffix
}

func round2(f float64) float64 {
	return float64(int(f*100+0.5)) / 100
}
