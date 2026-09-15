# SaveMe — Arquitectura y contratos congelados

> Este documento es la **fuente de verdad** de las interfaces. Backend Go, servidor MCP y
> frontend React se construyen contra este contrato. Cualquier cambio aquí obliga a tocar los
> tres lados de forma coordinada.

## 1. Qué es SaveMe

Un diario técnico de proyecto. El problema: después de implementar un feature, un fix o un
chore, nadie recuerda qué se hizo ni por qué. SaveMe captura un **resumen humano** (markdown,
legible por personas, no un changelog generado) en el momento en que ocurre, organizado en
disco por proyecto y categoría.

Tres piezas:

| Pieza | Rol |
| --- | --- |
| **Core Go** (`backend/`) | Dueño único de SQLite, del filesystem y de la lógica de dominio. Expone HTTP API y MCP. |
| **Shell Tauri v2** (`src-tauri/`) | Solo abre la ventana y lanza el core como sidecar. Cero lógica de dominio. |
| **UI React** (`frontend/`) | TanStack Router + Query, shadcn, estética terminal, editor markdown. Habla HTTP con el core. |

Principio rector: **el archivo `.md` en disco es la fuente de verdad**. SQLite es un índice
derivado y reconstruible en cualquier momento (`POST /api/reindex`). Si el índice y el disco
discrepan, gana el disco.

## 2. Layout en disco

Raíz configurable (`root_dir`). Por defecto `~/Documents/SaveMe`. Para desarrollo se
sobreescribe con la variable de entorno `SAVEME_ROOT`.

```
<root_dir>/
├── .saveme/
│   ├── saveme.db                 # índice SQLite (reconstruible, borrar es seguro)
│   └── root.json                 # marcador de raíz + versión de esquema
├── saveme/                       # un directorio por proyecto (slug)
│   ├── features/
│   │   ├── 2026-02-14-editor-markdown-con-preview.md
│   │   └── 2026-02-15-busqueda-full-text.md
│   ├── fixes/
│   │   └── 2026-02-16-race-en-watcher.md
│   ├── chores/
│   ├── refactors/
│   ├── docs/
│   ├── infra/
│   ├── design/
│   ├── research/
│   └── incidents/
└── otro-proyecto/
    └── features/
        └── 2026-02-14-primera-version.md
```

Reglas:

- `slug` de proyecto: minúsculas, `[a-z0-9-]`, sin acentos, colapsa separadores repetidos.
  `SaveMe App` → `saveme-app`. El **nombre visible** se conserva en la base de datos.
- Nombre de archivo: `YYYY-MM-DD-<slug-titulo>.md`. Ordena cronológicamente de forma natural.
  Colisión → sufijo `-2`, `-3`, …
- Todo directorio de proyecto contiene **las 9 categorías**, creadas al registrar el proyecto,
  incluso si están vacías. Así el agente nunca elige entre "crear carpeta" o "escribir".
- Escritura **atómica**: archivo temporal en el mismo directorio + `rename`. Nunca se observa
  un archivo a medias.
- Se permiten `.md` sueltos en la raíz del proyecto o en subcarpetas propias del usuario. El
  reconciliador los indexa con la categoría inferida del directorio, o `uncategorized` si no
  coincide con ninguna.

## 3. Taxonomía de categorías

Definidas en Go (`internal/domain/category.go`), expuestas por `GET /api/categories`. La clave
es estable; la carpeta es la traducción a disco; la etiqueta es para la UI.

| key | carpeta | etiqueta | cuándo |
| --- | --- | --- | --- |
| `feature` | `features` | Feature | funcionalidad nueva visible para el usuario |
| `fix` | `fixes` | Fix | se corrigió un comportamiento incorrecto |
| `chore` | `chores` | Chore | dependencias, tooling, limpieza, versiones |
| `refactor` | `refactors` | Refactor | reestructura sin cambiar comportamiento |
| `docs` | `docs` | Docs | documentación, guías, comentarios |
| `infra` | `infra` | Infra | CI/CD, build, deploy, observabilidad |
| `design` | `design` | Design | decisión de arquitectura o diseño (ADR ligero) |
| `research` | `research` | Research | spike, exploración, comparación de opciones |
| `incident` | `incidents` | Incident | post-mortem de algo que se rompió |

Inferencia automática (`saveme_summary_propose` sin `category`): por palabras clave del título y
del cuerpo, ordenadas por especificidad. La inferencia **nunca es silenciosa**: siempre viaja en
la propuesta como `inference: {category, reason, confidence}` y siempre se le presentan al
usuario alternativas.

## 4. Frontmatter

Todo archivo gestionado por SaveMe empieza con frontmatter YAML:

```yaml
---
id: sm_01jq8x2k3m4n5p6q7r8s9t0v1w
title: Editor markdown con preview sincronizado
category: feature
project: saveme
created_at: 2026-02-14T10:33:12Z
updated_at: 2026-02-14T12:01:44Z
author: agent            # agent | human
agent: claude-code       # opcional, nombre del agente que lo generó
status: confirmed        # draft | confirmed
summary: Preview en vivo mientras editas, sin perder fidelidad del markdown.
tags: [editor, markdown, codemirror]
files_touched:
  - frontend/src/features/editor/Editor.tsx
commit: null
related: []
---
```

- `id` es un ULID con prefijo `sm_`: ordenable por tiempo, 128 bits de entropía, sin dependencias.
- El **cuerpo** es markdown libre. SaveMe nunca lo reformatea.
- Un archivo sin frontmatter válido se indexa igual (`status: unmanaged`) y se muestra en la UI,
  pero SaveMe no lo sobrescribe: la escritura siempre crea un archivo nuevo.
- `content_hash` = SHA-256 del archivo completo. Se usa para concurrencia optimista en `PUT`.

