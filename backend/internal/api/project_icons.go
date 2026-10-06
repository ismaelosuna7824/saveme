package api

import "github.com/ismaelosuna/saveme/backend/internal/config"

// projectIcons devuelve el mapa listo para JSON: vacío en vez de nil, para que la
// interfaz reciba siempre un objeto.
func projectIcons(m map[string]config.ProjectIcon) map[string]config.ProjectIcon {
	if m == nil {
		return map[string]config.ProjectIcon{}
	}
	return m
}
