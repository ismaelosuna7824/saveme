package api

import (
	"net/http"
	"os"
	"strings"

	"github.com/ismaelosuna/saveme/backend/internal/mcpconfig"
)

// Los endpoints de MCP permiten que la propia app configure a los agentes del
// usuario. Es la parte que hace que la instalación no termine en "ahora edita
// siete archivos de configuración a mano".

// mcpEnv devuelve las variables que hay que fijar en el cliente para que el MCP
// resuelva la MISMA raíz de workspace que este daemon.
//
// Solo se emiten las que vinieron del entorno del daemon. Si la raíz sale de la
// configuración, el MCP la resuelve igual por su cuenta y no hay nada que fijar;
// añadirlas "por si acaso" solo crea una forma de que se desincronicen.
func mcpEnv() map[string]string {
	env := map[string]string{}
	if v := strings.TrimSpace(os.Getenv("SAVEME_ROOT")); v != "" {
		env["SAVEME_ROOT"] = v
	}
	if v := strings.TrimSpace(os.Getenv("SAVEME_CONFIG")); v != "" {
		env["SAVEME_CONFIG"] = v
	}
	if len(env) == 0 {
		return nil
	}
	return env
}

// mcpOptions arma las opciones de configuración con el binario ya instalado.
func (s *Server) mcpOptions(binaryPath string) mcpconfig.Options {
	return mcpconfig.WithDefaults(mcpconfig.Options{
		Command: binaryPath,
		Name:    "saveme",
		Env:     mcpEnv(),
	})
}

// handleMCPProviders lista los clientes detectados y el estado del binario.
func (s *Server) handleMCPProviders(w http.ResponseWriter, _ *http.Request) {
	installed := ""
	onPath := mcpconfig.LooksInstalled()
	if path, err := mcpconfig.InstallPath(); err == nil {
		if _, statErr := os.Stat(path); statErr == nil {
			installed = path
		}
	}
	self := ""
	if exe, err := os.Executable(); err == nil {
		self = exe
	}

	// La versión de la copia instalada es la que ejecutarán los clientes MCP, y
	// **no se actualiza sola**: el actualizador reemplaza el binario de dentro del
	// `.app`, no esta copia. Si se quedan en versiones distintas, la app y el MCP
	// dejan de ser el mismo programa —que es justo lo que promete el producto— y
	// lo hacen sin ningún síntoma: un agente seguiría usando las herramientas
	// viejas contra una app nueva.
	installedVersion := ""
	versionErr := ""
	if installed != "" {
		if v, err := mcpconfig.VersionOf(installed); err == nil {
			installedVersion = v
		} else {
			versionErr = err.Error()
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"providers": mcpconfig.Report("saveme"),
		"binary": map[string]any{
			// installed_path es el binario estable que usarán los clientes.
			"installed_path": installed,
			// self_path es el binario en ejecución (dentro del .app, en el bundle).
			"self_path": self,
			// on_path indica si además se puede invocar como `saveme`.
			"on_path": onPath,
			// self_version es la de la app; installed_version, la de la copia.
			// in_sync solo es cierto si hay copia y las dos coinciden.
			"self_version":      s.version,
			"installed_version": installedVersion,
			"in_sync":           installedVersion != "" && installedVersion == s.version,
			// Si la copia existe pero no se deja preguntar (truncada, sin permiso
			// de ejecución), el motivo va aquí: es un problema distinto de «está
			// desactualizada», y se arregla igual reinstalando.
			"version_error": versionErr,
		},
	})
}

// handleMCPInstall copia el binario a su ubicación estable.
func (s *Server) handleMCPInstall(w http.ResponseWriter, r *http.Request) {
	path, err := mcpconfig.SelfInstall()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "install_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    path,
		"on_path": mcpconfig.LooksInstalled(),
		"message": "El servidor MCP quedó instalado. No hay que descargar nada: " +
			"el binario es autocontenido.",
	})
}

