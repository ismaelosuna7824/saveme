package mcpconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
)

// Acciones propias de quitar la configuración.
const (
	// ActionRemoved: estaba configurado y se quitó.
	ActionRemoved Action = "removed"
	// ActionAbsent: no había nada que quitar.
	ActionAbsent Action = "not-configured"
)

// Remove borra la entrada de SaveMe del archivo de configuración del cliente.
//
// Es la operación simétrica de `Apply`, y sigue las mismas reglas: copia de
// seguridad antes de tocar nada, nada de reescribir JSONC (un parseo y volcado se
// comería los comentarios), y en TOML se quita la sección en vez de reserializar
// el archivo entero.
//
// Solo se borra **lo que escribió SaveMe**: su entrada en el mapa de servidores, o
// su sección del TOML con el comentario que la acompaña. El resto del archivo
// queda byte a byte igual.
func Remove(p Provider, opts Options) (WriteResult, error) {
	opts = WithDefaults(opts)

	// Un cliente que se configura por comando no tiene entrada que borrar: el
	// usuario lo dio de alta en su propia herramienta, así que se le dice con qué
	// comando darlo de baja en vez de tocar archivos que no son nuestros. El
	// `add` que genera `buildCLI` tiene su simétrico `remove`.
	if p.Format == FormatCLI {
		command := "claude mcp remove --scope user " + opts.Name
		return WriteResult{
			Action:  ActionManual,
			Command: command,
			Message: "Este cliente se configura con un comando, así que no hay archivo " +
				"que tocar. Quítalo con: " + command,
		}, nil
	}

	path := opts.Path
	if path == "" && p.Path != nil {
		path = p.Path()
	}
	if path == "" {
		return WriteResult{}, errors.New(
			"no pude determinar la ruta de configuración; pásala con --path")
	}

	existing, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return WriteResult{
			Path:    path,
			Action:  ActionAbsent,
			Message: "No hay nada que quitar: el archivo de configuración no existe.",
		}, nil
	}
	if err != nil {
		return WriteResult{}, fmt.Errorf("leer %s: %w", path, err)
	}

	switch p.Format {
	case FormatJSON:
		return removeJSON(p, opts, path, existing)
	case FormatTOML:
		return removeTOML(p, opts, path, existing)
	default:
		// Formato manual: nunca se escribió, así que no hay nada nuestro que
		// borrar. Se dice, en vez de dar a entender que se hizo algo.
		return WriteResult{
			Path:   path,
			Action: ActionAbsent,
			Message: "A este cliente nunca le escribí la configuración, así que no hay " +
				"nada que quitar: si lo pegaste a mano, bórralo a mano.",
		}, nil
	}
}

func removeJSON(p Provider, opts Options, path string, existing []byte) (WriteResult, error) {
	if hasJSONComments(existing) {
		return WriteResult{
			Path:   path,
			Action: ActionManual,
			Message: "Tu archivo tiene comentarios (JSONC) y reescribirlo te los borraría, " +
				"así que no lo toco. Quita a mano la entrada \"" + opts.Name +
				"\" de \"" + p.ServersKey + "\".",
		}, nil
	}

	root := map[string]any{}
	if len(strings.TrimSpace(string(existing))) > 0 {
		if err := json.Unmarshal(existing, &root); err != nil {
			return WriteResult{}, fmt.Errorf(
				"%s no es JSON válido (%w); arréglalo o pásame otro archivo con --path", path, err)
		}
	}

	servers, _ := root[p.ServersKey].(map[string]any)
	if _, present := servers[opts.Name]; !present {
		return WriteResult{
			Path:    path,
			Action:  ActionAbsent,
			Message: "«" + opts.Name + "» no estaba configurado; no toqué el archivo.",
		}, nil
	}

	delete(servers, opts.Name)
	// Si el mapa se queda vacío se quita la clave: dejarla con un `{}` dentro es
	// basura que escribimos nosotros.
	if len(servers) == 0 {
		delete(root, p.ServersKey)
	} else {
		root[p.ServersKey] = servers
	}

	// Si el archivo se queda sin nada, es que solo tenía nuestra configuración:
	// se borra en vez de dejar un `{}` huérfano.
	if len(root) == 0 {
		backup, err := removeFileWithBackup(path, existing)
		if err != nil {
			return WriteResult{}, err
		}
		return WriteResult{
			Path:    path,
			Action:  ActionRemoved,
			Backup:  backup,
			Message: "Quitada la entrada y borrado el archivo, que solo tenía esto.",
		}, nil
	}

	data, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return WriteResult{}, fmt.Errorf("serializar la configuración: %w", err)
	}
	data = append(data, '\n')

	backup, err := writeWithBackup(path, data, true)
	if err != nil {
		return WriteResult{}, err
	}
	return WriteResult{Path: path, Action: ActionRemoved, Backup: backup}, nil
}

