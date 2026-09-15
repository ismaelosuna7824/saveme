# SaveMe

Diario técnico de proyecto en markdown, para que dentro de seis meses sepas **qué
se hizo y por qué**. Guardas un resumen humano después de cada feature, fix o
decisión, y lo escribes con el agente que ya estás usando: SaveMe expone un
servidor MCP, y el agente siempre te pregunta dónde guardarlo antes de escribir
nada.

Cada resumen es un archivo `.md` real dentro de una carpeta por proyecto y
categoría. El archivo es la fuente de verdad; la app es una interfaz cómoda para
leerlo, editarlo y buscarlo.

```
~/Documents/SaveMe/
└── saveme-app/
    ├── features/2026-02-14-editor-markdown-con-preview.md
    ├── fixes/2026-02-16-race-en-el-watcher.md
    └── design/2026-02-18-esquema-del-indice.md
```

## Instalar la app

```bash
make dmg            # macOS: genera el .dmg en src-tauri/target/release/bundle/
make msi            # Windows          (o `make nsis` para el .exe)
make deb            # Linux            (o `make appimage`)
```

Arrastra el `.dmg` a Aplicaciones y ábrela. **En el primer arranque la app te
guía**: te explica qué va a hacer, te enseña qué agentes tienes instalados y
configura el servidor MCP en los que elijas. No hay nada que descargar — el
servidor MCP es un binario de 12 MB autocontenido que viaja dentro de la propia
app, sin Go, Node ni dependencias.

El asistente deja el binario en su propia carpeta (`~/.saveme/bin/saveme`) para
que las configuraciones de tus agentes no apunten dentro de la app, que se rompe
si la mueves o la borras. Puedes volver a abrirlo cuando quieras desde `Cmd+K`.

## Desarrollo

```bash
make setup          # dependencias de Go, bun y Rust
make dev            # compila el core, lo pone de sidecar y abre la app
```

Conectar tu agente: **la app lo hace por ti en el primer arranque**. Si prefieres
la línea de comandos, o quieres configurar otro cliente después:

```bash
make install                                      # deja `saveme` en tu PATH
saveme doctor                                     # dice qué falta, si falta algo
saveme mcp-config --list                          # qué clientes ves y cuáles tienen saveme
saveme mcp-config --provider opencode --write      # o codex, cursor, claude-code…
saveme guide >> CLAUDE.md                         # instrucciones para el agente
```

`mcp-config` averigua solo la ruta del binario y la raíz del workspace, fusiona el
bloque en tu configuración sin borrarte los MCP que ya tengas, y deja copia de
seguridad. Después reinicia el cliente.

**Funciona con la app cerrada**: el MCP es el mismo binario de Go con otro
subcomando (`saveme mcp` en vez de `saveme serve`) y habla directo con SQLite y
los archivos, sin depender del daemon. Si la app está abierta, su watcher ve el
archivo y la interfaz se actualiza sola; si está cerrada, lo encuentra al abrir.

A partir de ahí, al terminar un cambio le pides al agente *"guarda un resumen en
SaveMe"* y él propone un destino, te pregunta si te parece bien y escribe.

Detalle por cliente, la regla de la raíz compartida y qué hacer si no funciona:
**[docs/MCP-SETUP.md](docs/MCP-SETUP.md)**.

Cómo funciona el servidor MCP por dentro —el token de un solo uso, la garantía de dos
fases— y cómo replicar el mismo patrón en otro proyecto:
**[docs/MCP-BLUEPRINT.md](docs/MCP-BLUEPRINT.md)**.

## Verificar que funciona

```bash
make test        # Go con -race, Rust, tipos, Live Preview y traducciones
make test-e2e    # 54 comprobaciones contra el binario real, en proceso aparte
```

`make test-e2e` incluye el camino que importa para el MCP: **detiene la app,
escribe un resumen con el agente y comprueba que la app lo encuentra al volver a
arrancar.**

## El editor

Cuatro modos, con `Cmd+E` para ciclar. El elegido se guarda en la configuración, así
que la próxima vez abres donde lo dejaste.

| Modo | Qué hace |
| --- | --- |
| **en vivo** (predeterminado) | Renderiza el markdown mientras escribes, como Obsidian: los encabezados crecen, la negrita se ve negrita, las casillas de tarea se pueden marcar. La sintaxis aparece **solo en la línea donde tienes el cursor**, para que puedas editarla. |
| fuente | Markdown crudo, sin adornos. |
| dividido | Fuente a la izquierda, documento renderizado a la derecha, con el scroll sincronizado por bloque. |
| preview | Solo el documento renderizado, a pantalla completa. |

