# Anatomía del MCP, y cómo replicarlo en otro proyecto

Este documento tiene dos partes y una intención: que entiendas **cómo funciona** el
servidor MCP de SaveMe por dentro, y que puedas **montar el mismo patrón** en otro
proyecto —o adaptar este— sin tropezar con lo que ya tropecé yo.

No es un manual de usuario (eso es `MCP-SETUP.md`) ni el contrato congelado (eso es
`ARCHITECTURE.md`). Es la explicación de por qué está construido así.

---

# Parte 1 — Cómo funciona

## La idea en una frase

Un agente de IA sabe perfectamente **qué** hizo, y se olvida de **por qué**. SaveMe le da
una herramienta para escribir ese «por qué» en markdown, en una carpeta que la persona
elige, y **nunca deja que el agente decida solo dónde guardarlo**.

Todo lo demás —SQLite, las nueve categorías, los doce clientes— son detalles al servicio
de esa frase.

## Un binario, dos caras

No hay dos programas. `saveme` es un único ejecutable de Go con subcomandos:

```
saveme serve        el daemon HTTP que consume la interfaz
saveme mcp          el servidor MCP, hablando por stdio
saveme reindex      reconstruye el índice desde el disco
saveme guide        imprime las instrucciones para pegar en CLAUDE.md
saveme mcp-config   genera o aplica la configuración de un cliente
saveme doctor       dice qué falta, si falta algo
```

Que `serve` y `mcp` sean el mismo binario no es un detalle de empaquetado: **es lo que
impide que las reglas de negocio diverjan**. Si el agente escribe por el MCP y la app lee
por HTTP, y esas dos rutas tuvieran implementaciones distintas de «qué es una categoría
válida» o «cómo se nombra un archivo», tarde o temprano guardarían cosas distintas. Aquí
las dos llaman al mismo paquete `service` y al mismo workspace.

## Por qué funciona con la app cerrada

Porque el MCP **no habla con el daemon**. Abre la base SQLite y escribe en el disco
directamente.

Esto es deliberado y tiene una consecuencia visible: puedes cerrar la app, pedirle a tu
agente un resumen, y al abrirla aparece. La verdad es el `.md` en disco; el índice SQLite
es una caché que se puede borrar y reconstruir con `saveme reindex`.

```
agente ──stdio──> saveme mcp   ──┐
                                 ├──> SQLite (índice, caché)
app    ──HTTP───> saveme serve ──┘    archivos .md (la verdad)
```

## El transporte

| Modo | Cuándo | Cómo |
| --- | --- | --- |
| **stdio** | Lo normal. El cliente lanza `saveme mcp` como subproceso | `mcp.StdioTransport{}` |
| Streamable HTTP | Agentes que se conectan por red | `mcp.NewStreamableHTTPHandler` |

El SDK es el oficial: `github.com/modelcontextprotocol/go-sdk`. Con stdio, **stdout es
sagrado**: es el canal del protocolo. Cualquier `fmt.Println` de depuración que se cuele
ahí rompe la sesión. Por eso el log va a stderr.

## La superficie que ve el agente

Nueve tools, un prompt y un recurso.

| Tool | ¿Escribe archivos? | Para qué |
| --- | --- | --- |
| `saveme_project_list` | no | Ver qué proyectos hay, para no inventar un slug por una errata |
| `saveme_project_create` | sí | Dar de alta un proyecto vacío (raro: `propose` ya lo crea) |
| `saveme_summary_propose` | **no** | Preparar el resumen: categoría sugerida, ruta y token |
| `saveme_summary_confirm` | **sí** | El **único** escritor de archivos. Exige token vivo y decisión del usuario |
| `saveme_summary_cancel` | no | Descartar una propuesta |
| `saveme_summary_search` | no | Buscar en el historial antes de proponer, para no duplicar |
| `saveme_summary_list` | no | Orientarse sobre en qué se ha trabajado |
| `saveme_summary_read` | no | Traer el markdown completo de un resumen |
| `saveme_pending` | no | Ver propuestas sin resolver (y recuperar un token perdido) |

