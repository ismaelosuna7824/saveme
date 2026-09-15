# Configurar el MCP en cualquier cliente

El objetivo: que en **cualquier proyecto**, sin abrir la app, le digas a tu agente
*«guarda un resumen en SaveMe de lo que acabamos de hacer»* y funcione.

## Por qué funciona con la app cerrada

No hay nada que activar. **El MCP es el mismo binario de Go que la app**, con otro
subcomando:

```
saveme serve   ← lo lanza la app. Abre la ventana, sirve la API y vigila el disco.
saveme mcp     ← lo lanza tu agente. Habla MCP por stdio.
```

Los dos hablan **directo con SQLite y con los archivos**. El MCP no llama al
daemon, no necesita que la app esté abierta y no se queda esperando a nadie. Si
el daemon está corriendo, el watcher de la app ve el archivo nuevo y la interfaz
se actualiza sola; si no está, el archivo queda en disco y la app lo encuentra al
abrir porque reconcilia el índice contra el disco.

La única condición es una: **los dos tienen que resolver la misma raíz de
workspace.** Eso es lo que hace el apartado siguiente.

## Camino rápido

**La app lo hace sola.** En el primer arranque abre un asistente que te explica qué
va a hacer, detecta qué agentes tienes instalados en la máquina y configura el que
elijas. Vuelve a abrirlo cuando quieras con `Cmd+K` → «Configurar el MCP en otros
agentes».

Para hacerlo desde la terminal, o en un cliente que el asistente no liste:

```bash
make install                          # deja `saveme` en tu PATH
saveme doctor                         # dice qué falta, si falta algo
saveme mcp-config --list              # qué clientes hay y cuáles ya tienen saveme
saveme mcp-config --provider opencode --write   # o codex, cursor, claude-code…
```

`mcp-config` averigua solo la ruta del binario y la raíz efectiva, así que el
bloque que genera ya viene con lo correcto. `--write` **fusiona** en tu archivo
existente y deja copia de seguridad: no te borra los MCP que ya tengas.

Después, **reinicia el cliente** para que cargue el servidor.

## Quitarlo de un cliente

Desde la app: **Ajustes → clientes de IA**. Cada cliente que ya tiene SaveMe
configurado muestra un botón para quitarlo. Se puede hacer uno a uno.

Desde la terminal:

```bash
saveme mcp-config --provider opencode --remove
```

Qué hace exactamente, porque importa cuando el archivo es tuyo:

- Borra **solo la entrada de SaveMe**. Los demás servidores MCP del archivo y el
  resto de su contenido quedan intactos.
- Deja **copia de seguridad** antes de tocar nada.
- Si el archivo se queda sin nada más, lo borra: era un archivo que había creado
  SaveMe y dejarlo con un `{}` dentro sería basura nuestra.
- Si tu archivo tiene **comentarios (JSONC)**, no lo reescribe —un parseo y volcado
  se los comería— y te dice que lo quites a mano.
- En **Claude Code**, que se configura con un comando y no con un archivo, te da el
  comando para darlo de baja (`claude mcp remove --scope user saveme`).
- **No desinstala el binario.** Quitarlo de un cliente no es desinstalar SaveMe, y
  borrarlo dejaría sin servidor a los demás clientes que sí lo tengan configurado.
  Para eso, borra `~/.saveme/`.

Quitar dos veces no es un error: la segunda dice que no había nada que quitar y no
toca el archivo.

## Dónde va la configuración de cada cliente

