package config

import "regexp"

// ProjectIcon es el icono de píxeles que el usuario eligió para un proyecto.
//
// Los dos campos son nombres (`squid`, `green`), no índices: así reordenar o
// añadir dibujos en la interfaz no le cambia el icono a nadie. Vacío significa
// «automático»: la interfaz lo deduce del slug, igual que sin entrada.
//
// El core no conoce la lista de dibujos ni de colores —viven en la interfaz,
// que es quien los pinta— y solo comprueba la forma del nombre. Un nombre que la
// interfaz no conozca (de una versión más nueva, por ejemplo) se pinta como
// automático, no rompe nada.
type ProjectIcon struct {
	Sprite string `json:"sprite,omitempty"`
	Color  string `json:"color,omitempty"`
}

var projectIconName = regexp.MustCompile(`^[a-z][a-z0-9-]{0,23}$`)

// ValidProjectIcon dice si los nombres tienen forma de clave.
func ValidProjectIcon(icon ProjectIcon) bool {
	return (icon.Sprite == "" || projectIconName.MatchString(icon.Sprite)) &&
		(icon.Color == "" || projectIconName.MatchString(icon.Color))
}
