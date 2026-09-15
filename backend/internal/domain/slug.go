package domain

import "strings"

// diacritics mapea vocales y consonantes acentuadas del español y del portugués
// a su equivalente ASCII. Se hace a mano para no arrastrar golang.org/x/text
// solo por esto.
var diacritics = map[rune]string{
	'á': "a", 'à': "a", 'ä': "a", 'â': "a", 'ã': "a", 'å': "a",
	'é': "e", 'è': "e", 'ë': "e", 'ê': "e",
	'í': "i", 'ì': "i", 'ï': "i", 'î': "i",
	'ó': "o", 'ò': "o", 'ö': "o", 'ô': "o", 'õ': "o",
	'ú': "u", 'ù': "u", 'ü': "u", 'û': "u",
	'ñ': "n", 'ç': "c", 'ý': "y",
	'Á': "a", 'À': "a", 'Ä': "a", 'Â': "a", 'Ã': "a", 'Å': "a",
	'É': "e", 'È': "e", 'Ë': "e", 'Ê': "e",
	'Í': "i", 'Ì': "i", 'Ï': "i", 'Î': "i",
	'Ó': "o", 'Ò': "o", 'Ö': "o", 'Ô': "o", 'Õ': "o",
	'Ú': "u", 'Ù': "u", 'Ü': "u", 'Û': "u",
	'Ñ': "n", 'Ç': "c", 'Ý': "y",
}

// Slug normaliza un texto libre a un identificador seguro para usar como
// nombre de directorio o de archivo.
//
// Reglas: minúsculas, sin acentos, todo lo que no sea [a-z0-9] se convierte en
// guion, los guiones repetidos colapsan y se recortan de los extremos.
// "Implementación del Editor Márkdown!" -> "implementacion-del-editor-markdown"
func Slug(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.ToLower(strings.TrimSpace(s)) {
		if repl, ok := diacritics[r]; ok {
			b.WriteString(repl)
			continue
		}
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		default:
			b.WriteByte('-')
		}
	}
	return collapseDashes(b.String())
}

// SlugLimit es el largo máximo de un slug. Los nombres de archivo de proyecto
// llevan fecha y extensión además del slug del título, así que conviene dejar
// margen bajo el límite de 255 bytes de la mayoría de los filesystems.
const SlugLimit = 72

// SlugTruncated aplica Slug y recorta a SlugLimit sin dejar un guion colgando.
func SlugTruncated(s string) string {
	slug := Slug(s)
	if len(slug) <= SlugLimit {
		return slug
	}
	return strings.Trim(slug[:SlugLimit], "-")
}

func collapseDashes(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevDash := false
	for _, r := range s {
		if r == '-' {
			if prevDash {
				continue
			}
			prevDash = true
		} else {
			prevDash = false
		}
		b.WriteRune(r)
	}
	return strings.Trim(b.String(), "-")
}

// WordCount cuenta palabras de forma aproximada: secuencias separadas por
// espacios en blanco. No pretende ser exacto, solo alimentar la UI.
func WordCount(s string) int {
	return len(strings.Fields(s))
}