| Cliente | `--provider` | Archivo global | Formato | Escribe solo |
| --- | --- | --- | --- | --- |
| OpenCode ✓ | `opencode` | `~/.config/opencode/opencode.json` | clave `mcp`, `type: "local"`, `command` como **array** | sí |
| Codex CLI ✓ | `codex` | `~/.codex/config.toml` | sección `[mcp_servers.saveme]` | sí |
| Claude Code ✓ | `claude-code` | `~/.claude.json` | comando `claude mcp add --scope user` | comando |
| Claude Desktop ✓ | `claude-desktop` | `~/Library/Application Support/Claude/claude_desktop_config.json` | clave `mcpServers` | sí |
| Cursor ✓ | `cursor` | `~/.cursor/mcp.json` | clave `mcpServers` | sí |
| Windsurf | `windsurf` | `~/.codeium/windsurf/mcp_config.json` | clave `mcpServers` | sí |
| Gemini CLI | `gemini-cli` | `~/.gemini/settings.json` | clave `mcpServers` | sí |
| Qwen Code | `qwen` | `~/.qwen/settings.json` | clave `mcpServers` | sí |
| Kiro | `kiro` | `~/.kiro/settings/mcp.json` | clave `mcpServers` | sí |
| VS Code (Copilot) | `vscode-copilot` | `~/.config/Code/User/mcp.json` | clave **`servers`** y `type: "stdio"` | sí |
| Kilo Code | `kilocode` | almacén interno de la extensión | sin confirmar | no, manual |
| Otro | `generic` | el que le pases con `--path` | clave `mcpServers` | no, manual |

Hay dos distinciones que importan, y las dos se ven en la interfaz:

**«Escribe solo».** Los clientes cuyo formato no se puede escribir con confianza
(extensiones de VS Code cuyo almacén cambia entre versiones) **no se tocan**: se le
da al usuario el bloque para pegar. Escribir a ciegas en la configuración de alguien
es peor que pedirle que pegue dos líneas.

**«Verificado».** De los que se escriben, solo cinco están confirmados contra su
documentación oficial durante el desarrollo: OpenCode, Codex, Claude Code, Claude
Desktop y Cursor. Para Windsurf, Gemini CLI, Qwen Code, Kiro y VS Code la ruta y el
formato vienen de la convención de cada cliente y **se avisa de ello** antes de
escribir nada, tanto en la interfaz como en el bloque generado. Se escriben igual
—porque casi siempre son correctos— pero el aviso está ahí para que un fallo no sea
silencioso. Si un cliente no detecta el servidor, revisa su documentación y pásale
la ruta correcta con `--path`.

El ✓ marca los formatos confirmados contra la documentación oficial del cliente.

`~` es tu carpeta personal. En macOS, `~/.config` existe aunque no sea la
convención de Apple: OpenCode lo usa así a propósito.

### OpenCode

```jsonc
// ~/.config/opencode/opencode.json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "saveme": {
      "type": "local",
      "command": ["saveme", "mcp"],
      "enabled": true
    }
  }
}
```

Dos detalles que importan: OpenCode exige `type: "local"` —sin él el servidor no
arranca y el error no lo explica— y `command` es un **array**, no una cadena. Y
OpenCode **fusiona** los archivos de configuración en vez de reemplazarlos, así
que este bloque convive con tus otros MCP.

Si tu `opencode.json` tiene comentarios (admite JSONC), `--write` **no lo toca**:
te da el bloque para pegar, porque reescribirlo te borraría los comentarios.

### Codex CLI

```toml
# ~/.codex/config.toml
[mcp_servers.saveme]
command = "saveme"
args = ["mcp"]
enabled = true
```

### Claude Code

```bash
claude mcp add --scope user saveme -- saveme mcp
```

Claude Code tiene tres ámbitos: `local` (solo el proyecto actual), `project` (se
comparte por git con tu equipo) y `user` (todos tus proyectos). Para lo que
quieres —que funcione en cualquier proyecto— es `user`.

### Cursor, Claude Desktop y otros

```jsonc
// ~/.cursor/mcp.json
{
  "mcpServers": {
    "saveme": { "command": "saveme", "args": ["mcp"] }
  }
}
```

`mcpServers` es el formato de facto; casi todos los clientes que no están en la
tabla lo usan. Si el tuyo usa otro, pásale la ruta con `--path`.

## La regla de la raíz (el error que más cuesta)

El MCP y la app tienen que apuntar **al mismo sitio**. Por defecto los dos usan
`~/Documents/SaveMe` y la configuración de `~/Library/Application Support/SaveMe`,
así que coinciden solos y no hay nada que configurar.