Además:

- **Prompt** `saveme/human-summary`: la versión conversacional de la guía.
- **Resource** `saveme://guide`: la guía completa en markdown.

Siete de las nueve declaran `ReadOnlyHint: true`, y las otras dos —`project_create` y
`summary_confirm`— son exactamente las que tocan el disco. Ese es el reparto que le
interesa a un cliente para decidir si te pide confirmación.

Un matiz que conviene tener claro si copias esto: `ReadOnlyHint` se refiere a **tu
entorno**, y `propose` y `cancel` no son estrictamente de solo lectura —escriben una fila
en el índice local, una propuesta pendiente y su resolución—. Se marcan así a propósito
porque lo que importa es que **no tocan tus archivos ni tu configuración**, y marcar
`propose` como escritora haría que los clientes pidieran confirmación en cada propuesta,
justo antes del paso donde el usuario ya decide. La garantía real no es esa anotación: es
el token de la fase siguiente.


## La garantía de «siempre preguntar», en tres capas

Este es el corazón del asunto. La regla de negocio es *el usuario decide dónde vive su
historial, y esa decisión queda auditada*. Confiar eso a que el modelo se porte bien no
es una garantía, es un deseo. Hay tres capas, y **cada una funciona sin las otras**:

**1. Estructural — el token de un solo uso.** `propose` no toca el disco. Ni un archivo,
ni una carpeta. Devuelve una propuesta y un token con 15 minutos de vida. `confirm` es el
único escritor y sin token vivo no escribe nada. Aunque el agente mienta, no hay camino
desde «no pregunté» hasta «se escribió un archivo» que no pase por un token que él mismo
tuvo que pedir.

**2. Elicitation — preguntarle al usuario por el protocolo.** Si el cliente la soporta,
SaveMe le muestra al usuario un diálogo con la ruta propuesta y las alternativas, y **su
respuesta manda sobre lo que diga el agente**. El agente no ve la respuesta: la ve el
servidor.

**3. Protocolo — la descripción de la tool.** Si no hay elicitation, el texto de la tool
obliga al agente a preguntar en el chat y a declarar la decisión (`accepted` /
`modified`), que queda guardada en la base con `resolved_via`. La mentira es posible pero
**queda registrada**.

### El token, en detalle

```
propose  → INSERT en proposals (status='pending', expires_at=now+15min)
           devuelve token "pt_..." de un solo uso

confirm  → UPDATE proposals SET status='confirmed', ...
             WHERE token = ? AND status = 'pending'
           ¿RowsAffected == 1?
             sí → escribe el archivo
             no → otro ya lo reclamó; no escribe nada
```

Ese `WHERE ... AND status = 'pending'` es la barrera real. La aplica SQLite de forma
atómica: si dos confirmaciones del mismo token llegan a la vez —un agente que reintenta,
dos agentes en paralelo— **solo una ve `RowsAffected == 1`**. La otra no escribe.

Fíjate en el orden: **se reclama el token antes de tocar el disco**. Si algo falla después
—la ruta no es válida, el disco se llena— se llama a `ReleaseProposal`, que devuelve el
token a `pending` para que el usuario pueda reintentar sin volver a proponer.

Y es **idempotente**: si el agente reintenta tras un timeout, no recibe un error, recibe
el resumen que ya se escribió con `already_there=true`. Un timeout de red no debe
convertirse en un archivo duplicado.

## El caso raro que hay que resolver: elicitation en el protocolo nuevo

En el protocolo MCP `2026-07-28` y posteriores, **una petición de servidor a cliente a
mitad de una llamada ya no está permitida**. Llamar a `session.Elicit()` dentro del handler
no funciona: el SDK rechaza el envío con un error que viene a decir que
`elicitation/create` no se puede mandar mientras se sirve una petición en esa versión del
protocolo.

El mecanismo correcto es **MRTR** (multi round-trip, SEP-2322): el handler devuelve
`InputRequests` y el cliente **re-invoca** la tool con las respuestas en
`InputResponses`.

