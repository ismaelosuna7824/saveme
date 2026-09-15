// Package markdown parsea y serializa los documentos que guarda SaveMe.
//
// El contrato es que SaveMe no es dueño del cuerpo: se conserva byte por byte.
// Solo se gestiona el bloque de frontmatter, y solo cuando el archivo es
// nuestro. Un markdown ajeno se indexa pero nunca se reescribe.
package markdown

import (
	"bytes"
	"fmt"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/ismaelosuna/saveme/backend/internal/domain"
)

// delimiter es la línea que abre y cierra el frontmatter.
const delimiter = "---"

// Document es un markdown ya descompuesto.
type Document struct {
	// Frontmatter es nil si el archivo no traía un bloque válido.
	Frontmatter *domain.Frontmatter
	// Body es el contenido después del frontmatter, sin reformatear.
	Body string
	// HasFrontmatter indica si se encontró el bloque delimitado por "---".
	HasFrontmatter bool
	// ParseError describe por qué el frontmatter no se pudo interpretar.
	// Un archivo con frontmatter ilegible sigue siendo legible como documento.
	ParseError error
}

// Parse descompone un markdown en frontmatter y cuerpo.
//
// Nunca falla: si el frontmatter es inválido se devuelve HasFrontmatter=true
// con Frontmatter=nil y el error en ParseError, y el cuerpo se toma completo
// desde después del bloque. Así un archivo corrupto es visible en vez de
// desaparecer del índice.
func Parse(data []byte) Document {
	text := string(data)
	// Normalizar CRLF solo para el escaneo de líneas; el cuerpo conserva sus
	// bytes originales.
	if !strings.HasPrefix(strings.TrimLeft(text, "\ufeff"), delimiter) {
		return Document{Body: text}
	}
	text = strings.TrimPrefix(text, "\ufeff")

	lines := strings.Split(text, "\n")
	if len(lines) == 0 || strings.TrimRight(lines[0], "\r") != delimiter {
		return Document{Body: text}
	}

	// Buscar la línea de cierre.
	closeIdx := -1
	for i := 1; i < len(lines); i++ {
		if strings.TrimRight(lines[i], "\r") == delimiter {
			closeIdx = i
			break
		}
	}
	if closeIdx == -1 {
		// Frontmatter sin cerrar: se trata como documento sin frontmatter para
		// no comerse el contenido del usuario.
		return Document{Body: text}
	}

	rawYAML := strings.Join(lines[1:closeIdx], "\n")
	body := strings.Join(lines[closeIdx+1:], "\n")
	body = strings.TrimPrefix(body, "\n")

	var fm domain.Frontmatter
	if err := yaml.Unmarshal([]byte(rawYAML), &fm); err != nil {
		return Document{
			Body:           body,
			HasFrontmatter: true,
			ParseError:     fmt.Errorf("frontmatter YAML inválido: %w", err),
		}
	}
	return Document{Frontmatter: &fm, Body: body, HasFrontmatter: true}
}

// Render serializa un documento con su frontmatter.
//
// El cuerpo se escribe tal cual, sin normalizar espacios ni saltos: la promesa
// de "md first" es que lo que ves en el editor es exactamente lo que hay en
// disco.
func Render(fm domain.Frontmatter, body string) ([]byte, error) {
	if fm.Status == "" {
		fm.Status = domain.StatusConfirmed
	}
	if fm.Author == "" {
		fm.Author = "agent"
	}
	if fm.CreatedAt.IsZero() {
		fm.CreatedAt = time.Now().UTC()
	}
	fm.UpdatedAt = time.Now().UTC()

	var buf bytes.Buffer
	buf.WriteString(delimiter)
	buf.WriteByte('\n')

	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(fm); err != nil {
		return nil, fmt.Errorf("serializar frontmatter: %w", err)
	}
	if err := enc.Close(); err != nil {
		return nil, fmt.Errorf("cerrar el encoder YAML: %w", err)
	}

	buf.WriteString(delimiter)
	buf.WriteByte('\n')
	buf.WriteByte('\n')
	buf.WriteString(strings.TrimLeft(body, "\n"))
	if !strings.HasSuffix(buf.String(), "\n") {
		buf.WriteByte('\n')
	}
	return buf.Bytes(), nil
}

// DeriveTitle obtiene un título presentable cuando el archivo no tiene
// frontmatter: usa el primer encabezado de nivel 1 y, si no hay, el nombre del
// archivo sin fecha ni extensión.
func DeriveTitle(body, filename string) string {
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "# ") {
			if t := strings.TrimSpace(strings.TrimPrefix(trimmed, "# ")); t != "" {
				return t
			}
		}
	}
	// Quitar la extensión y el prefijo de fecha si lo hay.
	name := strings.TrimSuffix(filename, ".md")
	if len(name) > 11 && name[4] == '-' && name[7] == '-' && name[10] == '-' {
		name = name[11:]
	}
	name = strings.ReplaceAll(name, "-", " ")
	name = strings.TrimSpace(name)
	if name == "" {
		return "Sin título"
	}
	return strings.ToUpper(name[:1]) + name[1:]
}

// DeriveSummaryLine extrae la primera línea de prosa del cuerpo, saltando
// encabezados y líneas vacías. Es lo que se muestra en las listas.
func DeriveSummaryLine(body string) string {
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") ||
			strings.HasPrefix(trimmed, "---") || strings.HasPrefix(trimmed, "```") {
			continue
		}
		trimmed = strings.TrimLeft(trimmed, ">-* \t")
		if len(trimmed) > 200 {
			trimmed = strings.TrimSpace(trimmed[:200]) + "…"
		}
		return trimmed
	}
	return ""
}