## 5. Esquema SQLite

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE projects (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE summaries (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL REFERENCES projects(slug) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary_line TEXT NOT NULL DEFAULT '',
  rel_path TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  author TEXT NOT NULL,
  agent TEXT,
  commit_sha TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  files_json TEXT NOT NULL DEFAULT '[]',
  related_json TEXT NOT NULL DEFAULT '[]',
  word_count INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  mtime_ns INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_summaries_project ON summaries(project_slug, category);
CREATE INDEX idx_summaries_updated ON summaries(updated_at DESC);

CREATE TABLE summary_tags (
  summary_id TEXT NOT NULL REFERENCES summaries(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (summary_id, tag)
);
CREATE INDEX idx_summary_tags_tag ON summary_tags(tag);

-- Búsqueda. Si la build de SQLite no trae FTS5, el store degrada a LIKE
-- (se detecta en runtime, no en compile time).
CREATE VIRTUAL TABLE summaries_fts USING fts5(
  id UNINDEXED, title, summary_line, body, tags, tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE proposals (
  token TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  body TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  inference_reason TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,              -- pending | confirmed | cancelled | expired
  decision TEXT,                     -- accepted | modified | NULL
  resolved_via TEXT,                 -- elicitation | agent_chat | ui | NULL
  resolved_at TEXT,
  override_rel_path TEXT,
  summary_id TEXT,
  agent TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  files_json TEXT NOT NULL DEFAULT '[]',
  commit_sha TEXT,
  target_id TEXT NOT NULL DEFAULT '', -- si actualiza un resumen, cuál (migración 002)
  base_hash TEXT NOT NULL DEFAULT ''  -- su hash al proponer, para no pisar cambios
);

Las migraciones son numeradas y se aplican solas al abrir el workspace
(`internal/store/migrations/`). Se prueban **sobre una base que ya existe**, no solo
creando una nueva: una migración que funciona en vacío y rompe en una base con datos es
justo el fallo que nadie ve hasta que ya está en la máquina de alguien.

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE file_state (
  rel_path TEXT PRIMARY KEY,
  mtime_ns INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  indexed_at TEXT NOT NULL
);
```

Migraciones: `internal/store/migrations/00X_*.sql` embebidas con `embed.FS`, aplicadas en orden
según `meta.schema_version`, cada una en su transacción.

## 6. HTTP API

Base: `http://127.0.0.1:<port>/api`. JSON en todo salvo donde se indique. Errores:
`{"error": {"code": "...", "message": "..."}}` con código HTTP adecuado.
El daemon escribe `<root_dir>/.saveme/daemon.json` con `{port, pid, started_at, version}` para
que los clientes (MCP, UI, CLI) lo encuentren.

| Método | Ruta | Cuerpo | Respuesta |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ok, version, uptime_ms, root_dir, db_path, port}` |
| GET | `/config` | — | `Config` |
| PUT | `/config` | `{root_dir?, theme?, editor?, language?}` | `Config` (400 `invalid_language` si `language` no es `"es"`, `"en"` ni `""`) |
| GET | `/categories` | — | `[Category]` |
| GET | `/stats` | — | `{projects, summaries, by_category{}, pending_proposals}` |
| GET | `/projects` | — | `[Project]` |
| POST | `/projects` | `{name, slug?}` | `Project` (201, 409 si existe) |
| GET | `/projects/{slug}` | — | `Project` (misma forma que en el listado, con `counts` y `total`) |
| GET | `/summaries` | query: `project,category,q,tag,status,limit,offset,sort` (`sort` ∈ `recent`\|`created`\|`oldest`\|`title`; vacío = relevancia al buscar, fecha al listar) | `{items:[SummaryMeta], total, limit, offset}` |
| GET | `/summaries/{id}` | — | `{meta: SummaryMeta, content: string}` |
| PUT | `/summaries/{id}` | `{content, base_hash?}` | `{meta}` — 409 `hash_mismatch` si `base_hash` no coincide |
| DELETE | `/summaries/{id}` | query: `hard=true\|false` | `{ok, archived_path?}` |
| GET | `/summaries/{id}/raw` | — | `text/markdown` |
| GET | `/proposals` | query: `status=pending` | `[Proposal]` |
| GET | `/proposals/{token}` | — | `Proposal` |
| POST | `/proposals/{token}/confirm` | `{decision, override?}` | `{summary, meta}` |
| POST | `/proposals/{token}/cancel` | `{reason?}` | `{ok}` |
| GET | `/notes/tree` | — | `{items: [{rel_path, name, is_dir, size, modified_at}]}` — plano, sin `notes/` en las rutas |
| GET | `/notes/file` | query: `path` | `{path, content}` |
| PUT | `/notes/file` | `{path, content}` | `{note}` — guarda y reindexa |
| POST | `/notes/create` | `{path, kind?, title?}` | `{note}` o `{ok, is_dir}` — `kind: "dir"` crea carpeta |
| POST | `/notes/move` | `{from, to}` | `{ok, moved}` — mueve una nota o una carpeta **con su contenido**. 400 `into_itself`, 409 `already_exists` |
| DELETE | `/notes/file` | query: `path` | `{ok, archived_path}` — archiva a la papelera |
| GET | `/notes/search` | query: `q, limit` | `{items: [NoteMeta]}` |
| GET | `/trash` | — | `{items: [{trash_rel, rel_path, name, deleted_at, size}]}` — lo borrado, reciente primero |
| POST | `/trash/restore` | `{trash_rel}` | `{ok, rel_path}` — devuelve el archivo a su sitio y lo reindexa. 409 `already_exists` si el destino ya está ocupado |
| DELETE | `/trash` | — | `{ok, removed}` — **borra de verdad**, sin vuelta atrás |
| POST | `/reindex` | — | `{indexed, added, updated, removed, duration_ms}` |
| GET | `/mcp/providers` | — | `{providers: [ProviderReport], binary: {installed_path, self_path, on_path}}` — detecta qué agentes hay en la máquina |
| POST | `/mcp/install` | — | `{path, on_path, message}` — copia el binario a su ubicación estable |
| POST | `/mcp/configure` | `{providers: [key]}` | `{binary_path, results: [{key, action, path, message, backup, command}]}` |
| POST | `/mcp/unconfigure` | `{providers: [key]}` | `{results: [...]}` — quita la entrada de SaveMe de cada cliente. **No toca el binario** |
| GET | `/mcp/snippet` | query: `provider` | `{provider, path, body, language, writable, verified, warnings, binary, pending_install, env_fixed}` |
| GET | `/events` | — | `text/event-stream` (SSE) |

Los errores salen siempre con el mismo sobre `{error: {code, message}}`, y el mapeo a
códigos HTTP vive en un solo sitio (`writeServiceError`). Dos que importan para la
interfaz: **`hash_mismatch`** (409) cuando el archivo cambió en disco desde que se cargó, y
**`already_exists`** (409) cuando una operación no puede escribir porque el destino está
ocupado —restaurar de la papelera, por ejemplo—. Ninguno de los dos es un 500: no son
fallos del servidor, son conflictos con el estado del disco que el cliente puede resolver.
| GET | `/agents/guide` | — | `text/markdown` con instrucciones para pegar en `CLAUDE.md` |

Tipos:

```ts
type Category = { key: string; folder: string; label: string; description: string }
type Project = { slug: string; name: string; path: string; created_at: string; updated_at: string;
                 counts: Record<string, number>; total: number; last_activity: string | null }
type SummaryMeta = { id, project_slug, category, title, summary_line, rel_path, abs_path,
                     status, author, agent, commit_sha, tags: string[], files_touched: string[],
                     related: string[], word_count, size_bytes, created_at, updated_at, content_hash }
type Proposal = { token, project_slug, category, title, rel_path, abs_path, filename,
                  created_at, expires_at, status,
                  inference: {category, reason, confidence, evidence: string[]},
                  alternatives: {category, folder, label, rel_path}[],
                  preview, body_bytes, agent?, tags: string[], files_touched: string[],
                  decision?, resolved_via?, resolved_at?, summary_id? }
```

SSE emite `event: <type>` con `data: <json>`; tipos: `summary.created`, `summary.updated`,
`summary.deleted`, `proposal.created`, `proposal.resolved`, `project.created`, `index.rebuilt`,
`hello` (al conectar). El cliente reconecta solo vía `Last-Event-ID`.

## 7. Servidor MCP

### Subcomandos del binario

| Subcomando | Para qué |
| --- | --- |
| `serve` | El daemon: API HTTP + SSE + watcher. Lo lanza la app. |
| `mcp` | Servidor MCP por stdio (o `--http` para Streamable HTTP). Lo lanza el agente. |
| `reindex` | Reconstruye el índice desde el disco. |
| `guide` | Imprime las instrucciones para agentes, para pegar en su `CLAUDE.md`. |
| `doctor` | Diagnostica la instalación: PATH, raíz, daemon y estado de cada cliente MCP. |
| `mcp-config` | Genera o aplica la configuración del MCP para cada cliente. |

La consecuencia de diseño que importa: **`serve` y `mcp` hablan los dos directo con
SQLite y con los archivos, así que el MCP no depende del daemon.** Un agente puede
registrar resúmenes con la app cerrada; al abrir, el reconciliador compara el disco
con el índice y los encuentra. La única condición es que ambos resuelvan la misma
raíz de workspace, y `doctor` avisa cuando no es así.

### Arranque: por qué el orden importa

El core anuncia `SAVEME_READY` **en cuanto el servidor va a atender**, antes de
reconciliar el índice. Antes lo hacía al revés, y eso rompía el arranque en
workspaces grandes: la reconciliación inicial lee y hashea todos los markdown, así
que tarda segundos (8 s con 3.000 archivos, y crece linealmente). El shell espera
la línea con un plazo; al agotarse, adivinaba el puerto y la ventana se quedaba en
la pantalla de arranque apuntando a donde no había nada. El síntoma era
intermitente y dependía del tamaño del workspace y de la caché de disco.

Ahora la secuencia es: escuchar → anunciar → servir → reconciliar y vigilar en
segundo plano. El arranque pasa de segundos a milisegundos, y la lista se llena
cuando termina la reconciliación porque el evento `index.rebuilt` invalida las
consultas.

El shell, por su parte, ya no se conforma con que el puerto esté abierto: pide
`/api/health` y comprueba que la respuesta sea la del core. Antes bastaba una
conexión TCP, así que cualquier otro programa en el 7411 pasaba por el core.

### Ciclo de vida del core

El core **no se coordina con otras instancias**: cada app lanza y posee el suyo. Si
el puerto preferido está ocupado, el core prueba el siguiente y lo anuncia por
stdout, así que dos ventanas abiertas a la vez conviven sin pisarse.

La vida del core está atada a la de su app por dos mecanismos, y hacen falta los
dos:

1. **Cierre ordenado.** Al salir, el shell mata a su hijo y espera.
2. **Cierre por desaparición del padre.** El shell pasa `--parent-stdin` y deja la
   entrada estándar del core en una tubería abierta. Si la app muere de golpe —un
   crash, un `kill -9`, un cierre forzado— su manejador de salida nunca corre, pero
   el sistema operativo cierra la tubería igualmente: el core lee EOF y se apaga.
   Sin esto quedaban daemons huérfanos ocupando un puerto y una conexión a SQLite.

Se descartó sondear el PID del padre porque las APIs para eso son distintas en cada
plataforma, y se descartó reutilizar un core ya escuchando porque creaba un fallo
silencioso: la instancia que lo había lanzado se lo llevaba al cerrarse y la otra
se quedaba sin core para siempre.

Un solo binario Go, dos transportes:

- `saveme mcp` → **stdio**, para que el cliente (Claude Code, Codex, Cursor) lo lance.
- `saveme mcp --http :7412` → **Streamable HTTP**, para agentes remotos o compartidos.

El MCP **escribe directo al store** (SQLite + archivos). No necesita que la app esté abierta.
Si el daemon está corriendo, además publica el evento SSE; si no, no pasa nada: al abrir la app
el reconciliador detecta los archivos nuevos por `mtime` y los indexa.

### Tools

| Tool | Entrada | Salida | Escribe |
| --- | --- | --- | --- |
| `saveme_project_list` | — | `{projects:[Project]}` | no |
| `saveme_project_create` | `{name, slug?}` | `{project}` | sí (crea carpetas) |
| `saveme_summary_propose` | `{project, title, body, category?, tags?, files_touched?, summary?, agent?, commit?, **target?**}` | `{token, proposal, expires_at, alternatives, next_step}` | **no** |
| `saveme_summary_confirm` | `{token, decision, override?, elicit?}` | `{summary, meta, written_path}` | **sí** |
| `saveme_summary_cancel` | `{token, reason?}` | `{ok}` | no |
| `saveme_summary_search` | `{query, project?, category?, limit?}` | `{items:[SummaryMeta], total}` | no |
| `saveme_summary_list` | `{project?, category?, limit?}` | `{items:[SummaryMeta]}` | no |
| `saveme_summary_read` | `{id}` | `{meta, content}` | no |
| `saveme_pending` | `{project?}` | `{proposals:[Proposal]}` | no |

Además: prompt MCP `saveme/human-summary` con las instrucciones de redacción, y resource
`saveme://guide`.

### La garantía de "siempre preguntar"

El requisito es duro: **nunca se escribe un resumen sin que el usuario haya decidido dónde**.
Se implementa en tres capas, de más fuerte a más débil:

### Actualizar un resumen que ya existe

`propose` acepta `target` (el id o la ruta relativa de un resumen existente). Con él, la
propuesta apunta a **ese** archivo y la confirmación lo **reescribe en su sitio**: conserva
su id y su `created_at`, no lo duplica y no lo mueve. Sin `target` se crea uno nuevo, que
sigue siendo el caso normal.

Existe porque un diario que solo sabe añadir se degrada: iterando sobre la misma
funcionalidad acabas con diez entradas casi iguales y ninguna que cuente la historia
completa.

Lo que hace segura la reescritura es que la propuesta guarda el **hash del archivo en el
momento de proponerse** (`base_hash`) y `confirm` se lo pasa a `Save`. Si alguien lo tocó
por medio, no se escribe nada y se le pide al agente que relea. Es más fuerte que el
respaldo que ya tenía `Save` —comparar contra el hash del índice—, porque ese respaldo
deja de ver nada en cuanto un reindexado pone el índice al día, y el watcher lo hace solo.

1. **Estructural.** `saveme_summary_propose` no toca el disco. El único escritor es
   `saveme_summary_confirm`, y exige un `token` vivo, de un solo uso, con TTL de 15 minutos y
   ligado al `payload_hash` del contenido propuesto. Sin `propose` no hay `confirm`.
2. **Pregunta al usuario por el protocolo.** Si el cliente declara la capability
   `elicitation`, `confirm` le muestra al usuario la ruta propuesta y las alternativas, y **la
   respuesta del usuario es la autoridad**: si rechaza, no se escribe nada aunque el agente
   insista. Se registra `resolved_via: "elicitation"`.

   > **Cómo se implementa, y por qué así.** No se llama a `ServerSession.Elicit` desde el
   > handler. En el protocolo `2026-07-28` y posteriores una petición de servidor a cliente a
   > mitad de una llamada está prohibida: el SDK responde
   > `"elicitation/create" cannot be sent while serving a request on protocol version
   > 2026-07-28: return an InputRequests map instead (SEP-2322)`. El mecanismo correcto es
   > **MRTR** (multi round-trip): el handler devuelve `CallToolResult.InputRequests` y el
   > cliente re-invoca la tool con `InputResponses`.
   >
   > Esto además simplifica el código: para clientes de protocolos anteriores, el propio SDK
   > traduce los `InputRequests` a una llamada a `Elicit` y re-invoca el handler. **Una sola
   > implementación cubre las dos generaciones de clientes.** El único cuidado es devolver
   > `InputRequests` *sin* contenido: el SDK rechaza un resultado que traiga las dos cosas, así
   > que el handler devuelve un `Out` que es un puntero (`*confirmOut`) para poder devolver
   > `nil` en la ronda de la pregunta.
3. **Protocolo del agente.** Si no hay elicitation, `confirm` exige `decision`
   (`accepted` | `modified`) y la descripción de la tool ordena explícitamente al agente
   preguntar en el chat antes de llamarla. Se registra `resolved_via: "agent_chat"`.

Toda propuesta confirmada o cancelada queda auditada en la tabla `proposals`, y la UI muestra
las pendientes en un **Inbox** donde el humano también puede aprobarlas o redirigirlas sin
tocar el chat del agente.

## 7.1 Onboarding y auto-configuración

La primera vez que se abre la app, `config.onboarded` es `false` y el shell muestra
un asistente. Existe porque el valor del producto depende de que el agente esté
conectado, y pedirle a alguien que edite a mano siete archivos de configuración es
la forma más fiable de que no lo haga.

Orden del asistente:

1. **Explicar.** El servidor MCP es el mismo binario que la app; funciona con la
   app cerrada; **no hay nada que descargar** porque es Go puro sin CGO.
2. **Instalar.** Se copia el binario en ejecución a `~/.saveme/bin/` (en Windows,
   `%USERPROFILE%\.saveme\bin\`). Es una carpeta propia de SaveMe a propósito:
   apuntar las configuraciones dentro del `.app` se rompe en cuanto el usuario
   mueve o borra la aplicación, y falla en silencio.
3. **Elegir clientes.** `GET /api/mcp/providers` detecta qué agentes hay en la
   máquina (por sus carpetas de configuración y por sus ejecutables en el PATH) y
   cuáles ya tienen a SaveMe. Se preseleccionan los que están instalados y sin
   configurar.
4. **Aplicar.** `POST /api/mcp/configure` instala el binario y escribe cada
   cliente. Los formatos cuyo conocimiento no está confirmado contra su
   documentación **no se escriben**: se le da al usuario el bloque para pegar.

Regla que resuelve el error más caro: el bloque que se genera fija las variables de
entorno que el daemon tenga en su propio entorno. Si la app corre con `SAVEME_ROOT`
(por ejemplo en desarrollo), el MCP recibe la misma raíz y los dos ven el mismo
workspace. Si la app usa la raíz por defecto, no se fija ninguna variable: ambos la
resuelven solos y no hay nada que pueda desincronizarse.

## 7.2 Notas

Una sección de la interfaz, **por encima de Proyectos**, para que una persona guarde
notas sueltas con el mismo editor y el mismo markdown que los resúmenes. **No pasan por
el MCP**: son de la interfaz, y el agente no las ve ni las escribe.

- Viven en **`<raíz>/notes/`**, como archivos `.md` normales, y SQLite guarda el índice
  para buscar y listar. Es la misma regla que en los resúmenes: **en disco manda el
  markdown, la base es caché reconstruible**. La alternativa —guardarlas solo como filas—
  se descartó: las notas solo existirían dentro de `.saveme/saveme.db`, no se verían en el
  Finder, no se podrían sincronizar ni meter en git, y una base corrupta se las llevaría
  todas.
- La carpeta es **reservada**: el indexado de resúmenes la salta explícitamente
  (`workspace.Walk`). Sin eso, cada nota aparecería como un proyecto con categoría
  `uncategorized`, porque hoy cualquier carpeta de primer nivel se trata como un proyecto.
- El árbol **no tiene límite de profundidad**: una carpeta puede tener N archivos y N
  subcarpetas. Es distinto del layout de resúmenes —`<proyecto>/<categoría>/<archivo>`,
  fijo en dos niveles— porque las notas las organiza la persona como quiere.
- Las rutas que llegan del cliente son **relativas a la carpeta de notas**, no a la raíz.
  La validación delega en `SafeRel` **después** de normalizar, y ese orden importa:
  `notes/../fuera.md` se limpia a `fuera.md` —sin ningún `..` ya— y `SafeRel` lo aceptaría,
  dejando la nota fuera de su carpeta. Mirar el prefijo antes de limpiar no habría servido.
- Mover una carpeta **se lleva su contenido** (un `rename` del sistema, atómico) y se
  niega a moverse dentro de sí misma o a pisar el destino. Borrar archiva, como los
  resúmenes: va a la papelera y se puede recuperar.
- El **árbol de la barra lateral** se compone a partir de la lista plana del API. Las
  carpetas vienen del servidor y no se deducen de las rutas de los archivos, así que una
  carpeta **vacía se ve**: es donde vas a soltar cosas. Una ruta cuyo padre no está en la
  lista se cuelga de la raíz en vez de desaparecer; perder una nota por un dato raro es
  peor que mostrarla en el sitio equivocado.
- **Arrastrar y soltar** mueve notas y carpetas enteras. Lo que decide si un arrastre es
  legal vive en `features/notes/tree.ts`, aparte de los componentes, porque ahí están los
  errores que no se ven: meter una carpeta dentro de sí misma, soltar sobre un nombre
  ocupado, o soltar donde ya estaba. La comparación de descendencia usa el separador
  pegado —`a/` y no `a`— porque si no mover `a` dentro de `ab` se rechazaría, y `ab` no
  tiene nada que ver con `a`.
- **Una ruta padre tiene que pintar `<Outlet />` o su hija no aparece nunca.** Es la
  trampa que dejó el editor de notas sin abrirse: `/notes/una-nota.md` coincidía con su
  ruta, montaba el componente… y en pantalla seguía viéndose el marcador de posición del
  padre. El árbol de rutas estaba bien; lo que faltaba era el hueco donde pintar. Por eso
  `notes.tsx` es solo un marco con `<Outlet />` y el marcador vive en `notes.index.tsx`,
  que es la ruta de `/notes` a secas.
- El **editor de notas** reutiliza el motor del de resúmenes —CodeMirror con Live Preview,
  el panel sincronizado, los cuatro modos, el autoguardado— pero **sin nada de
  frontmatter**: una nota es markdown libre, sin id, sin categoría y sin hash de conflicto.
  Por eso no reutiliza `useEditorDocument`, solo las piezas de edición.

## 8. Configuración y rutas de datos

| Dato | Ruta |
| --- | --- |
| Preferencias | `~/Library/Application Support/SaveMe/config.json` (macOS) vía `os.UserConfigDir()` |
| Raíz de resúmenes | `config.root_dir`, default `~/Documents/SaveMe`, override `SAVEME_ROOT` |
| Índice | `<root_dir>/.saveme/saveme.db` |
| Daemon | `<root_dir>/.saveme/daemon.json` |

`config.json`: `{version, root_dir, port, theme, editor: {font_size, wrap, preview_mode, autosave_ms}, language, onboarded}`.

### Mover el workspace no pierde nada

**El disco manda, y el índice guarda rutas relativas.** La absoluta se deriva al leer
(`store.absPath`), así que mover o renombrar la carpeta del workspace **no invalida ni una
fila**: apuntar la configuración al sitio nuevo es todo lo que hace falta.

Lo que sí podía pasar es peor que perder datos: **no enterarse**. `EnsureRoot` crea la raíz
sin preguntar, así que con la carpeta movida la app arrancaba, creaba un workspace vacío y
lo enseñaba como si el usuario no tuviera nada. Silencioso y con pinta de normal.

Ahora el arranque mira si la raíz existía **antes** de crearla y lo publica en
`GET /config`:

- `root_state: "created"` — la raíz no estaba y se ha creado vacía. La interfaz enseña un
  aviso explicando que los datos siguen donde estaban.
- `root_suggestions` — carpetas recientes que **sí** son un workspace de SaveMe (tienen el
  marcador `.saveme/root.json`), para ofrecerlas con un clic.

La lista de recientes vive en `config.json`, que está **fuera** del workspace: sobrevive
justo al movimiento que tiene que sobrevivir. Aun así no basta —nadie puede adivinar a
dónde se movió una carpeta—, así que la interfaz también deja **escribir la ruta** a mano.
Ese es el camino que resuelve el caso de verdad; las sugerencias son el atajo para volver a
un workspace anterior.
`language` vacío significa "el del sistema"; el resto de valores no se aceptan.

## 9. Estética terminal

- El tema por defecto (`phosphor`) es fondo casi negro (`#0b0e0f`) con texto ámbar/verde
  fósforo apagado y un solo acento. Hay **siete temas** más abajo.
- Monospace en el *chrome* de la app (JetBrains Mono, con fallback a `ui-monospace`).
- Nav tipo prompt de shell (`❯ proyecto/features`), breadcrumbs con `/`.
- Bordes por caracteres y `box-shadow` de scanline muy sutil; **sin** animaciones de gradiente.
- `Cmd+K` abre una command palette (shadcn `Command`); `Cmd+S` guarda; `Cmd+E` cicla los
  cuatro modos del editor: `live` (Live Preview estilo Obsidian, predeterminado), `source`,
  `split` y `preview`.
- La **prosa del documento** usa una sans del sistema (`--font-sans`); el chrome de la app
  se queda en monoespaciada (`--font-mono`). Es lo mismo que hace GitHub: el editor se ve a
  terminal, el documento se lee como un documento.
- El **Live Preview** (`frontend/src/features/editor/livePreview/`) no transforma el
  documento: oculta delimitadores con `Decoration.replace` y pone widgets encima, y solo
  fuera de la línea del cursor. Se monta por `Compartment`, así que pasar a `source` no
  recrea el editor ni pierde el cursor. Su lógica se verifica sin navegador con
  `bun run --cwd frontend verify:live-preview`.
- Se respeta `prefers-reduced-motion`.
- **El CSS propio va después de Tailwind, y eso hay que tenerlo presente.** `styles.css`
  empieza con `@import 'tailwindcss'`, así que una clase propia y una utilidad con la misma
  especificidad (una clase cada una) las gana la propia, esté donde esté el elemento. Por eso
  las clases de *piel* —`.term-panel` y compañía— **no declaran `position` ni `display`**:
  deciden el aspecto, no la colocación. Cuando `.term-panel` declaraba `position: relative`,
  el `fixed` de `DialogContent` quedaba anulado y, con `left: 50%` / `top: 50%` encima, el
  diálogo se iba al final del documento en vez de centrarse: así se veían la paleta de
  comandos (anclada al fondo, cortada) y Ajustes (fuera de pantalla, sin poder tocar nada).
  Quien necesite ser bloque contenedor de hijos absolutos pide `relative`, o usa `.term-frame`,
  que sí lo necesita para sus esquinas. Lo vigila `bun run --cwd frontend verify:css`.
- Los diálogos se centran con `fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2`. La
  lista de la paleta limita su alto con `min(22rem, 100vh - 11rem)`: en una ventana baja, un
  tope fijo hace que el diálogo sea más alto que la ventana y se corte por los dos lados.
- La capa de scanlines va en `z-40`, **por debajo** de diálogos, menús y tooltips (`z-50`).
  El efecto es del marco de la app, no de una superficie que el usuario acaba de abrir para
  leerla.

## 9.1 Temas

Un tema es una **paleta completa**, no un interruptor de un efecto. Son **once**:

| Tema | De qué va |
| --- | --- |
| `phosphor` | El de por defecto. Ámbar sobre negro, con scanlines. |
| `amber` | Ámbar monocromo, como un CRT P3. |
| `green` | Verde fósforo P1, el del terminal clásico. |
| `ice` | Frío, en cian y azul. |
| `plasma` | Violeta y rosa. |
| `paper` | Claro, para leer de día. |
| `solarized` | El clásico de Schoonover: amarillo y cian sobre azul petróleo. |
| `gruvbox` | Retro cálido, con amarillos y verdes apagados. |
| `nord` | Azules fríos del norte. |
| `mono` | Sin color, solo grises. Los errores se quedan en rojo a propósito. |
| `plain` | El esquema de `phosphor` sin las scanlines. |

- Los tokens se declaran una vez en `@theme` (que **es** la definición de `phosphor`, y
  también el valor por defecto mientras la app carga la configuración) y cada tema los
  sobreescribe en `html[data-theme='…']`. Gana el tema por especificidad:
  `html[data-theme]` (0,1,1) le gana a `:root` (0,1,0).
- `card`, `popover` e `input` son **tokens derivados** de `panel`, `foreground` y `border`
  en `:root`: la sustitución ocurre en el mismo elemento, así que cada tema resuelve los
  suyos y no hay que repetirlos siete veces.
- Las **scanlines son un token** (`--color-scanline`): cada tema decide si las quiere y de
  qué color. `transparent` las apaga. Antes eran un caso especial del tema `plain`.
- `plain` es el único que hereda: solo cambia la scanline. Es su definición, y la guardia lo
  tiene exento. Cualquier tema nuevo debe declarar los 31 tokens.
- El **color de escaneo, la selección de texto, el hover de la barra de scroll y los toasts**
  salen de tokens. Estaban a mano con los valores de `phosphor`, así que cualquier otro tema
  los habría dejado con los colores del primero.
- El **resaltado de sintaxis** del editor y de la prosa también es del tema. El tema TextMate
  de shiki (`lib/phosphor-theme.ts`) declara sus colores como `var(--color-syntax-*)` en vez
  de literales: shiki las escribe tal cual en el `style` de cada token y el navegador las
  resuelve con el tema activo, así que **cambiar de tema recolorea el código sin volver a
  resaltarlo**. Con colores fijos, el tema claro `paper` habría pintado texto claro sobre su
  fondo claro. Los comentarios y los operadores se miden a 3:1 y no a 4.5:1: son apagados a
  propósito, y exigirles el mínimo de texto normal obligaría a que dejaran de parecerlo.
- El botón de la barra superior **cicla** por la lista de `THEME_OPTIONS` (antes era un
  interruptor de dos estados) y el título dice a cuál va. Elegir uno concreto se hace en
  Ajustes. Un valor desconocido en `config.theme` cae al de por defecto en vez de dejar el
  `<html data-theme>` sin coincidir con ninguna regla.
- `bun run --cwd frontend verify:themes` comprueba las tres piezas que se pueden
  desincronizar —entrada en `THEME_OPTIONS`, bloque de tokens, textos— y **mide el contraste
  WCAG 2.1** de cada paleta, incluido el del código resaltado sobre su propio fondo. Como no
  hay forma de mirar siete temas a ojo, se comprueba lo que sí es objetivo: que el texto se
  lea. Ya ha servido: destapó que el color de los comentarios de `phosphor` se quedaba en
  2.99:1, por debajo del mínimo, y que la palabra clave de `paper` no llegaba a 4.5:1.

## 9.2 Idioma de la interfaz

Español e inglés, sin dependencias. Para dos idiomas y una interfaz de este tamaño, un
diccionario tipado resuelve lo que hace falta —claves con autocompletado, interpolación y
plurales— y a cambio da algo que una biblioteca no da: **si falta una traducción, no
compila**.

- `frontend/src/i18n/locales/es/` es la **fuente de verdad de las claves**. El inglés se
  declara `satisfies TranslationShape`, derivado de la forma del español: añadir una clave
  en un idioma y olvidarla en el otro rompe `tsc`, no la pantalla del usuario.
- El idioma activo es `config.language`; vacío significa "el del sistema"
  (`navigator.language`, con español como último recurso). Se cambia desde Ajustes y el
  `PUT /config` lo valida.
- Los plurales admiten las dos convenciones —`clave_one`/`clave_other` y
  `clave: {one, other}`—, que es lo que hacía falta para no reescribir los diccionarios.
- **Errores del core:** el sobre `{code, message}` trae el mensaje en español. Se traduce
  por **código** y solo cuando el mensaje es fijo (`invalid_root`, `no_providers`…). Los que
  llevan pegado el detalle de la validación conservan el texto del servidor: es la única
  fuente de ese detalle, y un envoltorio traducido alrededor de un detalle en español se lee
  peor que el detalle solo.
- **Texto del core que sí se traduce,** porque el servidor manda una clave estable y no una
  frase: las descripciones de categoría (`Category.description`) y las notas de cada cliente
  MCP (`ProviderReport.note`). Se resuelven por clave en `frontend/src/lib/labels.ts` y el
  texto del servidor queda de respaldo, así que un core más nuevo que añada una categoría o
  un cliente sigue enseñando algo legible. **El precio es la duplicación**: esas frases están
  también en Go, y si cambian allí hay que cambiarlas aquí. Está anotado en los dos sitios.
- **Lo que sigue en español, y por qué.** `result.message` al aplicar la configuración MCP
  (el mismo `action: "manual"` cubre tres motivos distintos, así que el código no basta),
  los avisos del snippet y `Proposal.inference.reason` (prosa que genera la inferencia del
  core). Traducirlos pide que la API mande un **motivo** legible por máquina, que es un
  cambio de contrato, no una traducción. Se ve en el onboarding y en la tarjeta del inbox.
- La verificación está en `bun run --cwd frontend verify:i18n`, que mira los dos niveles:
  la paridad de los diccionarios (claves, vacíos, `{placeholders}`, plurales) y el runtime
  (que el proveedor devuelva el idioma pedido, que interpole y que los errores se traduzcan
  por código). Un diccionario perfecto no sirve de nada si el proveedor no lo lee.

## 9.3 Diagramas Mermaid

Un cercado con lenguaje `mermaid` (`o` su alias `mmd`) se dibuja en vez de mostrarse como
código. Se guarda como markdown, no como imagen: **el archivo de disco sigue siendo legible
y diffeable**, y la imagen se genera al vuelo.

- **Se carga en diferido.** Mermaid pesa más que el resto del editor junto (el núcleo son
  ~670 kB y hay motores de disposición de más de 1 MB). Con `import()` dentro de una función,
  Vite lo parte en sus propios trozos y solo se descarga la primera vez que aparece un
  diagrama. Importarlo arriba lo metería en el bundle inicial y lo pagaría quien no escribe
  un solo diagrama. `verify:mermaid` vigila que siga siendo así: **un `import` estático lo
  rompe y no falla nada**, solo engorda el arranque.
- **Los colores salen de los tokens del tema**, no de Mermaid. Se usa `theme: 'base'` con
  `themeVariables` leídas de las custom properties, así que un diagrama se ve como parte del
  documento. Como el SVG lleva los colores **incrustados**, al cambiar de tema hay que
  **volver a dibujarlo**: el componente de React lo hace con un `MutationObserver` sobre
  `data-theme`.
- **Dibujarlo en el modo `live` obligó a un `StateField`.** La Live Preview es un
  `ViewPlugin`, y CodeMirror prohíbe a los plugins las decoraciones de bloque y las que
  cruzan saltos de línea:

  ```js
  if (this.disallowBlockEffectsFor[index]) {
    if (deco.block) throw new RangeError("Block decorations may not be specified via plugins")
    if (to > doc.lineAt(from).to) throw new RangeError("Decorations that replace line breaks …")
  }
  ```

  Sustituir un cercado entero cruza saltos de línea, así que va en un `StateField` aparte
  (`diagramField`) que se **suma** al plugin existente en vez de sustituirlo. El plugin no se
  tocó: los dos proveen `EditorView.decorations` y CodeMirror los combina.
- **Con el cursor dentro del cercado se ve el markdown**, igual que con la negrita. Es lo que
  permite editar el diagrama sin salir del modo en vivo.
- **Un diagrama con errores no rompe la preview**: Mermaid lanza, se captura, y se enseña el
  error junto al código fuente, que es lo que hay que corregir. El bloque se marca además
  como `data-diagram="mermaid"`.
- El `securityLevel` es `strict`: el texto de un diagrama viene de un archivo que puede haber
  escrito un agente, y ahí no se inyecta HTML.
- Se verifica con `bun run --cwd frontend verify:mermaid`, que comprueba lo que no se ve al
  compilar: que sigue siendo perezoso, que los tokens que pide el mapa existen en
  `styles.css`, que las clases del componente están definidas y que el renderizador de
  markdown enruta los diagramas. La parte de dibujar en sí necesita un navegador: Mermaid
  mide texto y calcula geometría.

## 9.3.1 Opacidad de la ventana

Un ajuste de 20 % a 100 % (`config.opacity`, por defecto 100) que deja ver lo que hay
detrás de la ventana.

- **La ventana se crea translúcida** (`.transparent(true)` en `src-tauri/src/main.rs`), y
  cuánto se ve a través lo decide la interfaz.
- **El `background_color` de la ventana va con alpha 0, no 255.** Ese color lo pinta la
  ventana *por detrás* del webview, así que con alpha opaco tapaba el escritorio y la
  translucidez del CSS no servía de nada: se veía el color de la ventana, no el fondo de
  pantalla. En cuanto el webview pinta, el color lo pone el tema.
- **El deslizador necesita estado local mientras se arrastra.** Es un `input` controlado
  cuyo valor viene de la configuración del servidor, que no cambia hasta que se guarda: sin
  el borrador local, el pulgar volvía solo al valor guardado en cada render y daba la
  impresión de que no se podía mover.
- **El costo, y conviene saberlo:** en macOS esto exige la feature `macos-private-api` de
  Tauri, que usa una **API privada de Apple**. Eso **descarta publicar en la Mac App
  Store**. Es un intercambio consciente —el proyecto se distribuye por DMG— y está
  anotado en `Cargo.toml` y en `tauri.conf.json`. Si algún día hace falta la App Store, se
  quita la feature y la translucidez deja de funcionar; nada más cambia.
- **Se implementa reescribiendo un solo token.** `lib/translucency.ts` sustituye
  `--color-background` por su versión `rgb(... / alpha)`, y todo lo que ya lo usaba —el
  fondo del marco, el del documento, el velo de los diálogos— pasa a ser translúcido sin
  tocar nada más. Con la opacidad al 100 % **se quita la propiedad en línea** en vez de
  ponerla opaca, para que el fondo vuelva a ser exactamente el token del tema y siga a los
  cambios de tema.
- **El texto y los paneles siguen opacos a propósito.** Translucir también el contenido
  deja la interfaz ilegible sobre cualquier cosa con movimiento, y el resultado sería peor
  que no tener el ajuste.
- El mínimo es **20 %**, no 0: por debajo, el texto deja de leerse y el usuario no tendría
  forma de subirlo desde dentro. El API **acota en vez de rechazar**, porque que un
  deslizador mande 101 por un redondeo no es un error del usuario.
- Lo que **no** hace: desenfocar el fondo. Eso pide `NSVisualEffectView` (el crate
  `window-vibrancy`), no CSS: con una ventana translúcida, `backdrop-filter` no ve el
  escritorio que hay detrás.

## 9.4 Barra de título

En macOS la ventana va en modo **`Overlay` con el título oculto**
(`src-tauri/src/main.rs`): desaparece la franja gris del sistema y su «SaveMe» centrado, el
contenido llega hasta arriba, y **la barra superior de la app hace de barra de título**
(`❯ proyecto/categoría` + estado + acciones).

**Los semáforos siguen siendo los nativos.** No se dibujan botones propios: cerrar,
minimizar, zoom, pantalla completa y el menú de la ventana siguen siendo los del sistema,
solo que flotan sobre nuestro contenido en vez de en una franja aparte. Reimplementarlos
sería más vistoso y bastante peor: se pierden los comportamientos nativos que la gente
espera de macOS.

Dos detalles que no se ven y que sin ellos la ventana se rompe o se ve mal:

- **`data-tauri-drag-region` en el `<header>`, y el permiso explícito.** El permiso por
  defecto de ventana **no incluye** `allow-start-dragging` —se comprueba en el `default.toml`
  autogenerado de Tauri, que solo trae consultas—, así que con la barra nativa oculta y sin
  añadirlo a `capabilities/default.json` la ventana **no se podría mover**. El atributo solo
  afecta al propio `<header>`, no a sus hijos: los enlaces y botones siguen siendo pulsables.
  El doble clic hace zoom, que es lo que se espera en macOS.
- **`pl-[78px]` cuando `IS_MACOS`.** Es el hueco de los semáforos; sin él el `❯` quedaría
  debajo del botón de cerrar. La plataforma llega por `window.__SAVEME__.macos`, que el shell
  inyecta en el script de inicialización (es el mismo sitio donde inyecta el puerto del core,
  así que no hay una segunda vía de información).

Lo que **no** está resuelto, y conviene saberlo: en pantalla completa macOS esconde los
semáforos y esos 78px quedan como un hueco a la izquierda. No hay media query para el
pantalla completa, así que haría falta escuchar el evento de la ventana y alternar la clase.

En Windows y Linux no cambia nada: `title_bar_style` y `hidden_title` son
`#[cfg(target_os = "macos")]` en Tauri, y se encadenan con un `let` que ensombrece al
anterior para que en el resto de plataformas esas llamadas simplemente no existan, sin dejar
una variable `mut` sin usar.

## 10. Desarrollo

```bash
make setup      # instala deps de go, bun y cargo
make dev-core   # daemon Go con recarga manual en :7411
make dev-web    # Vite en :1420
make dev        # tauri dev (lanza el core como sidecar)
make test       # las diez suites: go -race, cargo, tsc, preview, i18n, css, temas, mermaid, notas, icono
make build      # binario Go + bundle Tauri
make icon       # regenera el icono en todos sus formatos
make version    # muestra la version; NEXT=0.4.0 la fija en los tres ficheros
```

## 10.1 Versión, icono y publicación

**La versión vive en tres ficheros y el tag manda.** `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` y `frontend/package.json` llevan la misma cadena, y
`scripts/set-version.mjs` es lo único que la escribe: sustituye el valor y no
reescribe el archivo, para que un cambio de versión no llene el diff de ruido.
`make test` comprueba que los tres coinciden.

El binario de Go **no** lleva la versión dentro: se la inyecta el enlazador
(`-X main.version=`), y ese valor sale del tag. Así el binario suelto —el que se
instala como MCP— y la app siempre cuentan lo mismo sin tocar código.

Un matiz que costó un «v v0.4.0» en pantalla: la `v` es del **tag**, no de la
versión. El binario lleva `0.4.0` y la interfaz ya pinta la `v` delante
(`core listo · v{version}`). Pasarle el tag entero duplicaba la letra.

**El icono se genera, no se dibuja.** `scripts/make-icon.py` lo pinta con
matemática de píxeles y la librería estándar (zlib + struct), sin Pillow ni
binarios intermedios, así que es reproducible desde el repositorio y
`make icon` lo reconstruye entero: `.icns`, `.ico`, los PNG y los recursos de
iOS y Android.

Dos detalles del generador que no son cosméticos:

- El PNG se escribe en **tipo de color 6 (RGBA)**, no en 2 (RGB). Sin canal alpha
  no hay forma de que el fondo del icono sea transparente por mucho que se pinte
  de negro.
- El exterior del rectángulo redondeado queda con **alpha 0**, y los canales se
  promedian **premultiplicados** por el alpha. Promediar en alpha directo
  arrastraría el color hacia el negro en el borde: un píxel medio dentro y medio
  fuera saldría casi negro al 50% en vez del color del borde al 50%.

El fallo que esto arregla se veía en el Dock: un cuadrado negro alrededor del
icono, porque el `.icns` llevaba las esquinas opacas. `scripts/verify-icon.mjs`
lo comprueba **decodificando los píxeles** —del `.png` y de los PNG que van
dentro del `.icns`, que es lo que macOS enseña—, no mirando los bytes: un PNG
puede declarar canal alpha (tipo 6) y tenerlo entero a 255, que es justo lo que
hace `tauri icon` al re-codificar.

**Publicar** son cuatro workflows: `tests.yml` e `instalables.yml` son
reutilizables y tienen las suites y la receta de empaquetado; `ci.yml` los llama
en push y en pull request; `release.yml` los llama y además crea la Release. El
empaquetado sube *artefactos* y publica un trabajo aparte que depende de los
tres, para que un fallo en una plataforma no deje una Release a medias. El
detalle está en [`RELEASING.md`](RELEASING.md).