El problema aparece si le pones `SAVEME_ROOT` a la app (por ejemplo para
desarrollo) y no al MCP: el agente escribirá en `~/Documents/SaveMe` y tú no verás
nada en la interfaz, sin ningún error de por medio. Es el fallo más confuso
posible porque todo "funciona".

```bash
saveme doctor
```

`doctor` avisa exactamente de esto. Si usas una raíz propia, fíjala también en el
bloque del MCP:

```bash
saveme mcp-config --provider opencode --root ~/mi-workspace
```

que emite el `environment` necesario. En uso normal, **no pongas nada**: dejar el
valor por defecto en los dos lados es más robusto que sincronizar una variable a
mano.

| Variable | Para qué |
| --- | --- |
| `SAVEME_ROOT` | raíz de los resúmenes. Gana sobre la configuración. |
| `SAVEME_CONFIG` | archivo de preferencias, si no quieres el estándar. |

## Global o por proyecto

Lo de arriba es **global**: vale para todos tus proyectos, que es lo que pediste.
Como los resúmenes se organizan por carpeta de proyecto dentro de una sola raíz,
un único servidor MCP global te sirve para todos: el agente decide el proyecto
según en qué repo esté trabajando y te lo pregunta antes de escribir.

Si en algún proyecto prefieres otra cosa, la mayoría de clientes admiten además
una configuración local del proyecto (`.cursor/mcp.json`, `opencode.json` en la
raíz, `.mcp.json`…). Se fusiona con la global; no hace falta elegir.

## Instruir al agente

Configurar el MCP hace que las tools existan. Para que el agente las use **bien**
—y sobre todo para que te pregunte dónde guardar en vez de inventarse una ruta—
dale las instrucciones:

```bash
saveme guide >> CLAUDE.md     # o AGENTS.md, o el archivo que use tu agente
```

El texto explica el flujo de dos fases, la estructura recomendada de un resumen y
la taxonomía de categorías. También está disponible como prompt MCP
(`saveme/human-summary`) y como recurso (`saveme://guide`) para los clientes que
los soporten.

## Comprobar que quedó bien

```bash
# 1. ¿El binario está donde el cliente lo va a buscar?
saveme doctor

# 2. ¿El MCP responde y ve tu workspace?
saveme mcp-config --list

# 3. ¿Puede escribir sin la app abierta?
saveme mcp-config --provider opencode      # revisa el bloque generado
```

Y la prueba de verdad, con la app **cerrada**: pídele al agente que guarde un
resumen, y luego comprueba que el archivo existe.

```bash
saveme reindex        # y la app lo verá al abrir
```

## Si algo no funciona

| Síntoma | Causa habitual |
| --- | --- |
| El cliente no lista las tools | No reiniciaste el cliente después de configurarlo. |
| «command not found: saveme» | El binario no está en el PATH **que ve el cliente** (no es lo mismo que el de tu terminal: los clientes de GUI heredan otro entorno). Usa la ruta absoluta. |
| Las tools están pero no aparecen resúmenes | El MCP y la app apuntan a raíces distintas. `saveme doctor`. |
| El agente escribe pero la app no lo muestra con la app abierta | La app arrancó con `--no-watch`. Reiníciala sin ese flag. |
| `--write` no toca el archivo | Tu config tiene comentarios JSONC. Pega el bloque a mano. |

## Fuentes de los formatos

Los formatos y rutas de esta guía están verificados contra la documentación de
cada cliente:

- [OpenCode — Config](https://opencode.ai/docs/config) (precedencia y `~/.config/opencode/opencode.json`)
- [OpenCode — MCP servers](https://opencode.ai/docs/mcp-servers) (`type`, `command` array, `environment`)
- [Claude Code — Connect to tools via MCP](https://code.claude.com/docs/en/mcp) (los tres ámbitos)
- [Codex CLI — MCP servers](https://mintlify.wiki/openai/codex/configuration/mcp-servers) (`[mcp_servers.*]` en `~/.codex/config.toml`)
- [Cursor — MCP](https://cursor.com/help/customization/mcp) (`~/.cursor/mcp.json`)
