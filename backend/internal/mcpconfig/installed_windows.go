//go:build windows

package mcpconfig

import (
	"os"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// uninstallKeys son las listas de «Aplicaciones instaladas» de Windows: la del
// usuario y las dos de la máquina (64 y 32 bits). Cada instalador se apunta en
// una, esté donde esté el ejecutable —C:, D: o una carpeta elegida a mano—.
var uninstallKeys = []struct {
	root registry.Key
	path string
}{
	{registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Uninstall`},
	{registry.LOCAL_MACHINE, `Software\Microsoft\Windows\CurrentVersion\Uninstall`},
	{registry.LOCAL_MACHINE, `Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`},
}

// installedAppNames devuelve los nombres visibles de lo instalado: los de las
// listas de desinstalación y los de los paquetes MSIX del usuario, que no se
// apuntan ahí. De un paquete se usa su nombre (`Claude` en `Claude_pzs8sxrjxfjjc`).
func installedAppNames() []string {
	var names []string
	for _, u := range uninstallKeys {
		key, err := registry.OpenKey(u.root, u.path, registry.ENUMERATE_SUB_KEYS)
		if err != nil {
			continue
		}
		subkeys, _ := key.ReadSubKeyNames(-1)
		key.Close()
		for _, sub := range subkeys {
			k, err := registry.OpenKey(u.root, u.path+`\`+sub, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			if name, _, err := k.GetStringValue("DisplayName"); err == nil && name != "" {
				names = append(names, name)
			}
			k.Close()
		}
	}
	if roots, ok := windowsRoots(); ok {
		if entries, err := os.ReadDir(roots.packages); err == nil {
			for _, e := range entries {
				if name, _, found := strings.Cut(e.Name(), "_"); found && e.IsDir() {
					names = append(names, name)
				}
			}
		}
	}
	return names
}