```go
raw, answered := req.Params.InputResponses[elicitRequestKey]
if !answered {
    requests, _ := s.buildElicitRequest(ctx, token)
    // Solo InputRequests, sin contenido: el SDK rechaza un resultado con las dos cosas.
    return &mcp.CallToolResult{InputRequests: requests}, nil, nil
}
// ... aquí ya tenemos la respuesta del usuario
```

Lo bueno: **el propio SDK traduce esto a una llamada a `Elicit` para clientes de
protocolos anteriores**. Una sola implementación cubre las dos generaciones. Si estás
montando algo parecido, escribe MRTR, no `Elicit` directo.

Y hay un caso que se olvida: **el usuario cierra el diálogo sin elegir**. Eso no es un
«sí» ni un «no». Se devuelve un error de tool a propósito, para que el agente no lo
confunda con un guardado exitoso, y el token sigue vivo.

## Qué queda en disco

La verdad es markdown con frontmatter YAML, en una carpeta que el usuario elige
(por defecto `~/Documents/SaveMe`):

```
<raíz>/<proyecto>/<categoría>/2026-02-14-titulo-del-resumen.md
```

Nueve categorías fijas —`feature`, `fix`, `chore`, `refactor`, `docs`, `infra`, `design`,
`research`, `incident`— más `uncategorized`. Que sean carpetas fijas es lo que permite que
**quien escribe nunca tenga que decidir entre «crear carpeta» o «guardar»**: la carpeta ya
existe.

La escritura es atómica (temporal + `rename`) y **nunca sobrescribe**: si el archivo
existe, busca otro nombre. Un lector concurrente ve el archivo viejo completo o el nuevo
completo, jamás uno a medias.

Toda ruta que llega del agente pasa por `SafeRel` (y luego `Abs`, como segunda barrera),
que rechaza rutas absolutas, cualquier `..`, las que no apuntan a un archivo y las que
entran en el directorio interno `.saveme/`. El agente propone rutas; el workspace decide si
son legales.

**Lo que esa defensa no cubre, y conviene saberlo:** son comprobaciones **léxicas**. Si
dentro del workspace hay un symlink que apunta fuera —por ejemplo
`mi-proyecto/features -> /etc`—, una ruta que lo atraviese pasa los chequeos y la escritura
acaba fuera de la raíz. No es un ataque realista en el modelo de amenaza de esta
herramienta (el servidor es local y lo maneja tu propio agente), pero es un agujero que
existe. Cerrarlo pide resolver el symlink del ancestro existente más profundo y volver a
comprobar el prefijo. Si copias este patrón para algo con más exposición, hazlo.

## Cómo se le enseña el flujo al agente

Cuatro canales, y no es redundancia: cada uno llega en un momento distinto.

| Canal | Cuándo lo ve el agente |
| --- | --- |
| **Instrucciones del servidor** | Al conectarse. Es lo primero que lee |
| **Descripción de cada tool** | Justo antes de decidir si la llama |
| **Prompt `saveme/human-summary`** | Cuando el usuario lo invoca a propósito |
| **`saveme guide >> CLAUDE.md`** | Fuera del MCP, para agentes sin soporte o para dejarlo en el repo |

La descripción de `saveme_summary_propose` es, con diferencia, la superficie de prompt más
importante del proyecto. Empieza así:

> **IMPORTANTE: esta tool NO escribe nada.** Ni un archivo, ni una carpeta.

Y sigue con «QUÉ HACER DESPUÉS, EN ESTE ORDEN: 1. Muéstrale la propuesta al usuario y
PREGÚNTALE…». No es documentación: es el contrato, y está en el mismo archivo que el
código que lo hace cumplir.

## Cómo llega a doce clientes

El paquete `mcpconfig` conoce doce clientes: `opencode`, `codex`, `claude-code`,
`claude-desktop`, `cursor`, `windsurf`, `gemini-cli`, `qwen`, `kiro`, `vscode-copilot`,
`kilocode` y `generic`. Cada uno declara su formato (JSON, TOML, comando o manual), su
ruta y —esto es lo importante— si su formato está **verificado contra su documentación**.

