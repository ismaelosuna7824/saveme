package mcpconfig

import (
	"regexp"

	"golang.org/x/mod/semver"
)

// describeSuffix reconoce lo que `git describe` añade a una compilación local:
// «-<commits>-g<hash>» tras el último tag (`0.3.3-2-g51f41f1`).
var describeSuffix = regexp.MustCompile(`^-\d+-g[0-9a-f]+`)

// isLocalBuild dice si una versión sale de compilar en una máquina y no de una
// versión publicada: la de por defecto (`0.1.0-dev`), un árbol con cambios sin
// commitear (`0.3.2-dirty`), commits después del último tag
// (`0.3.3-2-g51f41f1`) o un hash suelto, sin tag (`51f41f1`).
//
// Las prerelease publicadas (`1.0.0-beta.1`) no lo son: también salen de un tag.
func isLocalBuild(version string) bool {
	v := "v" + version
	if !semver.IsValid(v) {
		return true
	}
	pre := semver.Prerelease(v)
	return pre == "-dev" || pre == "-dirty" || describeSuffix.MatchString(pre)
}

// shouldReplace decide si una copia instalada en `installed` se reemplaza por
// este binario, que es la versión `current`.
//
// Solo hacia delante y solo desde una versión publicada. Antes bastaba con que
// fueran distintas, y eso tenía dos salidas malas: arrancar el core desde el
// repositorio (`make dev`, `0.3.2-dirty`) dejaba a los agentes con una build de
// desarrollo, y abrir una app más vieja que la copia la bajaba de versión.
//
// `installed` vacío o que no es una versión —una copia que no responde, o una
// build local sin tag— se reemplaza: es justo lo que la arregla.
func shouldReplace(current, installed string) bool {
	if isLocalBuild(current) {
		return false
	}
	if !semver.IsValid("v" + installed) {
		return true
	}
	return semver.Compare("v"+current, "v"+installed) > 0
}
