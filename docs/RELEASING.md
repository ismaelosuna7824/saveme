# Publicar una versión

Esta es la parte que convierte el repositorio en algo que la gente puede
descargar. Está escrita para poder hacerlo dentro de seis meses sin releer los
workflows.

---

## Lo corto

Desde la web de GitHub:

1. **Releases → Draft a new release**.
2. En «Choose a tag» escribes `v0.4.0` y le das a **Create new tag on publish**.
3. Pulsas **Publish release**.

Eso es todo. El tag dispara `release.yml`, que corre las suites, empaqueta en
macOS, Windows y Linux, y adjunta los instalables a esa misma Release. Los
ficheros tardan unos minutos en aparecer en la página.

La otra puerta, si prefieres no tocar tags a mano: **Actions → Release → Run
workflow**, y escribes la versión (`0.4.0`, sin la `v`). No hay tag todavía, así
que lo crea el workflow.

---

## La regla de la versión

**El tag manda.** Es lo único que hay que acertar.

- El tag es `v` + versión: `v0.4.0`. La `v` es del tag, **no** de la versión.
- La versión limpia (`0.4.0`) es la que se escribe en `tauri.conf.json`,
  `src-tauri/Cargo.toml` y `frontend/package.json`, y la que se inyecta en el
  binario de Go con `-X main.version=`.
- Se admiten prereleases: `v1.0.0-beta.1` es un tag válido.

El workflow rechaza cualquier tag que no sea una versión, así que un
`v0.4` o un `release-final` fallan en el primer trabajo en vez de producir un
instalable con la versión en blanco.

La interfaz ya pinta la `v` («core listo · v0.4.0»), por eso el binario lleva la
versión **sin** la `v`: pasarle el tag entero enseñaba «v v0.4.0».

Para ver o cambiar la versión en local:

```bash
make version              # muestra la que hay
make version NEXT=0.4.0   # la fija en los tres ficheros
```

`make test` comprueba que los tres ficheros dicen lo mismo. Si se separan, el
`.dmg` y el binario que lleva dentro contarían versiones distintas.

---

## Qué acaba en la Release

| Plataforma | Ficheros |
|---|---|
| macOS | `SaveMe_<versión>_universal.dmg` — Intel y Apple Silicon en uno |
| Windows | `.msi` y `-setup.exe` (NSIS) |
| Linux | `.deb` y `.AppImage` |

El `.dmg` es universal a propósito: nadie tiene que saber qué procesador tiene su
Mac. Eso obliga a compilar el core de Go **dos veces**, una por arquitectura,
porque Tauri mete los dos sidecars en el mismo binario con `lipo`. Si alguna vez
solo aparece un `.dmg` que arranca en la mitad de los Mac, mira ahí.

---

## Cómo está montado, y por qué

Cuatro ficheros, y cada uno tiene una responsabilidad:

| Fichero | Qué hace |
|---|---|
| `tests.yml` | Las suites. Reutilizable. |
| `instalables.yml` | La matriz de empaquetado. Reutilizable. |
| `ci.yml` | Llama a los dos en push y en pull request. No publica nada. |
| `release.yml` | Llama a los dos y además publica la Release. |

Dos decisiones que no son obvias:

**El empaquetado no publica.** `instalables.yml` deja los instalables como
*artefactos*, y `release.yml` los baja todos y publica en un trabajo aparte que
depende de que los tres hayan terminado. Si Windows falla, no aparece una Release
con solo el `.dmg`: se queda sin publicar y se ve el fallo. Publicar es todo o
nada.

**El modo manual hace todo en una ejecución.** Cuando el workflow crea el tag y
lo empuja, ese push lo hace con el `GITHUB_TOKEN` del propio workflow, y los
push hechos con ese token **no disparan otros workflows** (es una restricción de
GitHub, para que los workflows no se llamen en bucle). Por eso `release.yml` no
espera a que «el tag dispare otra cosa»: crea el tag y sigue, y publica él mismo.
Si algún día se parte en dos workflows, hay que usar un token personal (PAT), o
la segunda mitad no se ejecuta nunca y el fallo es silencioso.

**Solo se dispara con tags, no con el evento `release`.** Se podría añadir
`on: release: types: [published]`, pero entonces publicar desde la web con un tag
nuevo dispararía las dos cosas —el `push` del tag y el `release`— y se
empaquetaría dos veces para nada. Con `push: tags` basta, porque el workflow crea
la Release si no existe: empujar un tag ya deja la Release publicada sin tocar la
web.

---

## Antes de tocar los workflows

**Las acciones tienen que quedarse en su línea de Node 24.** GitHub retiró el
runtime de Node 20, y una acción sobre Node 20 avisa —y acabará fallando—. Las
versiones que usa este repositorio son las primeras de la línea Node 24:

| Acción | Versión | Runtime |
|---|---|---|
| `actions/checkout` | `v7` | node24 |
| `actions/setup-go` | `v7` | node24 |
| `actions/cache` | `v6` | node24 |
| `actions/upload-artifact` | `v7` | node24 |
| `actions/download-artifact` | `v7` | node24 |
| `softprops/action-gh-release` | `v3` | node24 |
| `Swatinem/rust-cache` | `v2` | node24 |
| `oven-sh/setup-bun` | `v2` | node24 |
| `dtolnay/rust-toolchain` | `stable` | compuesta (sin Node) |

No es una lista de «las últimas»: es la comprobación de que ninguna se queda en
Node 20. Para verificar una en concreto:

```bash
curl -sS https://raw.githubusercontent.com/<owner>/<repo>/<version>/action.yml \
  | grep using:
```