```
Verified: true   → se escribe solo
Verified: false  → se ofrece el bloque para pegar, y se dice que no está confirmado
```

Inventar el formato de un cliente y escribirlo a ciegas es una forma estupenda de romperle
la configuración a alguien. Los que no están confirmados se marcan como tales; no se
finge.

Las escrituras son **fusiones**, nunca reemplazos: se añade la entrada `saveme` y se deja
copia de seguridad. Y si el archivo tiene comentarios (JSONC), **no se reescribe** —un
parseo y volcado se los comería— y se le da el bloque al usuario.

---

# Parte 2 — Cómo replicarlo en otro proyecto

## El patrón, en abstracto

Lo que hace SaveMe no es específico de «resúmenes de proyecto». El patrón es:

> Un servidor MCP que escribe **artefactos legibles por humanos** en un almacén que
> **pertenece al usuario**, donde el agente aporta el contenido y **la persona decide la
> ubicación**, y donde la escritura pasa por una confirmación explícita y auditable.

Encaja con: un diario de decisiones (ADRs), runbooks, post-mortems, notas de investigación,
un catálogo de prompts, un registro de experimentos… Cualquier cosa donde «¿dónde va esto?»
sea una decisión de la persona y «¿qué dice?» sea trabajo del agente.

## Receta, paso a paso

### 1. Decide el artefacto y su contenedor

Antes de escribir Go. Dos preguntas:

- **¿Qué escribe el agente?** El *contenido*, en markdown. Nunca la estructura.
- **¿Qué decide la persona?** El *contenedor*: la carpeta, la categoría, el proyecto.

Si no puedes responder la segunda, no necesitas este patrón: necesitas una tool normal.

### 2. Modela el dominio antes que el MCP

El paquete `service` **no sabe que existe MCP**. Se puede probar entero sin protocolo, sin
transporte y sin agente. El MCP es una cáscara fina encima.

Esta separación es la que hace que la app y el agente no diverjan, y la que permite que
`go test` cubra la lógica de verdad.

```
domain/     tipos, ids, categorías, validación        (sin depender de nada)
markdown/   frontmatter YAML: parsear y renderizar
workspace/  disco: rutas seguras, escritura atómica, papelera
store/      SQLite: índice, propuestas y eventos
service/    las reglas de negocio                     ← el MCP solo llama aquí
config/     preferencias persistentes
watch/      vigila el disco para que la app vea lo que escribe el agente
mcpserver/  la cáscara: tools que delegan en service
mcpconfig/  los doce clientes: formato, ruta y si está verificado
api/        HTTP + SSE para la interfaz
```

Las flechas de dependencia van en un solo sentido y `domain` no importa a nadie:
`markdown`, `workspace` y `store` dependen solo de `domain`; `service` de esos cuatro;
`mcpserver` de `service` más `store` y `workspace` para leer; y `api` de todo. `config` y
`mcpconfig` no dependen de nada. Si copias esta estructura, esa dirección es lo que te deja
probar la lógica sin levantar nada.

### 3. Las dos fases, con token

```
propose(ctx, contenido) → { token, ruta_propuesta, alternativas, por_qué }   // no escribe
confirm(ctx, token, decisión) → { ruta, escrito: true }                      // único escritor
cancel(ctx, token)                                                           // no escribe
```

Reglas que hacen que esto sea una garantía y no un adorno:

- `propose` **no debe poder** escribir. Que sea incapaz, no que se porte bien.
- El token se reclama con un `UPDATE ... WHERE estado = 'pendiente'` atómico.
- TTL corto (15 minutos) y de un solo uso.
- Si algo falla tras reclamar, se libera el token.
- `confirm` es idempotente: reintentar devuelve lo ya escrito, no duplica.

### 4. Escribe las descripciones como si fueran el prompt

