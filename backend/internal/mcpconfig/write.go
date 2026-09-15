package mcpconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
)

// Action describe qué hizo (o qué hay que hacer con) la configuración.
type Action string

const (
	// ActionCreated: el archivo no existía y se creó.
	ActionCreated Action = "created"
	// ActionMerged: se añadió el servidor a un archivo que ya existía,
	// conservando lo que hubiera.
	ActionMerged Action = "merged"
	// ActionUpdated: el servidor ya estaba y se reemplazó su definición.
	ActionUpdated Action = "updated"
	// ActionPresent: ya estaba configurado y no se tocó nada.
	ActionPresent Action = "already-configured"
	// ActionManual: hay que aplicarlo a mano, y se explica por qué.
	ActionManual Action = "manual"
)

// WriteResult es el resultado de intentar aplicar una configuración.
type WriteResult struct {
	Path    string
	Action  Action
	Backup  string
	Message string
	// Command es lo que el usuario debe ejecutar cuando Action es Manual y el
	// proveedor se configura por comando.
	Command string
}

// Apply escribe la configuración del proveedor en su archivo global.
//
// Reglas de seguridad, en orden de importancia:
//
//   - Nunca se pierde información: si hay que tocar un archivo existente, se
//     hace copia de seguridad antes.
//   - Si el archivo es JSONC (OpenCode admite comentarios), no se reescribe: un
//     parseo y volcado los borraría. Se devuelve el bloque para pegar.
//   - En TOML no se reescribe un archivo existente: se añade la sección al final
//     si no está. Reescribir TOML a mano es una forma segura de perder formato.
//   - Si el servidor ya está configurado, no se toca nada.
func Apply(p Provider, opts Options) (WriteResult, error) {
	if opts.Command == "" {
		return WriteResult{}, errors.New("falta el ejecutable del servidor")
	}
	// La misma normalización que usa Build: así lo que se muestra y lo que se
	// escribe son lo mismo por construcción, no por casualidad.
	opts = WithDefaults(opts)

	if p.Format == FormatCLI {
		snippet, err := Build(p, opts)
		if err != nil {
			return WriteResult{}, err
		}
		return WriteResult{
			Action:  ActionManual,
			Command: snippet.Body,
			Message: "Claude Code se configura con un comando; ejecútalo tal cual. " +
				"No se toca ~/.claude.json porque es su archivo de estado interno.",
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
	fileExists := err == nil
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return WriteResult{}, fmt.Errorf("leer %s: %w", path, err)
	}

	switch p.Format {
	case FormatJSON:
		return applyJSON(p, opts, path, existing, fileExists)
	case FormatTOML:
		return applyTOML(p, opts, path, existing, fileExists)
	case FormatManual:
		// No se escribe a ciegas un formato que no está confirmado: se le da el
		// bloque al usuario y decide él dónde va.
		return WriteResult{
			Path:   path,
			Action: ActionManual,
			Message: "No tengo confirmado el formato de configuración de este cliente, " +
				"así que no lo toco. Copia el bloque y pégalo donde corresponda.",
		}, nil
	default:
		return WriteResult{}, fmt.Errorf("formato no soportado: %q", p.Format)
	}
}

// normalizeJSON pasa un valor por JSON y de vuelta.
//
// Hace falta para comparar lo que hay en el archivo con lo que se va a escribir:
// al leer, un `[]string` llega como `[]any` y un `map[string]any` anidado no es
// DeepEqual de su equivalente construido en memoria, aunque el contenido sea el
// mismo. Con el viaje de ida y vuelta los dos lados tienen los mismos tipos.
func normalizeJSON(value any) (any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func applyJSON(p Provider, opts Options, path string, existing []byte, fileExists bool) (WriteResult, error) {
	if fileExists && hasJSONComments(existing) {
		return WriteResult{
			Path:   path,
			Action: ActionManual,
			Message: "Tu archivo tiene comentarios (JSONC) y reescribirlo te los borraría, " +
				"así que no lo toco. Pega el bloque a mano dentro de la clave \"" +
				p.ServersKey + "\".",
		}, nil
	}

	root := map[string]any{}
	if fileExists && len(strings.TrimSpace(string(existing))) > 0 {
		if err := json.Unmarshal(existing, &root); err != nil {
			return WriteResult{}, fmt.Errorf(
				"%s no es JSON válido (%w); arréglalo o pásame otro archivo con --path", path, err)
		}
	}

	servers, _ := root[p.ServersKey].(map[string]any)
	if servers == nil {
		servers = map[string]any{}
	}

	// Se compara **antes** de escribir. Mirar solo si la clave existe no basta:
	// tras la primera vez siempre existe, así que el archivo se reescribía igual
	// (con su copia de seguridad y su cambio de fecha) y se reportaba `updated`
	// aunque no hubiera cambiado nada. El usuario pulsaba «configurar otra vez» y
	// le decía que había actualizado algo cuando no había tocado nada.
	entry, err := normalizeJSON(serverEntry(p, opts))
	if err != nil {
		return WriteResult{}, err
	}
	previous, alreadyPresent := servers[opts.Name]
	if alreadyPresent && reflect.DeepEqual(previous, entry) {
		return WriteResult{
			Path:    path,
			Action:  ActionPresent,
			Message: "«" + opts.Name + "» ya estaba configurado así; no toqué el archivo.",
		}, nil
	}

	servers[opts.Name] = entry
	root[p.ServersKey] = servers

	data, err := json.MarshalIndent(root, "", "  ")
	if err != nil {
		return WriteResult{}, fmt.Errorf("serializar la configuración: %w", err)
	}
	data = append(data, '\n')

	backup, err := writeWithBackup(path, data, fileExists)
	if err != nil {
		return WriteResult{}, err
	}

	action := ActionCreated
	if alreadyPresent {
		action = ActionUpdated
	} else if fileExists {
		action = ActionMerged
	}
	return WriteResult{Path: path, Action: action, Backup: backup}, nil
}

func applyTOML(p Provider, opts Options, path string, existing []byte, fileExists bool) (WriteResult, error) {
	section := fmt.Sprintf("[%s.%s]", p.ServersKey, opts.Name)
	if fileExists && strings.Contains(string(existing), section) {
		return WriteResult{
			Path:    path,
			Action:  ActionPresent,
			Message: section + " ya existe; no lo toco para no pisar tu configuración.",
		}, nil
	}

	snippet, err := Build(p, opts)
	if err != nil {
		return WriteResult{}, err
	}

	var data []byte
	if fileExists {
		data = append(append([]byte{}, existing...), []byte("\n")...)
	}
	data = append(data, []byte("# SaveMe: diario técnico de proyecto (servidor MCP por stdio).\n"+
		"# Generado con `saveme mcp-config --provider "+p.Key+" --write`.\n")...)
	data = append(data, []byte(snippet.Body)...)

	backup, err := writeWithBackup(path, data, fileExists)
	if err != nil {
		return WriteResult{}, err
	}

	action := ActionCreated
	if fileExists {
		action = ActionMerged
	}
	return WriteResult{Path: path, Action: action, Backup: backup}, nil
}

// writeWithBackup escribe el archivo y, si ya existía, deja una copia al lado.
func writeWithBackup(path string, data []byte, fileExists bool) (string, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("crear %s: %w", filepath.Dir(path), err)
	}

	backup := ""
	if fileExists {
		original, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		backup = path + ".saveme-backup"
		if err := os.WriteFile(backup, original, 0o644); err != nil {
			return "", fmt.Errorf("escribir la copia de seguridad: %w", err)
		}
	}

	tmp, err := os.CreateTemp(filepath.Dir(path), ".saveme-config-*")
	if err != nil {
		return backup, fmt.Errorf("crear temporal: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return backup, err
	}
	if err := tmp.Close(); err != nil {
		return backup, err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return backup, fmt.Errorf("reemplazar %s: %w", path, err)
	}
	return backup, nil
}

// hasJSONComments detecta comentarios de JSONC sin confundirse con las barras de
// una URL (https://…) ni con las que van dentro de una cadena.
func hasJSONComments(data []byte) bool {
	inString := false
	escaped := false
	for i := 0; i < len(data); i++ {
		c := data[i]
		if inString {
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				inString = false
			}
			continue
		}
		switch c {
		case '"':
			inString = true
		case '/':
			if i+1 < len(data) && (data[i+1] == '/' || data[i+1] == '*') {
				return true
			}
		}
	}
	return false
}

// renderJSON produce el mismo JSON que escribiría Apply, para que el bloque que
// se muestra por pantalla y el que se escribe no puedan divergir.
func renderJSON(v any) string {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return "{}"
	}
	return string(data) + "\n"
}

func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