// handleMCPConfigure instala el binario y configura los clientes pedidos.
//
// Se hace todo en una operación porque el orden importa: una configuración que
// apunte a un binario que no existe falla en silencio, y el usuario no tendría
// forma de saber por qué.
func (s *Server) handleMCPConfigure(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Providers []string `json:"providers"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.Providers) == 0 {
		writeErr(w, http.StatusBadRequest, "no_providers", "no pediste configurar ningún cliente")
		return
	}

	binaryPath, err := mcpconfig.SelfInstall()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "install_failed", err.Error())
		return
	}
	opts := s.mcpOptions(binaryPath)

	results := make([]map[string]any, 0, len(body.Providers))
	for _, key := range body.Providers {
		provider, ok := mcpconfig.Find(key)
		if !ok {
			results = append(results, map[string]any{
				"key":     key,
				"action":  "unknown",
				"message": "cliente desconocido",
			})
			continue
		}

		result, err := mcpconfig.Apply(provider, opts)
		entry := map[string]any{
			"key":    provider.Key,
			"name":   provider.Name,
			"action": string(result.Action),
		}
		if err != nil {
			entry["action"] = "error"
			entry["message"] = err.Error()
			results = append(results, entry)
			continue
		}
		if result.Path != "" {
			entry["path"] = result.Path
		}
		if result.Message != "" {
			entry["message"] = result.Message
		}
		if result.Backup != "" {
			entry["backup"] = result.Backup
		}
		if result.Command != "" {
			entry["command"] = result.Command
		}
		results = append(results, entry)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"binary_path": binaryPath,
		"results":     results,
	})
}

// handleMCPUnconfigure quita la entrada de SaveMe de los clientes pedidos.
//
// Es la operación simétrica de `handleMCPConfigure`, y a propósito no toca el
// binario instalado: quitarlo de un cliente no es desinstalar SaveMe, y borrar el
// binario dejaría sin servidor a los demás clientes que sí lo tengan configurado.
func (s *Server) handleMCPUnconfigure(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Providers []string `json:"providers"`
	}
	if !decodeBody(w, r, &body) {
		return
	}
	if len(body.Providers) == 0 {
		writeErr(w, http.StatusBadRequest, "no_providers", "no pediste quitar ningún cliente")
		return
	}

	opts := s.mcpOptions("")

	results := make([]map[string]any, 0, len(body.Providers))
	for _, key := range body.Providers {
		provider, ok := mcpconfig.Find(key)
		if !ok {
			results = append(results, map[string]any{
				"key":     key,
				"action":  "unknown",
				"message": "cliente desconocido",
			})
			continue
		}

		result, err := mcpconfig.Remove(provider, opts)
		entry := map[string]any{
			"key":    provider.Key,
			"name":   provider.Name,
			"action": string(result.Action),
		}
		if err != nil {
			entry["action"] = "error"
			entry["message"] = err.Error()
			results = append(results, entry)
			continue
		}
		if result.Path != "" {
			entry["path"] = result.Path
		}
		if result.Message != "" {
			entry["message"] = result.Message
		}
		if result.Backup != "" {
			entry["backup"] = result.Backup
		}
		if result.Command != "" {
			entry["command"] = result.Command
		}
		results = append(results, entry)
	}

	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// handleMCPSnippet devuelve el bloque de configuración de un cliente, para que la
// interfaz pueda enseñarlo y copiarlo (la vía manual cuando no se puede escribir).
func (s *Server) handleMCPSnippet(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimSpace(r.URL.Query().Get("provider"))
	if key == "" {
		writeErr(w, http.StatusBadRequest, "missing_provider", "falta el parámetro provider")
		return
	}
	provider, ok := mcpconfig.Find(key)
	if !ok {
		writeErr(w, http.StatusNotFound, "unknown_provider", "cliente desconocido: "+key)
		return
	}

	// El bloque debe apuntar al binario estable, no al que va dentro de la app:
	// si el usuario mueve o borra la aplicación, el que está dentro desaparece.
	binaryPath, err := mcpconfig.InstallPath()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "install_path", err.Error())
		return
	}
	// Si todavía no se instaló, se muestra la ruta donde quedará: el bloque que
	// el usuario copie tiene que ser el correcto, no uno que dependa de que
	// `saveme` esté en el PATH. Los clientes lanzados desde una interfaz gráfica
	// heredan un PATH mínimo, así que la ruta absoluta es lo único fiable.
	pendingInstall := false
	if _, statErr := os.Stat(binaryPath); statErr != nil {
		pendingInstall = true
	}

	snippet, err := mcpconfig.Build(provider, s.mcpOptions(binaryPath))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "snippet_failed", err.Error())
		return
	}

	warnings := snippet.Warnings
	if pendingInstall {
		warnings = append(warnings, "El servidor MCP todavía no está instalado; "+
			"se instalará en "+binaryPath+" al configurar un cliente. El bloque ya "+
			"apunta ahí, así que puedes pegarlo cuando quieras.")
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"provider":        provider.Key,
		"name":            provider.Name,
		"path":            snippet.Path,
		"body":            snippet.Body,
		"language":        snippet.Language,
		"writable":        snippet.Writable,
		"verified":        provider.Verified,
		"warnings":        warnings,
		"binary":          binaryPath,
		"pending_install": pendingInstall,
		"env_fixed":       mcpEnv(),
	})
}