Es el paso que más se subestima. La descripción de la tool es **lo que el modelo lee para
decidir**, y muchas veces es lo único que lee. Di explícitamente:

- qué **no** hace («esta tool no escribe nada»),
- el orden de los pasos siguientes,
- qué está prohibido asumir («solo `accepted` si de verdad preguntaste»),
- qué hacer en los casos raros.

### 5. Añade instrucciones, prompt y resource

Las instrucciones del servidor se leen al conectar y son gratis. El prompt sirve para
invocarlo a propósito. El resource, para que el agente pueda releer la guía cuando la
necesite. Y un subcomando `guide` que imprima esa misma guía permite
`saveme guide >> CLAUDE.md` para agentes que no lean nada de eso.

**Una sola fuente de verdad**: aquí la guía se genera desde el binario, así que no puede
quedar desactualizada respecto al código que la hace cumplir.

### 6. Genera la configuración de los clientes

No le pidas a nadie que edite siete archivos de configuración a mano. Declara cada cliente
como datos (formato, ruta, si está verificado) y genera el bloque.

Dos reglas que aprendí a la mala:

- **Ruta absoluta del binario, siempre.** Un cliente lanzado desde una interfaz gráfica
  hereda un `PATH` mínimo: `"command": "saveme"` funciona en tu terminal y falla en la app.
- **El binario no puede vivir dentro del `.app`.** Si el usuario mueve o borra la
  aplicación, la configuración apunta a una ruta muerta y **el cliente falla en
  silencio**. Cópialo a un sitio estable (`~/.saveme/bin/`) y apunta ahí.

### 7. Prueba con un cliente MCP de verdad

Las pruebas con transportes en memoria no ejercitan el camino real. Yo tengo las dos:
pruebas de Go con un cliente real contra un servidor real, y un `scripts/mcp-smoke.py` que
lanza el binario como subproceso y habla JSON-RPC por stdio.

El fallo que solo aparece en el camino real: **el subproceso comparte stdout con el
protocolo**. Un log mal puesto lo rompe, y en memoria no se ve.

### 8. Prevé el camino de vuelta

Escribir en el archivo de configuración de otro programa obliga a poder dejarlo como
estaba. `POST /api/mcp/unconfigure` y `--remove`:

- borran **solo** tu entrada; el resto del archivo queda intacto,
- dejan copia de seguridad,
- si el archivo se queda vacío y era tuyo, lo borran,
- si no se puede reescribir con seguridad (JSONC), lo dicen en vez de romperlo,
- **no desinstalan el binario**: quitarte de un cliente no es desinstalarte.

## Qué es reutilizable y qué es de este dominio

| Pieza | ¿Reutilizable? |
| --- | --- |
| El patrón de dos fases con token | **Sí, tal cual.** Es lo valioso |
| El claim atómico (`UPDATE ... WHERE pendiente`) | **Sí.** Es la barrera real |
| MRTR / `InputRequests` en vez de `Elicit` | **Sí.** Es la forma correcta hoy |
| Descripciones de tool como contrato | **Sí** |
| El paquete `mcpconfig` (12 clientes) | **Sí**, cambiando nombres y rutas |
| Fusionar con copia y negarse ante JSONC | **Sí** |
| Rutas seguras (`SafeRel`) y escritura atómica | **Sí** |
| Índice SQLite reconstruible con FTS5 | **Sí**, si vas a buscar |
| Las nueve categorías y sus stems en español | **No.** Es de este dominio |
| La inferencia por señales léxicas | **No.** Solo si tu problema es clasificar |
| El esquema de frontmatter | **No.** Adáptalo |

---

# Parte 3 — Cómo adaptarlo

## Cambiar el artefacto

Supón que quieres un diario de decisiones en vez de resúmenes. Toca:

1. `internal/domain/category.go`: las categorías. Un ADR tendría `decision`, `reversal`,
   `context`, `alternatives`… y `Container` (la carpeta) en vez de «categoría».
2. `internal/markdown/frontmatter.go`: los campos del YAML.
3. Los textos de las tools en `internal/mcpserver/descriptions.go`.
4. `internal/api/guide.go`: la guía.

