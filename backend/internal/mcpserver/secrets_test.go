package mcpserver

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Un cuerpo con una credencial tiene que llegarle al agente marcado —para que la
// quite antes de preguntar— y al usuario en el diálogo, sin que ninguno de los dos
// avisos repita el secreto.
func TestProponerConUnSecretoAvisaSinRepetirlo(t *testing.T) {
	h := newHarness(t, true)
	// Por partes, para que el escáner de GitHub no bloquee el push de este archivo.
	secreto := "AK" + "IA" + "Q3EGRIZ2ZK7XWPLM"

	var seen *mcp.ElicitRequest
	h.elicitF = func(_ context.Context, req *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
		seen = req
		return &mcp.ElicitResult{Action: "decline"}, nil
	}

	out := h.callOK(t, "saveme_summary_propose", map[string]any{
		"project": "saveme",
		"title":   "Arreglo del despliegue",
		"body":    "Cambiamos la credencial del bucket.\n\nLa nueva es " + secreto + ".",
	})

	warnings, _ := out["secret_warnings"].([]any)
	if len(warnings) != 1 {
		t.Fatalf("esperaba un aviso de secreto, llegó %v", out["secret_warnings"])
	}
	first, _ := warnings[0].(map[string]any)
	if first["kind"] != "aws_access_key" || first["field"] != "body" || first["line"] != float64(3) {
		t.Errorf("el aviso no dice qué ni dónde: %v", first)
	}
	if next, _ := out["next_step"].(string); !strings.HasPrefix(next, "ANTES DE PREGUNTAR") {
		t.Errorf("el siguiente paso tiene que empezar por quitar el secreto: %q", next)
	}
	raw, _ := json.Marshal(out["secret_warnings"])
	if strings.Contains(string(raw), secreto) {
		t.Errorf("el aviso devuelve el secreto entero: %s", raw)
	}

	h.callOK(t, "saveme_summary_confirm", map[string]any{
		"token": out["token"], "decision": "accepted", "elicit": true,
	})
	if seen == nil {
		t.Fatal("no se le preguntó al usuario")
	}
	if !strings.Contains(seen.Params.Message, "credenciales") {
		t.Errorf("el diálogo no avisa del secreto: %q", seen.Params.Message)
	}
}
