#!/usr/bin/env bash
# Verificación end-to-end de SaveMe contra el binario real.
#
# Las pruebas de Go usan transportes en memoria; esto arranca el daemon de
# verdad, lanza el MCP como subproceso y comprueba los caminos que solo se
# pueden probar así:
#
#   1. el daemon sirve la API y reporta el puerto correcto
#   2. un agente (proceso aparte) propone un resumen por stdio
#   3. el daemon VE esa propuesta aunque la creó otro proceso
#   4. el usuario la confirma desde la interfaz (por HTTP) y el archivo aparece
#   5. el stream SSE emite los eventos
#   6. con el daemon APAGADO, el MCP escribe directamente y el daemon lo
#      encuentra al volver a arrancar (la garantía "el agente escribe igual")
#
# Uso: scripts/e2e.sh

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=./env.sh
source scripts/env.sh

BIN="$ROOT_DIR/backend/bin/saveme"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/saveme-e2e.XXXXXX")"
export SAVEME_ROOT="$WORK/ws"
export SAVEME_CONFIG="$WORK/config.json"
PORT=7456
BASE="http://127.0.0.1:$PORT"
DAEMON_PID=""

PASS=0
FAIL=0

cleanup() {
  if [[ -n "$DAEMON_PID" ]] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    kill "$DAEMON_PID" 2>/dev/null
    wait "$DAEMON_PID" 2>/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# assert_eq <descripción> <esperado> <obtenido>
assert_eq() {
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (esperado '$2', obtenido '$3')"; fi
}
assert_contains() {
  if [[ "$3" == *"$2"* ]]; then ok "$1"; else bad "$1 (no contiene '$2': ${3:0:200})"; fi
}
assert_file_exists() {
  if [[ -f "$2" ]]; then ok "$1"; else bad "$1 (no existe $2)"; fi
}
assert_file_absent() {
  if [[ ! -f "$2" ]]; then ok "$1"; else bad "$1 (existe y no debería: $2)"; fi
}

# json_field <expresión> lee un campo del JSON que llega por stdin.
# La expresión se evalúa con `d` como raíz: json_field "['items'][0]['id']".
json_field() {
  python3 -c "import json,sys; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null || echo ""
}

# json_len cuenta los elementos del array que llega por stdin.
json_len() {
  python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?"
}

start_daemon() {
  "$BIN" serve --port "$PORT" --no-watch >"$WORK/daemon.log" 2>&1 &
  DAEMON_PID=$!
  for _ in $(seq 1 50); do
    if curl -sf --max-time 1 "$BASE/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.2
  done
  echo "el daemon no arrancó; log:"; cat "$WORK/daemon.log"; return 1
}

stop_daemon() {
  if [[ -n "$DAEMON_PID" ]] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    kill "$DAEMON_PID" 2>/dev/null
    wait "$DAEMON_PID" 2>/dev/null
  fi
  DAEMON_PID=""
}

# ---------------------------------------------------------------------------

echo "SaveMe — verificación end-to-end"
echo "workspace: $SAVEME_ROOT"

step "0. Compilar"
if (cd backend && go build -o bin/saveme ./cmd/saveme); then ok "binario compilado"; else bad "la compilación falló"; exit 1; fi

step "1. Arranque del daemon"
start_daemon || exit 1
HEALTH="$(curl -s --max-time 5 "$BASE/api/health")"
assert_eq "el daemon responde" "True" "$(echo "$HEALTH" | json_field "['ok']")"
assert_eq "reporta el puerto REAL en el que escucha" "$PORT" "$(echo "$HEALTH" | json_field "['port']")"
assert_eq "usa FTS5 para buscar" "True" "$(echo "$HEALTH" | json_field "['using_fts']")"
assert_file_exists "publica daemon.json" "$SAVEME_ROOT/.saveme/daemon.json"

step "2. Un agente propone por MCP (proceso independiente)"
PROPOSE_OUT="$(python3 scripts/mcp-smoke.py "$BIN" propose "saveme-app" \
  "Editor markdown con preview sincronizado" \
  "Implementamos el editor con CodeMirror y agregamos sincronización de scroll.

## Por qué

Necesitábamos fidelidad absoluta del markdown: el archivo en disco es la fuente de verdad." 2>/dev/null)"

TOKEN="$(printf '%s\n' "$PROPOSE_OUT" | sed -n 's/^TOKEN=//p' | tail -1)"
if [[ -n "$TOKEN" ]]; then ok "el MCP devolvió un token"; else bad "el MCP no devolvió token"; printf '%s\n' "$PROPOSE_OUT"; fi

REL_PATH="$(printf '%s\n' "$PROPOSE_OUT" | python3 -c "import json,sys; t=sys.stdin.read(); s=t[t.index('{'):t.rindex('}')+1]; print(json.loads(s)['rel_path'])" 2>/dev/null || echo "")"
assert_contains "la inferencia clasificó como feature (español conjugado)" "/features/" "$REL_PATH"
TTL="$(printf '%s\n' "$PROPOSE_OUT" | grep -o '"expires_in_minutes": [0-9]*' | grep -o '[0-9]*' | head -1)"
if [[ -n "$TTL" && "$TTL" -le 15 && "$TTL" -ge 1 ]]; then ok "el TTL se anuncia en minutos ($TTL)"; else bad "TTL raro: '$TTL'"; fi
assert_file_absent "proponer NO escribió el archivo (dos fases)" "$SAVEME_ROOT/$REL_PATH"

step "3. El daemon ve lo que creó otro proceso"
PENDING="$(curl -s --max-time 5 "$BASE/api/proposals?status=pending")"
assert_eq "la propuesta aparece en el inbox" "1" "$(printf '%s' "$PENDING" | json_len)"
assert_contains "con la misma ruta propuesta" "$REL_PATH" "$PENDING"

step "4. El usuario confirma desde la interfaz (HTTP)"
CONFIRM="$(curl -s --max-time 5 -X POST "$BASE/api/proposals/$TOKEN/confirm" \
  -H 'Content-Type: application/json' -d '{"decision":"accepted"}')"
assert_eq "se escribió" "True" "$(echo "$CONFIRM" | json_field "['created']")"
assert_eq "la respuesta declara la vía de resolución" "ui" "$(echo "$CONFIRM" | json_field "['resolved_via']")"
# Auditoría: releer la propuesta debe mostrar que quedó resuelta y por qué vía.
AUDIT="$(curl -s --max-time 5 "$BASE/api/proposals/$TOKEN")"
assert_eq "la propuesta quedó confirmada" "confirmed" "$(echo "$AUDIT" | json_field "['status']")"
assert_eq "la vía de resolución quedó auditada" "ui" "$(echo "$AUDIT" | json_field "['resolved_via']")"
assert_eq "y se registró el resumen que produjo" "True" "$(echo "$AUDIT" | json_field "['summary_id'] != ''")"
assert_file_exists "el archivo existe en la ruta prometida" "$SAVEME_ROOT/$REL_PATH"
assert_contains "tiene frontmatter de SaveMe" "status: confirmed" "$(cat "$SAVEME_ROOT/$REL_PATH" 2>/dev/null)"
assert_contains "el cuerpo llegó intacto" "CodeMirror" "$(cat "$SAVEME_ROOT/$REL_PATH" 2>/dev/null)"

step "5. Listado, lectura y búsqueda por la API"
LIST="$(curl -s --max-time 5 "$BASE/api/summaries?project=saveme-app")"
assert_eq "el listado tiene 1 resumen" "1" "$(echo "$LIST" | json_field "['total']")"
ID="$(echo "$LIST" | json_field "['items'][0]['id']")"

READ="$(curl -s --max-time 5 "$BASE/api/summaries/$ID")"
assert_contains "la lectura devuelve el cuerpo" "fidelidad absoluta" "$READ"

SEARCH="$(curl -s --max-time 5 "$BASE/api/summaries?q=CodeMirror")"
assert_eq "la búsqueda por contenido encuentra el resumen" "1" "$(echo "$SEARCH" | json_field "['total']")"

RAW_HASH="$(curl -s --max-time 5 -D - -o /dev/null "$BASE/api/summaries/$ID/raw" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-saveme-content-hash"{print $2}')"
if [[ -n "$RAW_HASH" ]]; then ok "el endpoint raw expone el hash de contenido"; else bad "no llegó X-Saveme-Content-Hash"; fi

step "6. Edición con concurrencia optimista"
python3 - "$SAVEME_ROOT/$REL_PATH" "$RAW_HASH" >"$WORK/put.json" <<'PYEOF'
import json, sys
content = open(sys.argv[1], encoding="utf-8").read()
json.dump({"content": content.replace("CodeMirror", "CodeMirror 6"), "base_hash": sys.argv[2]}, sys.stdout)
PYEOF
SAVE_OK="$(curl -s --max-time 5 -X PUT "$BASE/api/summaries/$ID" \
  -H 'Content-Type: application/json' --data-binary "@$WORK/put.json")"
assert_contains "guardar con el hash correcto funciona" "content_hash" "$SAVE_OK"

CONFLICT_CODE="$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/summaries/$ID" \
  -H 'Content-Type: application/json' -d '{"content":"pisado","base_hash":"hash-viejo"}')"