Lo que **no** se toca: `service.Confirm`, el claim del token, `workspace`, `store`. La
maquinaria no sabe qué guarda.

## Cambiar el contenedor

Si tu decisión no es «categoría» sino, digamos, «entorno» (`staging`, `prod`) o «cliente»,
el sitio es `domain` y la inferencia. El resto del flujo es idéntico: propones un destino,
el usuario lo aprueba o lo cambia, y se escribe.

## Añadir una tool

```go
mcp.AddTool(s.srv, &mcp.Tool{
    Name:        "mi_tool",
    Title:       "…",
    Description: "…",   // ← esto es el prompt; cuídalo
    Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
}, s.handleMiTool)
```

Dos detalles:

- Marca `ReadOnlyHint` / `IdempotentHint` de verdad. Los clientes los usan para decidir si
  te piden confirmación.
- El handler no lleva lógica de negocio: valida la forma de entrada y llama a `service`.

## Añadir un cliente

Una entrada en `defaultProviders()` con `Key`, `Name`, `Format`, `Path`, `ServersKey`,
`Style` y —si no lo has confirmado contra su documentación— `Verified: false`. Y una
prueba que compruebe que el bloque generado y el escrito son el mismo.

## Servir por HTTP en vez de stdio

Ya está: `Server.HTTPHandler()` devuelve un `StreamableHTTPHandler`. Útil si el agente corre
en otra máquina. Ojo entonces con la autenticación: por stdio el límite de confianza es el
usuario, por red no lo es.

---

# Parte 4 — Lo que rompería si volviera a empezar

Fallos reales, con su síntoma. Te ahorran una tarde cada uno.

**Una petición de servidor a cliente a mitad de llamada ya no existe.** Llamar a `Elicit`
directamente funciona en clientes viejos y revienta en el protocolo `2026-07-28`. Usa
`InputRequests` (MRTR) y deja que el SDK traduzca hacia atrás.

**`stdout` es del protocolo.** Cualquier `fmt.Println` en el camino de `mcp` corrompe la
sesión. Todo el log a stderr.

**Los clientes lanzados desde una GUI tienen un `PATH` mínimo.** Ruta absoluta en la
configuración, siempre.

**Un binario dentro del `.app` es una ruta muerta esperando.** El cliente falla **en
silencio**: no encuentra el ejecutable y no dice nada. Cópialo a un sitio estable.

**El Tauri sidecar no puede llamarse como el paquete de Cargo.** El build falla con un
error que no lo explica.

**Cerrar el diálogo de elicitation no es «no».** Es «no decidí». No escribas nada, no
consumas el token, y devuelve un error de tool para que el agente no lo confunda con un
éxito.

**Reescribir JSONC borra los comentarios del usuario.** Detéctalo y niégate; dale el
bloque para pegar.

**«¿Existe la clave?» no es «¿está configurado?».** Si solo miras si existe, la segunda
vez reescribes el archivo igual, le cambias la fecha y le dices al usuario que
actualizaste algo. Compara el **contenido** (normalizando por JSON, porque al leer un
`[]string` llega como `[]any` y `DeepEqual` falla aunque sea lo mismo).

**El timeout de red del agente no puede convertirse en un archivo duplicado.** Haz
`confirm` idempotente.

---

# Verificar que funciona

```bash
# 1. ¿El binario responde y ve el workspace?
saveme doctor

# 2. ¿El MCP habla el protocolo de verdad, por stdio?
python3 scripts/mcp-smoke.py <binario> tools

# 3. Sin la app abierta: propone, confirma, y comprueba que el archivo aparece
python3 scripts/mcp-smoke.py <binario> full mi-proyecto "Título" "Cuerpo"

# 4. La lógica, sin protocolo de por medio
cd backend && go test -race ./...
```

El paso 3 es el que importa: **el camino que promete el producto** es «el agente escribe con
la app cerrada y al abrirla está». Si ese no pasa, lo demás da igual.
