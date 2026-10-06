package config

import (
	"math"
	"path/filepath"
	"regexp"
)

// Background es la imagen que se pinta detrás del contenido de la app, con su
// aspecto: efecto, en qué pantallas se ve, cuánto se ve y cuánto se difumina.
//
// La imagen no se guarda aquí: se guarda una copia en `BackgroundsDir` con un
// nombre derivado de su contenido (`<16 hex del sha256>.<ext>`) y aquí solo va
// ese nombre. Así el archivo de configuración sigue siendo pequeño y legible, y
// la imagen no depende de que el original siga donde estaba.
type Background struct {
	Image string `json:"image"`
	// Effect es cómo se redibuja la imagen: none, dither, ascii, halftone,
	// scanlines o haze.
	Effect string `json:"effect"`
	// ShowOn decide en qué pantallas se ve: "empty" (solo las que no tienen un
	// documento abierto) o "all" (todas, con la visibilidad de documento cuando
	// hay uno abierto).
	ShowOn string `json:"show_on"`
	// EmptyVisibility y DocumentVisibility son fracciones de 0 a 1: cuánto se ve
	// la imagen a través del fondo del tema sin documento y con documento.
	EmptyVisibility    float64 `json:"empty_visibility"`
	DocumentVisibility float64 `json:"document_visibility"`
	// Blur es el difuminado en píxeles, de 0 a MaxBackgroundBlur.
	Blur int `json:"blur"`
}

// Valores del aspecto de la imagen de fondo.
const (
	// MaxBackgroundBlur es el difuminado máximo. Más allá la imagen ya es una
	// mancha de color y solo cuesta tiempo de pintado.
	MaxBackgroundBlur = 24

	DefaultBackgroundEffect = "none"
	DefaultBackgroundShowOn = "all"
	// La visibilidad por defecto es alta sin documento y baja con uno abierto: con
	// texto delante, una imagen muy presente lo vuelve ilegible.
	DefaultEmptyVisibility    = 0.6
	DefaultDocumentVisibility = 0.3
)

// BackgroundEffects son los efectos que la interfaz sabe pintar.
var BackgroundEffects = []string{"none", "dither", "ascii", "halftone", "scanlines", "haze"}

// backgroundImageName es la forma de los nombres que escribe el core al importar
// una imagen. Se exige al guardar la configuración para que un valor cualquiera
// no acabe sirviéndose como ruta.
var backgroundImageName = regexp.MustCompile(`^[0-9a-f]{16}\.(png|jpg|gif|webp|avif)$`)

// ValidBackgroundImage dice si un nombre tiene la forma de una imagen importada.
func ValidBackgroundImage(name string) bool {
	return backgroundImageName.MatchString(name)
}

// NormalizeBackground deja un fondo con valores válidos: un efecto desconocido
// pasa a "none", lo que no sea "empty" pasa a "all" y los números se acotan.
//
// Se acota en vez de rechazar por lo mismo que la opacidad: que un deslizador
// mande 1.0000001 por un redondeo no es un error del usuario. Lo único que no se
// arregla es el nombre de la imagen, porque no hay valor razonable que inventar.
func NormalizeBackground(b Background) (Background, bool) {
	if !ValidBackgroundImage(b.Image) {
		return Background{}, false
	}
	known := false
	for _, effect := range BackgroundEffects {
		known = known || effect == b.Effect
	}
	if !known {
		b.Effect = DefaultBackgroundEffect
	}
	if b.ShowOn != "empty" {
		b.ShowOn = DefaultBackgroundShowOn
	}
	b.EmptyVisibility = clampFraction(b.EmptyVisibility)
	b.DocumentVisibility = clampFraction(b.DocumentVisibility)
	if b.Blur < 0 {
		b.Blur = 0
	}
	if b.Blur > MaxBackgroundBlur {
		b.Blur = MaxBackgroundBlur
	}
	return b, true
}

func clampFraction(v float64) float64 {
	if math.IsNaN(v) || v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// BackgroundsDir es la carpeta de las imágenes de fondo importadas.
//
// Vive junto al archivo de configuración y **no** dentro del workspace: es una
// preferencia de la app, no parte del diario, y no tiene que viajar con él a git
// ni aparecer como un archivo más.
func (c Config) BackgroundsDir() string {
	return filepath.Join(filepath.Dir(c.Path), "backgrounds")
}