Y antes de subir nada, el linter. `actionlint` caza contextos mal escritos y
expresiones que no existen, que es exactamente el tipo de error que solo se ve
cuando ya has publicado:

```bash
go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/*.yml
```

---

## Cuando algo falla

**Reintentar es seguro.** El trabajo `publicar` usa `tag_name`, así que si la
Release ya existe le añade o reemplaza los ficheros en vez de intentar crearla
otra vez. Desde Actions, **Re-run failed jobs**.

**Si el tag está mal** (`v0.4` en vez de `v0.4.0`): no se puede reutilizar el
mismo tag para otro commit sin reescribir historia. Reaplica el tag:

```bash
git tag -d v0.4              # borra el local
git push origin :refs/tags/v0.4   # borra el remoto
git tag v0.4.0 && git push origin v0.4.0
```

Si la Release ya se había creado, bórrala antes desde la web.

**Si falla el empaquetado de una plataforma**, el log del job dice cuál. Los
artefactos de las otras dos se descartan, que es lo que se quiere: no se publica
media release.

---

## Actualizaciones dentro de la app

La app **pregunta sola** al abrirse. Si hay versión nueva, sale un aviso abajo a la
derecha con la versión y un botón para actualizar; al pulsarlo descarga, instala y
se reinicia. No hay que entrar en ninguna web.

Cómo funciona por dentro:

1. Al arrancar, la interfaz llama al plugin de actualizaciones de Tauri.
2. El plugin pide `latest.json` a
   `https://github.com/ismaelosuna7824/saveme/releases/latest/download/latest.json`
   — la última release publicada, no una en concreto.
3. Si la versión de ese fichero es mayor que la instalada, la app avisa.
4. Al aceptar, descarga el paquete, **verifica la firma** y lo instala.

Si la comprobación falla —sin red, o con la release todavía sin `latest.json`— la
app no dice nada. No hay nada que el usuario pueda hacer y un error en cada
arranque sería ruido.

### La clave de firma

Las actualizaciones van firmadas y **esto no se puede desactivar**: es lo que
impide que alguien que controle la red te instale un binario suyo.

- La **pública** vive en `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
  Va dentro de la app, así que se puede compartir.
- La **privada** está en el secreto `TAURI_SIGNING_PRIVATE_KEY` del repositorio, y
  en `~/.tauri/saveme.key` en la máquina de quien publica.

> **Si pierdes la clave privada, no podrás volver a actualizar a nadie.** Las apps
> ya instaladas solo aceptan ficheros firmados con la misma clave cuya pública
> llevan dentro. No hay forma de recuperarlo: habría que pedir a todo el mundo que
> se descargue el `.dmg` a mano otra vez. Guárdala en un sitio seguro.

Para firmar, Tauri exige el **contenido** de la clave, no una ruta. Si le pasas
una ruta la interpreta como si fuera la clave y falla al descifrarla
(`incorrect updater private key password`), que es un error que despista bastante
porque la clave está perfecta. `TAURI_SIGNING_PRIVATE_KEY_PATH` **no existe** en
esta versión del CLI, aunque el generador de claves lo mencione al terminar.

Con `createUpdaterArtifacts` activo, **empaquetar sin firmar falla**. Por eso:

- En local, `make dmg` y compañía leen la clave de `~/.tauri/saveme.key`. Si está
  en otro sitio: `make dmg SAVEME_KEY=/ruta/a/tu.key`.
- En CI, la clave llega por secreto. En un pull request **desde un fork** GitHub no
  entrega secretos, así que ahí se firma con una clave de usar y tirar: la firma no
  vale para actualizar de verdad, pero esos artefactos no se publican nunca.

### El latest.json

Tauri no genera este fichero: genera los paquetes y sus `.sig`, y quien publica
monta el JSON. Lo hace `scripts/make-latest-json.mjs` a partir de los `.sig`, y la
lógica está en `scripts/lib/latest-json.mjs`.

El detalle que importa: **el `.dmg` de macOS es universal**, así que el mismo
`.app.tar.gz` sirve para Intel y para Apple Silicon, pero Tauri busca por
`darwin-<arquitectura de la máquina>`. Por eso el generador escribe **las dos
claves** —`darwin-aarch64` y `darwin-x86_64`— apuntando al mismo fichero con la
misma firma. Con una sola, la mitad de los Mac se quedarían sin actualizaciones y
no habría ningún error que lo delatara: el updater simplemente no encontraría su
plataforma.

Y como Tauri valida el fichero **entero** antes de mirar la versión, una entrada
que falte deja sin actualizaciones a **todas** las plataformas. Por eso el
generador falla en vez de escribir un JSON incompleto. `scripts/verify-update.mjs`
comprueba las dos cosas.

---

## Antes de publicar: el icono

El icono se genera desde el repositorio, no es un binario suelto:

```bash
make icon     # desde scripts/make-icon.py hasta el .icns, el .ico y los PNG
```

Las esquinas tienen que quedar **transparentes**. Si salen negras, macOS enseña
un cuadrado negro alrededor del icono en el Dock y en Finder — pasó, y la causa
estaba en que el PNG se escribía sin canal alpha. `make test` lo comprueba
decodificando los píxeles del `.png` y de dentro del `.icns`, así que un icono con
el fondo opaco no llega a publicarse.

---

## Permisos

`release.yml` pide `contents: write` porque crea la Release y, en el modo manual,
empuja un tag. Los otros tres workflows no necesitan más que lectura.

Si el repositorio tiene la política por defecto de Actions en «read-only», hay que
cambiarla en **Settings → Actions → General → Workflow permissions**, o el
`GITHUB_TOKEN` no podrá publicar.
