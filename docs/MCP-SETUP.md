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
| GitHub Copilot (CLI y VS Code) ✓ | `copilot` | `~/.copilot/mcp-config.json` (o `$COPILOT_HOME`) | clave `mcpServers`, `type: "stdio"` | sí |
| VS Code, perfil de usuario | `vscode-copilot` | `~/Library/Application Support/Code/User/mcp.json` | clave **`servers`** y `type: "stdio"` | sí |
| Gemini CLI ✓ | `gemini-cli` | `~/.gemini/settings.json` | clave `mcpServers` | sí |
| Antigravity (app, IDE y `agy`) ✓ | `antigravity` | `~/.gemini/config/mcp_config.json` | clave `mcpServers` | sí |
| Qwen Code ✓ | `qwen` | `~/.qwen/settings.json` | clave `mcpServers` | sí |
| Kiro ✓ | `kiro` | `~/.kiro/settings/mcp.json` | clave `mcpServers` | sí |
| omp ✓ | `omp` | `~/.omp/agent/mcp.json` | clave `mcpServers` | sí |
| pi ✓ | `pi` | `~/.pi/agent/mcp.json` | clave `mcpServers` | sí |
| Kilo Code (CLI y extensiones) ✓ | `kilocode` | `~/.config/kilo/kilo.jsonc` o `kilo.json` | clave `mcp`, `type: "local"`, `command` como **array**, `environment` | sí |
| Amp ✓ | `amp` | `~/.config/amp/settings.json` (o `.jsonc`) | clave literal **`amp.mcpServers`** | sí |
| Z Code ✓ | `zcode` | `~/.zcode/cli/config.json` | anidada en **`mcp.servers`** | sí |
| Kimi Code ✓ | `kimi-code` | `~/.kimi-code/mcp.json` (o `$KIMI_CODE_HOME`) | clave `mcpServers` | sí |
| Devin (CLI y Desktop) ✓ | `devin` | `~/.config/devin/mcp_config.json` | clave `mcpServers` | sí |
| Windsurf, versiones antiguas | `windsurf` | `~/.codeium/windsurf/mcp_config.json` | clave `mcpServers` | sí |
| Hermes Agent ✓ | `hermes` | `~/.hermes/config.yaml` | comando `hermes mcp add` | comando |
| DeepSeek Harness ✓ | `deepseek` | `~/.dsh/cordis.patch.yml` | fila YAML del plugin `@deepseek-ai/dsh-mcp-client` | no, manual |
| Orca, Mono, T3 Code, Omnigent ✓ | `orca`, `monocode`, `t3code`, `omnigent` | — | sin configuración propia: usan la de los agentes que lanzan | no aplica |
| Otro | `generic` | el que le pases con `--path` | clave `mcpServers` | no, manual |
| Personalizado | `custom` | el que le pases con `--path` | la que describas | sí |

Hay tres distinciones que importan, y las tres se ven en la interfaz:

**«Escribe solo».** Hay archivos que no se pueden escribir con confianza y **no se
tocan**: se le da al usuario el bloque para pegar. Es el caso del YAML de DeepSeek
Harness, que hay que fusionar con otras personalizaciones del archivo. Escribir a
ciegas en la configuración de alguien es peor que pedirle que pegue dos líneas.

**«Verificado».** El ✓ marca los clientes cuya ruta y formato están confirmados
contra su documentación oficial o su código fuente (revisados en octubre de 2026).
Quedan dos sin confirmar: la ruta del perfil de usuario de VS Code (la documentación
da la carpeta del usuario, no el archivo) y la de Windsurf, que ahora es Devin
Desktop y lee la de Devin. Se escriben igual, pero **se avisa de ello** antes, para
que un fallo no sea silencioso. Si un cliente no detecta el servidor, revisa su
documentación y pásale la ruta correcta con `--path`.

**«Delega».** Orca, Mono, T3 Code y Omnigent no tienen configuración de MCP propia:
lanzan otros agentes (Claude Code, Codex, pi…) y cada uno carga la suya. Aparecen en
la lista para que se sepa qué hacer con ellos, y cuentan como configurados en cuanto
lo está uno de esos agentes. Devin en la nube tampoco aplica: sus servidores corren
en su entorno y no pueden lanzar un programa de tu equipo.

`~` es tu carpeta personal. En macOS, `~/.config` existe aunque no sea la
convención de Apple: OpenCode, Kilo, Amp y Devin lo usan así a propósito.

**En Windows** las rutas de la tabla salen del perfil del usuario: `~` es
`%USERPROFILE%` y `~/Library/Application Support` es `%APPDATA%`. No dependen del disco
donde esté instalada la app: los instaladores ponen el ejecutable donde se les diga
(D:, una carpeta propia) pero la configuración va siempre al perfil.

La excepción son las apps de la Microsoft Store o de winget (paquetes MSIX), como
Claude Desktop. Windows les redirige a una carpeta privada lo que creen bajo
`%APPDATA%` y `%LOCALAPPDATA%`, y al abrir un archivo les da primero esa copia:

```text
%APPDATA%\Claude\claude_desktop_config.json                 ← donde cree escribir
%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json   ← donde está
```

