package domain

import (
	"regexp"
	"strings"
)

// Detección de secretos en lo que escribe el agente.
//
// El agente que redacta un resumen acaba de ver el `.env`, los logs y las
// cabeceras HTTP del proyecto, y lo que escribe después sale de la app: se
// comparte en X o LinkedIn, se exporta, se pega en Slack. Esto busca las formas
// conocidas de credencial para **avisar** antes de guardar o compartir. No
// bloquea ni reescribe nada: la decisión sigue siendo de la persona, que ahora
// la toma sabiéndolo.
//
// Prefiere callar a gritar: un aviso que salta en cada resumen que dice «token»
// se aprende a ignorar, y entonces no sirve ni cuando acierta. Por eso los
// patrones son de formatos concretos, y la regla genérica (`clave = valor`) pide
// un valor con pinta de secreto y descarta los marcadores de posición.

// SecretFinding es un posible secreto encontrado en un texto.
type SecretFinding struct {
	// Kind es el tipo, una clave estable que la interfaz traduce
	// (`aws_access_key`, `private_key`…).
	Kind string `json:"kind"`
	// Field es dónde está: `title`, `summary` o `body`.
	Field string `json:"field"`
	// Line es la línea dentro del campo, empezando en 1.
	Line int `json:"line"`
	// Hint es el principio del valor, enmascarado: lo justo para reconocerlo.
	// Nunca el secreto entero, porque este aviso viaja al agente, al inbox y al log.
	Hint string `json:"hint"`
}

type secretPattern struct {
	kind string
	re   *regexp.Regexp
	// group es el subgrupo que contiene el valor; 0 es la coincidencia entera.
	group int
	// accept filtra coincidencias que tienen la forma pero no son un secreto.
	accept func(value string) bool
}

var secretPatterns = []secretPattern{
	{kind: "private_key", re: regexp.MustCompile(`-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----`)},
	{kind: "aws_access_key", re: regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`)},
	{kind: "github_token", re: regexp.MustCompile(`\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b`)},
	{kind: "slack_token", re: regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}\b`)},
	{kind: "stripe_key", re: regexp.MustCompile(`\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b`)},
	{kind: "google_api_key", re: regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{35}\b`)},
	{kind: "anthropic_key", re: regexp.MustCompile(`\bsk-ant-[A-Za-z0-9_-]{20,}`)},
	// Va después de la de Anthropic: `sk-ant-…` también tiene esta forma, y se
	// quiere el nombre más concreto.
	{kind: "openai_key", re: regexp.MustCompile(`\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}`), accept: func(v string) bool {
		return !strings.HasPrefix(v, "sk-ant-")
	}},
	{kind: "jwt", re: regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`)},
	{
		kind:   "url_credentials",
		re:     regexp.MustCompile(`\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s:/@"'` + "`" + `]+:([^\s@/"'` + "`" + `]+)@`),
		group:  1,
		accept: func(v string) bool { return !isPlaceholder(v) },
	},
	{
		kind:  "assignment",
		re:    regexp.MustCompile(`(?i)\b(password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|access[_-]?token|token)\b["']?\s*[:=]\s*["']?([^\s"'` + "`" + `,;]+)`),
		group: 2,
	},
}

// ScanSecrets busca posibles secretos en los campos de un resumen.
//
// Los campos se pasan por nombre para que el aviso pueda decir dónde está cada
// uno; se recorren en el orden en que se pasan.
func ScanSecrets(fields ...[2]string) []SecretFinding {
	var out []SecretFinding
	for _, f := range fields {
		name, text := f[0], f[1]
		for i, line := range strings.Split(text, "\n") {
			out = append(out, scanLine(name, i+1, line)...)
		}
	}
	return out
}

func scanLine(field string, lineNo int, line string) []SecretFinding {
	var out []SecretFinding
	// Un mismo trozo de texto no se cuenta dos veces: `token=ghp_…` es un token de
	// GitHub, no además una asignación.
	var taken [][2]int
	overlaps := func(start, end int) bool {
		for _, r := range taken {
			if start < r[1] && r[0] < end {
				return true
			}
		}
		return false
	}

	for _, p := range secretPatterns {
		for _, m := range p.re.FindAllStringSubmatchIndex(line, -1) {
			start, end := m[2*p.group], m[2*p.group+1]
			if start < 0 || overlaps(m[0], m[1]) {
				continue
			}
			value := line[start:end]
			if p.kind == "assignment" && !looksSecret(line[m[2]:m[3]], value) {
				continue
			}
			if p.accept != nil && !p.accept(value) {
				continue
			}
			taken = append(taken, [2]int{m[0], m[1]})
			out = append(out, SecretFinding{Kind: p.kind, Field: field, Line: lineNo, Hint: maskSecret(value)})
		}
	}
	return out
}

// looksSecret decide si el valor de `clave = valor` parece un secreto de verdad.
//
// Las contraseñas se aceptan cortas y de cualquier forma, porque así son. Para
// el resto (`token`, `api_key`…) hace falta longitud y mezcla de letras y
// números: «token: el de propose» o «api_key = string» son prosa técnica, no
// credenciales.
func looksSecret(key, value string) bool {
	if isPlaceholder(value) {
		return false
	}
	switch strings.ToLower(key) {
	case "password", "passwd", "pwd":
		return len(value) >= 6
	}
	if len(value) < 12 {
		return false
	}
	var letters, digits bool
	for _, r := range value {
		switch {
		case r >= '0' && r <= '9':
			digits = true
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'):
			letters = true
		}
	}
	return letters && digits
}

// isPlaceholder reconoce los valores de ejemplo que la documentación usa en
// lugar del secreto: variables, plantillas, asteriscos y palabras de relleno.
func isPlaceholder(value string) bool {
	v := strings.ToLower(strings.Trim(value, `"'`+"`"))
	if v == "" {
		return true
	}
	for _, marker := range []string{"<", ">", "${", "{{", "$", "(", "process.env", "getenv", "xxx", "***", "...", "…", "changeme", "example", "your_", "your-", "redacted", "placeholder", "dummy"} {
		if strings.Contains(v, marker) {
			return true
		}
	}
	switch v {
	case "password", "pass", "secret", "token", "null", "none", "true", "false", "string":
		return true
	}
	return false
}

// maskSecret deja ver el principio del valor, nunca el resto.
func maskSecret(value string) string {
	runes := []rune(value)
	keep := 4
	if len(runes) <= 8 {
		keep = 1
	}
	return string(runes[:keep]) + "…"
}