assert_eq "guardar con hash viejo da 409" "409" "$CONFLICT_CODE"
assert_contains "y no pisó el archivo" "CodeMirror 6" "$(cat "$SAVEME_ROOT/$REL_PATH")"

step "7. Stream SSE"
EVENTS="$(curl -s --max-time 3 -N "$BASE/api/events" 2>/dev/null | head -c 2000 || true)"
assert_contains "el stream emite el saludo inicial" "hello" "$EVENTS"

step "8. El agente escribe con la app APAGADA"
stop_daemon
ok "daemon detenido"
OFFLINE_OUT="$(python3 scripts/mcp-smoke.py "$BIN" full "proyecto-offline" \
  "Migración de la base de datos" \
  "Corregimos el script de migración que fallaba con tablas vacías." 2>/dev/null)"
assert_contains "el MCP escribió sin el daemon" "\"written\": true" "$OFFLINE_OUT"
OFFLINE_PATH="$(find "$SAVEME_ROOT/proyecto-offline" -name '*.md' 2>/dev/null | head -1)"
assert_file_exists "el archivo quedó en disco" "$OFFLINE_PATH"
assert_contains "clasificado como fix sin señales en el título" "/fixes/" "$OFFLINE_PATH"

step "9. El daemon reconciliación al volver a arrancar"
start_daemon || exit 1
sleep 0.5
AFTER="$(curl -s --max-time 5 "$BASE/api/summaries?project=proyecto-offline")"
assert_eq "encuentra el resumen escrito con la app cerrada" "1" "$(echo "$AFTER" | json_field "['total']")"
STATS="$(curl -s --max-time 5 "$BASE/api/stats")"
assert_eq "el índice global tiene 2 resúmenes" "2" "$(echo "$STATS" | json_field "['summaries']")"

step "10. Reindexación forzada"
REINDEX="$(curl -s --max-time 10 -X POST "$BASE/api/reindex")"
assert_eq "la reindexación no encuentra cambios pendientes" "0" "$(echo "$REINDEX" | json_field "['indexed']")"
assert_eq "y ve los 2 archivos sin tocarlos" "2" "$(echo "$REINDEX" | json_field "['unchanged']")"

step "11. La guía para agentes"
GUIDE="$(curl -s --max-time 5 "$BASE/api/agents/guide")"
assert_contains "explica el flujo de dos fases" "saveme_summary_confirm" "$GUIDE"
GUIDE_CLI="$("$BIN" guide 2>/dev/null)"
assert_contains "el subcomando guide también la imprime" "saveme_summary_propose" "$GUIDE_CLI"

# ---------------------------------------------------------------------------

printf '\n\033[1mResultado: %d pasaron, %d fallaron\033[0m\n' "$PASS" "$FAIL"
if [[ "$FAIL" -gt 0 ]]; then exit 1; fi
echo "Todo verificado."