SaveMe busca el archivo en los sitios donde Windows puede haberlo puesto, para
cualquier cliente con la configuración en AppData: si algún paquete tiene su copia
privada, usa esa; si no, la ruta de siempre, que también vale cuando el archivo aún no
existe (sin copia privada, la app abre la normal). No se busca en todo el disco: una
copia vieja en el AppData normal también existe y no es la que lee la app. La ruta que
sale en Ajustes → clientes de IA es la ya resuelta.

Para saber si un cliente está instalado, además de su carpeta y del PATH, en Windows
se mira la lista de «Aplicaciones instaladas» del registro (la del usuario y las de la
máquina) y los paquetes de la Store. Así se encuentra una app instalada en otro disco,
o que todavía no se ha abierto nunca.

### Un cliente que no está en la lista

En **Ajustes → clientes de IA → cliente personalizado**, o desde la terminal:

```bash
saveme mcp-config --provider custom --path ~/.mi-agente/mcp.json \
  [--servers-key servers] [--entry-type stdio] [--command-array] [--env-key env] --write
```

Describes dónde guarda tu cliente sus servidores y qué forma tiene la entrada, y se
escribe con las mismas garantías que en los conocidos: copia de seguridad, un JSONC
no se reescribe y no se toca nada si ya estaba igual. Un `.toml` se escribe como
TOML; cualquier otro archivo, como JSON. `--remove` lo quita igual.

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

El texto explica el flujo de dos fases, cómo escribir un resumen que se entienda
dentro de seis meses —contexto, por qué, cómo funciona, cómo verificarlo, con
diagramas Mermaid (flujo, secuencia, estados…) cuando ayudan— y la taxonomía de
categorías. Es el mismo texto que sirve el recurso MCP `saveme://guide`; el prompt
`saveme/human-summary` lleva el procedimiento y la misma guía de escritura.

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
| Windows: SaveMe dice «configurado» en Claude Desktop y Claude no ve las tools | Claude es de la Store y lee su copia privada del archivo. Las versiones de SaveMe sin la resolución de paquetes escribían en `%APPDATA%\Claude`; actualiza, vuelve a configurarlo desde Ajustes y reinicia Claude. |

## Fuentes de los formatos

Los formatos y rutas de esta guía están verificados contra la documentación de
cada cliente:

- [OpenCode — Config](https://opencode.ai/docs/config) (precedencia y `~/.config/opencode/opencode.json`)
- [OpenCode — MCP servers](https://opencode.ai/docs/mcp-servers) (`type`, `command` array, `environment`)
- [Claude Code — Connect to tools via MCP](https://code.claude.com/docs/en/mcp) (los tres ámbitos)
- [Codex CLI — MCP servers](https://mintlify.wiki/openai/codex/configuration/mcp-servers) (`[mcp_servers.*]` en `~/.codex/config.toml`)
- [Cursor — MCP](https://cursor.com/help/customization/mcp) (`~/.cursor/mcp.json`)
- [GitHub Copilot CLI — MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) (`~/.copilot/mcp-config.json`)
- [VS Code — MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) (`servers`, `type: "stdio"`, destino «Copilot Global»)
- [Gemini CLI — MCP servers](https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/tools/mcp-server.md)
- [Antigravity — MCP](https://antigravity.google/docs/mcp) (`~/.gemini/config/mcp_config.json`)
- [Qwen Code — MCP](https://raw.githubusercontent.com/QwenLM/qwen-code/main/docs/users/features/mcp.md)
- [Kiro — MCP configuration](https://kiro.dev/docs/mcp/configuration/)
- omp: documentación del propio harness (`mcp-config.md` en can1357/oh-my-pi)
- [pi — MCP](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)
- [Kilo — MCP en la CLI](https://kilo.ai/docs/automate/mcp/using-in-cli)
- [Amp — MCP](https://ampcode.com/docs/markdown/customize/mcp) (`amp.mcpServers`)
- [Z Code — MCP](https://zcode.z.ai/en/docs/mcp-services) (`mcp.servers`)
- [Kimi Code — MCP](https://moonshotai.github.io/kimi-code/en/customization/mcp)
- [Devin CLI — MCP](https://docs.devin.ai/cli/extensibility/mcp/configuration) y [Devin Desktop FAQ](https://docs.devin.ai/desktop/devin-desktop-faq) (Windsurf → Devin Desktop)
- [Hermes Agent — MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)
- [DeepSeek Harness — MCP](https://deepseek-harness.github.io/deepseek-harness/en/guide/mcp-memory) (`cordis.patch.yml`)
- Orca ([skills](https://www.onorca.dev/docs/cli/skills)), Mono ([mcp.rs](https://github.com/hardbeat920/monocode/blob/main/src-tauri/src/mcp.rs)), T3 Code ([proveedores](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-claude.md)) y Omnigent ([tools](https://omnigent.ai/docs/build/tools)): sin configuración de MCP propia
- [Microsoft — Cómo se ejecutan las apps de escritorio empaquetadas](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-behind-the-scenes) (AppData de una app MSIX: copia privada primero, real después)