// removeTOML quita la sección del servidor, sus subsecciones y el comentario que
// SaveMe escribió encima.
//
// Se trabaja línea a línea en vez de reserializar: el TOML del usuario puede
// tener formato, comentarios y orden que un volcado no reproduciría, y perder eso
// es peor que no poder quitar la entrada.
func removeTOML(p Provider, opts Options, path string, existing []byte) (WriteResult, error) {
	header := "[" + p.ServersKey + "." + opts.Name + "]"
	subHeader := "[" + p.ServersKey + "." + opts.Name + "."

	lines := strings.Split(string(existing), "\n")

	start, end := -1, -1
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "[") {
			continue
		}
		ours := trimmed == header || strings.HasPrefix(trimmed, subHeader)
		switch {
		case ours && start == -1:
			start = i
			// Justo encima va lo que escribió SaveMe: una línea en blanco y su
			// comentario de dos líneas. Solo se retrocede sobre eso.
			if start > 0 && strings.TrimSpace(lines[start-1]) == "" {
				start--
			}
			for start > 0 && isOurComment(lines[start-1]) {
				start--
			}
		case !ours && start != -1:
			// La sección acaba donde empieza la siguiente.
			end = i
		}
		if end != -1 {
			break
		}
	}

	if start == -1 {
		return WriteResult{
			Path:    path,
			Action:  ActionAbsent,
			Message: "«" + opts.Name + "» no estaba en el archivo; no lo toqué.",
		}, nil
	}
	if end == -1 {
		end = len(lines)
	}

	kept := make([]string, 0, len(lines))
	kept = append(kept, lines[:start]...)
	kept = append(kept, lines[end:]...)
	data := strings.TrimRight(strings.Join(kept, "\n"), "\n")

	if strings.TrimSpace(data) == "" {
		backup, err := removeFileWithBackup(path, existing)
		if err != nil {
			return WriteResult{}, err
		}
		return WriteResult{
			Path:    path,
			Action:  ActionRemoved,
			Backup:  backup,
			Message: "Quitada la sección y borrado el archivo, que solo tenía esto.",
		}, nil
	}

	backup, err := writeWithBackup(path, []byte(data+"\n"), true)
	if err != nil {
		return WriteResult{}, err
	}
	return WriteResult{Path: path, Action: ActionRemoved, Backup: backup}, nil
}

// isOurComment reconoce las dos líneas que escribe applyTOML antes de la sección.
func isOurComment(line string) bool {
	trimmed := strings.TrimSpace(line)
	return strings.HasPrefix(trimmed, "# SaveMe:") ||
		strings.HasPrefix(trimmed, "# Generado con `saveme mcp-config")
}

// removeFileWithBackup borra el archivo dejando copia de lo que había.
func removeFileWithBackup(path string, existing []byte) (string, error) {
	backup := path + ".saveme-backup"
	if err := os.WriteFile(backup, existing, 0o644); err != nil {
		return "", fmt.Errorf("escribir la copia de seguridad: %w", err)
	}
	if err := os.Remove(path); err != nil {
		return backup, fmt.Errorf("borrar %s: %w", path, err)
	}
	return backup, nil
}