Las casillas de tarea son interactivas en los dos sitios: al marcarlas se reescriben
los tres caracteres del marcador (`[ ]` ↔ `[x]`) en el markdown, y de ahí sale el
autoguardado. No hay estado paralelo: el archivo manda.

Los **diagramas de Mermaid** se dibujan: un cercado ` ```mermaid ` deja de ser código y pasa
a ser una imagen, en los cuatro modos y también en la vista previa del inbox. Se guardan
como markdown, así que el archivo sigue siendo legible y diffeable. Con el cursor dentro del
cercado se ve el código —para editarlo—, los colores salen del tema activo, y un diagrama
con errores no rompe el resto del documento: se enseña el error y la fuente.

El **modo vim** es opcional y vive en Ajustes. Apagado por defecto, porque enciende un modo
en el que las letras son órdenes y eso no se le impone a nadie. Cuando está encendido, el
editor de notas responde a `i`, `Esc`, `dd`, `ciw`, `v`, `/` y compañía, y la barra de estado
dice en qué modo estás —si no, escribir sin que aparezca nada solo puede parecer una avería—.
Solo afecta al editor de notas; el de resúmenes se sigue rellenando de un tirón.

## El pulso del proyecto

El diario guarda mucho más de lo que una lista enseña. Cada proyecto tiene su **pulso**,
en `/p/<proyecto>/actividad`:

- **Dónde lo dejamos** — lo último que pasó, los archivos por los que se anduvo y las
  propuestas que quedaron esperando decisión, incluidas las vencidas. Es la pantalla que
  contesta la pregunta de quien vuelve a un proyecto después de dos semanas.
- **El mapa de actividad** — un año de trabajo por día, con la intensidad medida contra el
  día más cargado del propio proyecto y no contra un número inventado: en un diario de tres
  entradas al mes, escalar contra un 10 fijo dejaría el mapa entero del color más flojo. Se
  puede mirar a 90 días, 6 meses o un año.

Y las **notas de versión**:

```bash
saveme changelog --project mi-app --since 2026-02-01 --until 2026-02-28
saveme changelog --project mi-app --json          # los datos, para un script
```

Saca el markdown agrupado por categoría en el orden de la taxonomía. En la app es el botón
de la cabecera del proyecto: se elige el rango, se ve **cuántas entradas van a salir antes
de guardar**, y el fichero va a donde digas. Es lo que un `git log` no da: frases humanas
por feature, fix y chore.

Las dos puertas —la CLI y la interfaz— comparten qué entra y en qué orden lo decide el
núcleo; lo único que cambia es el idioma de los títulos, porque un programa de línea de
órdenes no tiene idioma de interfaz al que preguntar. Y `--until` incluye el día entero:
pedir «hasta el 14» y que se quede fuera lo del 14 es el error de fechas clásico.

## Decisiones

| Tema | Decisión | Por qué |
| --- | --- | --- |
| Core | Un binario Go con subcomandos `serve` / `mcp` / `reindex` / `guide` / `doctor` / `mcp-config` | La app y el MCP **son el mismo programa**: no pueden divergir en reglas de negocio. El MCP no depende del daemon, así que funciona con la app cerrada |
| Borrado | Borrar archiva: el archivo va a `.saveme/trash/<sello>/<ruta original>` y la papelera se puede ver, restaurar y vaciar desde Ajustes | El error caro es el borrado accidental, no el disco ocupado. Restaurar **no pisa** un archivo más nuevo: se niega con un 409 y lo dice |
| Diario vivo | El agente puede **actualizar** un resumen, no solo añadir: `propose` acepta `target` y la confirmación reescribe el archivo en su sitio | Un diario que solo sabe añadir se degrada: iterando sobre lo mismo acabas con diez entradas casi iguales. La propuesta guarda el hash del archivo al proponerse, así que si alguien lo tocó por medio no se pisa nada |
| Reversibilidad | Configurar el MCP se puede deshacer: `POST /api/mcp/unconfigure` o `mcp-config --remove`, por cliente | Escribir en el archivo de configuración de otro programa obliga a poder dejarlo como estaba. Se borra solo la entrada `saveme`, con copia de seguridad, y nunca se toca el binario |
| Translucidez | Ajuste de 20% a 100% que deja ver lo que hay detrás de la ventana | Se aplica reescribiendo un solo token de color, así que sigue al tema. **Cuesta la Mac App Store**: en macOS exige una API privada de Apple. Se distribuye por DMG, y está anotado en el código |
| Ventana | macOS en modo `Overlay` con el título oculto: la barra superior de la app **es** la barra de título | Fuera la franja gris del sistema. Los semáforos siguen siendo los nativos —nada de botones propios—, solo que flotan sobre la interfaz; por eso reserva 78px y se arrastra con `data-tauri-drag-region` (con su permiso explícito, que el de por defecto no lo trae) |
| Shell | Tauri v2 sin lógica de dominio | Solo lanza el sidecar, le dice a la interfaz en qué puerto quedó y lo mata al salir |
| Barra de estado | Franja inferior con los atajos **de la pantalla actual** y la raíz del workspace | `?` enumera todos los atajos, pero sin distinguir cuáles valen aquí, y una barra que anuncie `⌘S` en el inbox está mintiendo: ese atajo solo existe con el editor de resúmenes delante. La raíz no se veía en ningún otro sitio de la interfaz, y es justo el dato que hace falta cuando alguien mueve la carpeta |
| Índice | SQLite derivado (`modernc.org/sqlite`, sin CGO) con FTS5 | Se puede borrar: `POST /api/reindex` lo reconstruye desde el disco |
| Verdad | El `.md` en disco; el índice es caché | Editas con vim, un agente escribe con la app cerrada, y al abrir aparece todo |
| Escritura | Atómica (temporal + `rename`) y nunca sobrescribe | Un lector concurrente ve el archivo viejo completo o el nuevo completo |
| Categorías | 9 carpetas fijas por proyecto | Quien escribe nunca decide entre "crear carpeta" o "guardar" |
| Inferencia | Señales léxicas ponderadas, con stems del español | "Implementamos", "arreglamos", "actualizamos" clasifican bien; nunca decide en silencio |
| Editor | CodeMirror 6 con **Live Preview** estilo Obsidian + panel de lectura | Round-trip exacto: el markdown del disco nunca se transforma, solo se ocultan los delimitadores fuera de la línea del cursor |
| Prosa | Sans del sistema en el documento, monoespaciada en el chrome | El documento se lee como en GitHub/Notion; la app mantiene su identidad de terminal |
| Paquetes | bun | Un solo binario, `bun install` en ~2 s, sin postinstall que se atasque |
| Búsqueda | FTS5 con ranking bm25 ponderado por columna, con respaldo a LIKE | El título pesa más que una etiqueta; si la build no trae FTS5, sigue funcionando |
| Temas | Diecisiete paletas completas (`phosphor`, `amber`, `green`, `ice`, `plasma`, `paper`, `solarized`, `gruvbox`, `nord`, `mono`, `plain`, `dracula`, `tokyo-night`, `catppuccin`, `onedark`, `kanagawa`, `ember`), no un interruptor de un efecto | Cada tema declara sus 31 tokens en `html[data-theme]`; el contraste WCAG se comprueba con `verify:themes`, porque diecisiete paletas no se revisan a ojo |
| Pulso | Cada proyecto tiene su pantalla de actividad: briefing, mapa de un año y notas de versión | El diario guarda mucho más de lo que una lista enseña. El briefing contesta «¿dónde lo dejamos?»; el mapa mide la intensidad contra el día más cargado **del propio proyecto** y no contra un número inventado, que en un diario de tres entradas al mes dejaría todo del color más flojo |
| Idioma | Español e inglés con diccionario tipado propio, sin dependencias | El inglés se declara contra la forma del español: una traducción que falta o que pierde un `{placeholder}` rompe `tsc`, no la pantalla. Los errores del core se traducen por **código**, no por texto |

## La garantía de "siempre preguntar"

El requisito duro es que **nunca se escriba un resumen sin que una persona decida
dónde**. Se sostiene con tres capas, de más fuerte a más débil:

1. **Estructural.** `saveme_summary_propose` no toca el disco. El único escritor
   es `saveme_summary_confirm`, y exige un token vivo, de un solo uso, con 15
   minutos de TTL. La garantía de un solo uso la aplica un `UPDATE ... WHERE
   status = 'pending'` en SQLite, así que aguanta carreras entre procesos.
2. **Protocolo.** Si el cliente MCP declara soportar elicitation, SaveMe le pide
   al usuario directamente —con la ruta propuesta y tres alternativas concretas—
   y **su respuesta manda sobre lo que diga el agente**. Funciona tanto con
   clientes nuevos (MRTR / SEP-2322) como con los anteriores, porque el SDK
   traduce entre ambos.
3. **Auditoría.** Si no hay elicitation, el agente declara la decisión tras
   preguntar en el chat. Queda registrado `resolved_via: agent_chat` para poder
   distinguir después "lo aprobó una persona" de "el agente dijo que sí".

Las propuestas pendientes aparecen en el **Inbox** de la app, así que también
puedes aprobarlas o redirigirlas sin volver al chat.

## Estructura

```
backend/           core Go: dominio, store, service, api, mcp, watch
frontend/          React 19 + TanStack Router/Query + shadcn, estética terminal
src-tauri/         shell de escritorio (sidecar + ventana)
docs/ARCHITECTURE.md   contratos congelados: API, tools MCP, frontmatter, esquema SQL
docs/MCP-SETUP.md      configurar el MCP en cada cliente
docs/MCP-BLUEPRINT.md  cómo funciona el MCP por dentro, y cómo replicarlo en otro proyecto
scripts/env.sh     redirige las cachés de build a un directorio temporal
scripts/e2e.sh     verificación end-to-end contra el binario real
scripts/mcp-smoke.py  cliente MCP mínimo por stdio, para probar sin un agente
```

## Datos y configuración

| Dato | Ruta |
| --- | --- |
| Resúmenes | `~/Documents/SaveMe` (configurable) |
| Preferencias | `~/Library/Application Support/SaveMe/config.json` |
| Índice | `<raíz>/.saveme/saveme.db` |
| Papelera | `<raíz>/.saveme/trash/` (borrar archiva, no destruye) |

Variables de entorno: `SAVEME_ROOT` (gana sobre la configuración), `SAVEME_PORT`,
`SAVEME_CONFIG`, y `SAVEME_CORE_VERBOSE=1` para que el shell reenvíe el log del
core con las peticiones HTTP (útil para depurar la interfaz).

## Integración continua

Las suites y la receta de empaquetado viven en dos workflows **reutilizables**
(`tests.yml` e `instalables.yml`). `ci.yml` los llama en cada push a `main` y en cada pull
request; `release.yml` los llama para publicar. Así la lista de suites y la receta de
empaquetado existen una sola vez y no pueden separarse con el tiempo.

- **Pruebas** (Ubuntu): las suites —Go con `-race`, Rust, tipos, Live Preview,
  traducciones, orden CSS, temas, Mermaid, el árbol de notas y el icono—, la coherencia de la
  versión, y la verificación end-to-end contra el binario real.
- **Instalables**: una matriz con macOS, Windows y Linux que empaqueta los instaladores
  nativos y los deja como artefactos descargables. **El de macOS es universal**: un solo
  `.dmg` con Intel y Apple Silicon, que es lo que hace falta para que nadie tenga que elegir.
  Eso obliga a compilar el core **dos veces** —una por arquitectura— y a que Tauri los junte
  con `lipo`; con un sidecar solo, el `.dmg` se construye y la app no arranca en la otra
  mitad de los Mac.

**Tauri solo construye los instalables de la plataforma en la que corre** —un `.dmg` en
macOS, un `.msi` en Windows, un `.deb` en Linux—, así que no hay forma de generarlos los
tres desde un solo runner. De ahí la matriz; cada runner compila además su propio binario de
Go, que es el que va dentro como sidecar.

El trabajo de instalables **depende** del de pruebas: no se empaqueta nada que no haya
pasado antes, porque un instalable roto en la página de descargas es peor que no tener
instalable.

## Publicar una versión

Lo normal, desde la web de GitHub: **Releases → Draft a new release**, eliges un tag nuevo
`v0.2.0` y publicas. GitHub crea el tag, y el tag dispara `release.yml`, que corre las
suites, empaqueta en los tres sistemas y adjunta los instalables a esa Release. Los ficheros
aparecen en la página de la Release unos minutos después de publicarla.

La otra puerta, **Actions → Release → Run workflow**, escribiendo la versión (`0.2.0`). Ahí el
tag todavía no existe, así que lo crea el propio workflow.

**La app se actualiza sola.** Al abrirse pregunta por la última release y, si hay versión nueva,
avisa abajo a la derecha con un botón para descargarla e instalarla sin salir de la app. Las
actualizaciones van firmadas y la firma se verifica antes de instalar, así que nadie que
controle la red puede colar un binario suyo. Si la comprobación falla —sin red, por ejemplo—
la app no dice nada: no hay nada que el usuario pueda hacer.

El tag manda: su versión se escribe en `tauri.conf.json`, `Cargo.toml` y `package.json`, y se
inyecta en el binario de Go. **Nada se publica hasta que los tres sistemas han empaquetado**,
así que un fallo en Windows no deja una Release a medias con solo el `.dmg`.

Detalle paso a paso, y qué hacer cuando algo falla: [`docs/RELEASING.md`](docs/RELEASING.md).

## Estado

Verificado:

- `go test -race ./...` — dominio, store, servicio y MCP (15 pruebas de MCP
  ejercitan un cliente real contra un servidor real, incluido el ida y vuelta de
  pregunta al usuario).
- `bash scripts/e2e.sh` — 54 comprobaciones sobre el binario: dos fases, visión
  entre procesos, confirmación por HTTP, conflicto de edición, SSE, el pulso del
  proyecto, y el camino "el agente escribe con la app apagada".
- `bun run --cwd frontend typecheck` y `bun run --cwd frontend build`.
- `bun run --cwd frontend verify:live-preview` — 32 comprobaciones sobre la lógica del
  Live Preview sin navegador: qué se oculta, qué se estiliza, dónde van los widgets y
  cuándo un cercado se convierte en diagrama.
- `bun run --cwd frontend verify:notes` — 24 comprobaciones sobre el árbol de notas y las
  reglas del arrastre: composición, carpetas vacías, y cuándo mover algo es ilegal.
- `bun run --cwd frontend verify:mermaid` — que Mermaid siga cargándose **en diferido** (un `import`
  estático lo metería en el bundle inicial sin fallar nada), que los tokens del tema que pide
  existan, que las clases del componente estén en el CSS y que el markdown enrute los diagramas.
- `bun run --cwd frontend verify:themes` — **17 temas × 31 tokens**, más la conversión de
  opacidad de la ventana. Comprueba que cada tema ofrecido tenga sus
  colores, que no haya temas huérfanos, que ninguno herede a medias la paleta de otro y **mide el contraste
  WCAG 2.1** de cada uno, incluido el del código resaltado sobre su fondo.
- `bun run --cwd frontend verify:css` — vigila que una clase propia del CSS no anule
  (`position`, `display`) una utilidad de Tailwind del mismo elemento. Es el fallo que dejaba
  la paleta de comandos anclada al fondo y Ajustes fuera de pantalla: `styles.css` va después
  de Tailwind y, a igual especificidad, gana la clase propia.
- `bun run --cwd frontend verify:i18n` — 26 comprobaciones sobre las traducciones:
  paridad de los dos diccionarios (**754 claves cada uno**), textos vacíos, `{placeholders}`
  perdidos, plurales incompletos, y el runtime de verdad (que el proveedor devuelva el
  idioma pedido, que interpole y que los errores del core se traduzcan por código).
- `bun run --cwd frontend verify:changelog` — 24 comprobaciones sobre las notas de versión,
  que son un fichero que sale de la app y se lee fuera de ella: que no se pierda ninguna
  entrada, que la línea de resumen quede indentada como continuación de su punto —sin eso el
  markdown la lee como un párrafo suelto— y que el nombre del fichero se pueda guardar.
- **La app corriendo de verdad**: el shell de Tauri lanza el sidecar, le inyecta
  el puerto, y el log del core muestra la interfaz montando y pidiendo sus datos
  (`/api/config`, `/api/categories`, `/api/projects`, `/api/proposals`,
  `/api/stats`, todas 200) más el stream SSE abierto de forma persistente.

Pendiente: la revisión **estética** a ojo. El comportamiento en runtime está
comprobado; que el resultado te guste como se ve, no.

## Siguiente paso

```bash
make dev
```

Si es tu primera vez, crea un proyecto con `Cmd+K` y pídele a tu agente un
resumen de lo último que hiciste.
