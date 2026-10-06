# SaveMe

A technical project journal in markdown, so that six months from now you know **what
was done and why**. After each feature, fix or decision you save a human summary, and
you write it with the agent you already use: SaveMe exposes an MCP server, and the
agent always asks you where to save before it writes anything.

Each summary is a real `.md` file inside a folder per project and category. The file
is the source of truth; the app is a comfortable way to read, edit and search it.

```
~/Documents/SaveMe/
└── saveme-app/
    ├── features/2026-02-14-markdown-editor-with-preview.md
    ├── fixes/2026-02-16-watcher-race.md
    └── design/2026-02-18-index-schema.md
```

## Install the app

```bash
make dmg            # macOS: builds the .dmg in src-tauri/target/release/bundle/
make install-app    # macOS: builds the .app and installs it in /Applications
make install:macos  # macOS: the same, plus the `saveme` binary wherever it already is on your PATH
make msi            # Windows          (or `make nsis` for the .exe)
make deb            # Linux            (or `make appimage`)
```

Drag the `.dmg` into Applications and open it. **On first launch the app walks you
through it**: it explains what it is going to do, shows which agents you have
installed and configures the MCP server in the ones you pick. There is nothing to
download — the MCP server is a self-contained 12 MB binary that ships inside the app,
with no Go, Node or other dependencies.

The wizard puts the binary in its own folder (`~/.saveme/bin/saveme`) so your agents'
configs don't point inside the app, which would break if you moved or deleted it. You
can reopen it any time from `Cmd+K`.

## Development

```bash
make setup          # Go, bun and Rust dependencies
make dev            # builds the core, sets it up as a sidecar and opens the app
```

Connecting your agent: **the app does it for you on first launch**. If you prefer the
command line, or want to configure another client later:

```bash
make install                                      # puts `saveme` on your PATH
saveme doctor                                     # tells you what is missing, if anything
saveme mcp-config --list                          # which clients it sees and which have saveme
saveme mcp-config --provider opencode --write      # or codex, cursor, claude-code, copilot, pi, omp…
saveme mcp-config --provider custom --path ~/.my-agent/mcp.json --write  # one that isn't listed
saveme guide >> CLAUDE.md                         # instructions for the agent
```

`mcp-config` works out the binary path and the workspace root on its own, merges the
block into your config without deleting the MCP servers you already have, and keeps a
backup. Restart the client afterwards.

**Works with the app closed**: the MCP server is the same Go binary with another
subcommand (`saveme mcp` instead of `saveme serve`) and talks straight to SQLite and
the files, without depending on the daemon. If the app is open, its watcher sees the
file and the UI updates by itself; if it is closed, it finds it on the next launch.

From then on, when you finish a change you ask the agent to *"save a summary in
SaveMe"*: it proposes a destination, asks whether that's fine and writes.

Per-client details, the shared-root rule and what to do when it doesn't work:
**[docs/MCP-SETUP.md](docs/MCP-SETUP.md)**.

How the MCP server works inside —the single-use token, the two-phase guarantee— and how
to reuse the same pattern in another project:
**[docs/MCP-BLUEPRINT.md](docs/MCP-BLUEPRINT.md)**.

### Supported clients

`mcp-config` and the app know 26 clients. Paths and formats come from each client's
official documentation or source code.

| How | Clients |
| --- | --- |
| Written automatically | OpenCode, Codex CLI, Claude Desktop, Cursor, GitHub Copilot (CLI and VS Code), VS Code user profile, Gemini CLI, Antigravity (app, IDE and `agy` CLI), Qwen Code, Kiro, omp, pi, Kilo Code (CLI and extensions), Amp, Z Code, Kimi Code, Devin (CLI and Desktop), legacy Windsurf |
| Its own command | Claude Code (`claude mcp add --scope user`), Hermes Agent (`hermes mcp add`) |
| Block to paste | DeepSeek Harness (a YAML row that must be merged into `cordis.patch.yml`), and the generic `mcpServers` block for anything else |
| No config of their own | Orca, Mono, T3 Code and Omnigent launch other agents, and each of those loads its own config. They are listed so you know what to do, and they count as configured as soon as one of the agents they launch is |

Two paths are still unconfirmed and are written with a warning: the VS Code user-profile
`mcp.json` and legacy Windsurf (now Devin Desktop). Devin in the cloud doesn't apply: its
servers run in its own environment and can't launch a program on your machine.

**A client that isn't listed**: *Settings → AI clients → custom client*, or
`saveme mcp-config --provider custom`. You describe where the client keeps its MCP servers
—the file, the servers key, the entry `type`, whether the command and its arguments go
together in `command`, and the environment key— and SaveMe writes it with the same
guarantees as the known ones: a backup, a JSONC file is never rewritten, and nothing is
touched if it was already the same. A `.toml` file is written as TOML; anything else, as
JSON.

### What the agent is told to write

The guide (`saveme guide`, the `saveme://guide` MCP resource and the
`saveme/human-summary` prompt are the same text) asks for a summary that is
**documentation**: someone who reads it in six months has to understand it without the
chat or the diff.

- **What you asked to save is the centre.** If you didn't say and the session covered
  several topics, the agent asks.
- **Detail scales with the change.** A typo fits in a paragraph; a feature, a design
  decision or an incident get a full document.
- **Structure**: Context, What was done, Why (with the discarded alternatives), How it
  works, How to use and verify it, What's missing and risks, References. Incidents,
  research and design have their own shape, plus a glossary when domain terms come up.
- **Mermaid diagrams** when they help: flowcharts, sequence diagrams, state diagrams,
  data models and timelines. One idea per diagram, around 15 nodes at most, and never
  for decoration.

## Verify it works

```bash
make test        # Go with -race, Rust, types and every frontend verification
make test-e2e    # 54 checks against the real binary, in a separate process
```

`make test-e2e` covers the path that matters for MCP: **it stops the app, writes a
summary through the agent and checks that the app finds it when it starts again.**

## The editor

Four modes, `Cmd+E` to cycle. The one you pick is stored in the config, so next time
you open where you left off.

| Mode | What it does |
| --- | --- |
| **live** (default) | Renders the markdown as you type, like Obsidian: headings grow, bold looks bold, task checkboxes can be ticked. The syntax shows up **only on the line with the cursor**, so you can edit it. |
| source | Raw markdown, no decoration. |
| split | Source on the left, rendered document on the right, with block-synced scrolling. |
| preview | Only the rendered document, full width. |

Task checkboxes are interactive in both places: ticking one rewrites the three marker
characters (`[ ]` ↔ `[x]`) in the markdown, and autosave takes it from there. There is
no parallel state: the file rules.

**Mermaid diagrams** are drawn: a ` ```mermaid ` fence stops being code and becomes a
picture, in all four modes and in the inbox preview too. They are stored as markdown, so
the file stays readable and diffable. With the cursor inside the fence you see the code
—to edit it—, colours come from the active theme, and a broken diagram doesn't break the
rest of the document: the error and the source are shown. A large diagram opens **full
screen** —corner button or double click in the preview—: drag to move, zoom with a
trackpad pinch or `⌘/Ctrl` + wheel, `0` fits it to the screen and `1` shows it at actual
size.

**Vim mode** is optional and lives in Settings. It is off by default, because it turns on
a mode where letters are commands, and that isn't something to impose on anyone. When it
is on, the notes editor answers to `i`, `Esc`, `dd`, `ciw`, `v`, `/` and friends, and the
status bar tells you which mode you are in —otherwise typing with nothing appearing can
only look like a bug—. It only affects the notes editor; the summaries editor is still
filled in one go.

## Background image

An image behind the whole window, with the same controls as loopops-ade's chat
background. It lives in *Settings → Appearance → background image*, and a project can use
its own from the image button in its header; the project's image wins on that project's
screens, and every other screen shows the global one.

- **Live preview** of the two cases side by side: a screen with no document (inbox,
  projects, tags) and one with a document open (a summary or a note).
- **Effect**: none, dither, ASCII, halftone, scanlines or haze, drawn on a canvas.
- **Show on**: no-document screens only, or everywhere.
- **Visibility without a document** and **with a document** (default 60% and 30%), and
  **blur** up to 24 px.

The image is picked with the system file dialog and uploaded to the core, which keeps a
copy named after its content next to `config.json`, so the background doesn't depend on
the original file staying where it was. While an image is showing, the top bar, sidebar and
status bar turn into frosted glass, and the blocks that carry text (project header and tabs,
search, the summary list, the inbox column, empty states) become glass cards, so text never
sits straight on the photo and the image shows crisp wherever there is no content.
Sliders preview live and save when you let go.

## Project icons

Every project gets a pixel creature in the style of the classic space invaders, in the
sidebar, the project header, the inbox cards, the weekly digest, the command palette and the
"move to another project" picker. It is derived from the slug (FNV-1a picks one of twelve
hand-drawn sprites and one of eight equal-lightness colours), so the same project looks the
same everywhere and on every machine without storing anything, and similar names land far
apart. Projects with no summaries show their icon dimmed.

**You can pick your own**: click the icon in the project header to choose one of the twelve
creatures and one of the eight colours, each with an "automatic" option. It saves instantly
into `config.json` (`project_icons`, by name, so adding sprites later never changes your
choice) and updates every screen at once.

## Save and share a summary

Inside a summary, next to "copy path", there are two buttons:

- **Save as markdown** — opens the system "save as" dialog with the summary's own file
  name. It comes out **without frontmatter** and with the title on top: it is a document
  to send to someone, not to index again.
- **Share** — copies the markdown for Slack, Teams or Discord (they understand it when
  pasted), copies the plain text, or opens X, LinkedIn or email **with the text already
  filled in**. Facebook doesn't allow prefilling a post from outside: the text is copied
  and Facebook is opened so you can paste it. Where the webview offers the system share
  sheet, it is there too.

Both use what is in the editor at that moment, unsaved changes included. Opening those
addresses goes through `tauri-plugin-opener` with a scoped permission: only the four
share addresses are allowed, no other URL and no files.

A whole project can also be **exported to a single markdown** from the project header, to
show the journal to someone who doesn't have SaveMe. If a summary couldn't be read, the
document says so instead of looking complete.

## The project pulse

The journal holds much more than a list shows. Each project has its **pulse**, at
`/p/<project>/actividad`:

- **Where we left off** — the latest activity, the files that were touched and the
  proposals still waiting for a decision, expired ones included. It is the screen that
  answers the question of someone coming back to a project after two weeks.
- **The activity map** — a year of work per day, with intensity measured against the
  busiest day of the project itself and not against a made-up number: in a journal with
  three entries a month, scaling against a fixed 10 would paint the whole map in the
  faintest colour. You can look at 90 days, 6 months or a year.

And the **release notes**:

```bash
saveme changelog --project my-app --since 2026-02-01 --until 2026-02-28
saveme changelog --project my-app --json          # the data, for a script
```

It outputs markdown grouped by category in taxonomy order. In the app it is the button in
the project header: you pick the range, you see **how many entries will come out before
saving**, and the file goes wherever you say. It is what `git log` doesn't give you: human
sentences per feature, fix and chore.

Both doors —the CLI and the UI— share what goes in and in which order, decided by the core;
the only difference is the language of the headings, because a command-line program has no
UI language to ask. And `--until` includes the whole day: asking for "up to the 14th" and
leaving out what was written on the 14th is the classic date bug.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Core | One Go binary with `serve` / `mcp` / `reindex` / `guide` / `doctor` / `mcp-config` / `changelog` subcommands | The app and the MCP server **are the same program**: they can't drift apart on business rules. The MCP server doesn't depend on the daemon, so it works with the app closed |
| Deleting | Deleting archives: the file goes to `.saveme/trash/<stamp>/<original path>`, and the trash can be viewed, restored and emptied from Settings | The expensive mistake is an accidental delete, not used disk space. Restoring **never overwrites** a newer file: it refuses with a 409 and says so |
| Living journal | The agent can **update** a summary, not only add one: `propose` takes a `target` and confirming rewrites the file in place | A journal that can only append decays: iterating on the same thing leaves you with ten near-identical entries. The proposal stores the file hash when it is made, so if someone touched the file in between nothing is overwritten |
| Reviewing updates | A proposal that rewrites an existing summary shows the diff before approving | Updating replaces the whole body; approving it by reading only the new text is approving blind |
| Reversibility | MCP configuration can be undone: `POST /api/mcp/unconfigure` or `mcp-config --remove`, per client | Writing to another program's config file means being able to put it back. Only the `saveme` entry is removed, with a backup, and the binary is never touched |
| Writing guide | One guide in embedded markdown (`internal/mcpserver/guide.md` + `writing.md`), served by the MCP resource, the API and `saveme guide` | Two copies of the instructions end up saying different things. The writing part is shared by the guide and the prompt |
| Translucency | A 20%–100% setting that lets you see what is behind the window | It rewrites a single colour token, so it follows the theme. **It costs the Mac App Store**: on macOS it needs a private Apple API. It ships as a DMG, and that is noted in the code |
| Background image | Global image plus per-project overrides in `config.json`; the image is uploaded to the core and stored by content hash | The original file can move or disappear without breaking the background. A theme-coloured veil with opacity `1 - visibility` blends the image toward the theme, not toward transparency, so text keeps its contrast |
| Window | macOS in `Overlay` mode with a hidden title: the app's top bar **is** the title bar | No grey system strip. The traffic lights are still the native ones —no custom buttons—, they just float over the UI; that's why it reserves 78px and drags with `data-tauri-drag-region` (with its explicit permission, which the default doesn't include) |
| Shell | Tauri v2 with no domain logic | It only launches the sidecar, tells the UI which port it ended up on and kills it on exit |
| Shell permissions | The webview gets the updater, restart, the "save as" dialog, notifications and the scoped share opener; files are written by a single `save_text_file` command | No filesystem plugin and no `opener:default`: the webview can't read the disk or open arbitrary URLs |
| Status bar | A bottom strip with the shortcuts **of the current screen** and the workspace root | `?` lists every shortcut, but without telling which apply here, and a bar announcing `⌘S` in the inbox is lying: that shortcut only exists with the summaries editor in front. The root wasn't visible anywhere else in the UI, and it is exactly what you need when someone moves the folder |
| Index | Derived SQLite (`modernc.org/sqlite`, no CGO) with FTS5 | It can be deleted: `POST /api/reindex` rebuilds it from disk |
| Truth | The `.md` on disk; the index is a cache | You edit with vim, an agent writes with the app closed, and everything shows up when you open it |
| Writing files | Atomic (temp file + `rename`) and never overwrites | A concurrent reader sees either the whole old file or the whole new one |
| Categories | 11 fixed folders per project: feature, fix, perf, security, chore, refactor, docs, infra, design, research, incident | Whoever writes never has to choose between "create folder" and "save". `perf` and `security` exist because a speed-up isn't a fix or a refactor, and security work should be findable on its own |
| Inference | Weighted lexical signals, with Spanish stems | "Implementamos", "arreglamos", "actualizamos" classify well; it never decides silently |
| Editor | CodeMirror 6 with Obsidian-style **Live Preview** + reading pane | Exact round trip: the markdown on disk is never transformed, delimiters are only hidden off the cursor's line |
| Prose | System sans in the document, monospace in the chrome | The document reads like GitHub/Notion; the app keeps its terminal identity |
| Packages | bun | A single binary, `bun install` in ~2 s, no postinstall that gets stuck |
| Search | FTS5 with column-weighted bm25 ranking, falling back to LIKE | The title weighs more than a tag; if the build has no FTS5, it still works |
| Themes | Seventeen complete palettes (`phosphor`, `amber`, `green`, `ice`, `plasma`, `paper`, `solarized`, `gruvbox`, `nord`, `mono`, `plain`, `dracula`, `tokyo-night`, `catppuccin`, `onedark`, `kanagawa`, `ember`), not a toggle for one effect | Each theme declares its 31 tokens in `html[data-theme]`; WCAG contrast is checked by `verify:themes`, because seventeen palettes can't be reviewed by eye |
| Pulse | Each project has its activity screen: briefing, a year-long map and release notes | The journal holds much more than a list shows. The briefing answers "where did we leave off?"; the map measures intensity against the busiest day **of the project itself** and not against a made-up number, which in a journal with three entries a month would paint everything in the faintest colour |
| Language | Spanish and English with an in-house typed dictionary, no dependencies | English is declared against the shape of Spanish: a missing translation or a lost `{placeholder}` breaks `tsc`, not the screen. Core errors are translated by **code**, not by text |

## The "always ask" guarantee

The hard requirement is that **a summary is never written without a person deciding
where**. It rests on three layers, from strongest to weakest:

1. **Structural.** `saveme_summary_propose` doesn't touch the disk. The only writer is
   `saveme_summary_confirm`, and it requires a live, single-use token with a 15-minute
   TTL. Single use is enforced by an `UPDATE ... WHERE status = 'pending'` in SQLite, so
   it holds up against races between processes.
2. **Protocol.** If the MCP client declares elicitation support, SaveMe asks the user
   directly —with the proposed path and three concrete alternatives— and **the user's
   answer overrides whatever the agent says**. It works with new clients (MRTR / SEP-2322)
   and older ones, because the SDK translates between them.
3. **Audit.** Without elicitation, the agent declares the decision after asking in the
   chat. `resolved_via: agent_chat` is recorded so you can later tell "a person approved
   it" from "the agent said yes".

Pending proposals show up in the app's **Inbox**, so you can also approve or redirect
them without going back to the chat.

## Layout

```
backend/           Go core: domain, store, service, api, mcp, mcpconfig, watch
frontend/          React 19 + TanStack Router/Query + shadcn, terminal look
src-tauri/         desktop shell (sidecar + window)
docs/ARCHITECTURE.md   frozen contracts: API, MCP tools, frontmatter, SQL schema
docs/MCP-SETUP.md      configuring the MCP server in each client
docs/MCP-BLUEPRINT.md  how the MCP server works inside, and how to reuse it in another project
docs/RELEASING.md      publishing a version, step by step
scripts/env.sh     redirects build caches to a temporary directory
scripts/e2e.sh     end-to-end verification against the real binary
scripts/mcp-smoke.py  minimal stdio MCP client, to test without an agent
```

## Data and configuration

| Data | Path |
| --- | --- |
| Summaries | `~/Documents/SaveMe` (configurable) |
| Preferences | `~/Library/Application Support/SaveMe/config.json` |
| Index | `<root>/.saveme/saveme.db` |
| Trash | `<root>/.saveme/trash/` (deleting archives, it doesn't destroy) |
| Background images | `backgrounds/` next to `config.json`, named `<16 hex of sha256>.<ext>` |
| MCP binary | `~/.saveme/bin/saveme` (refreshed on every app update) |

Environment variables: `SAVEME_ROOT` (wins over the config), `SAVEME_PORT`,
`SAVEME_CONFIG`, and `SAVEME_CORE_VERBOSE=1` so the shell forwards the core log with the
HTTP requests (useful to debug the UI).

## Continuous integration

The suites and the packaging recipe live in two **reusable** workflows (`tests.yml` and
`instalables.yml`). `ci.yml` calls them on every push to `main` and on every pull request;
`release.yml` calls them to publish. That way the list of suites and the packaging recipe
exist only once and can't drift apart over time.

- **Tests** (Ubuntu): the suites —Go with `-race`, Rust, types, Live Preview, translations,
  CSS order, themes, Mermaid, the notes tree, diff, export, share, background image, project icons, release notes and the
  icon—, version consistency, and the end-to-end verification against the real binary.
- **Installers**: a matrix with macOS, Windows and Linux that packages the native
  installers and uploads them as downloadable artifacts. **The macOS one is universal**: a
  single `.dmg` with Intel and Apple Silicon, so nobody has to choose. That means compiling
  the core **twice** —once per architecture— and having Tauri join them with `lipo`; with a
  single sidecar, the `.dmg` builds and the app doesn't start on the other half of Macs.

**Tauri only builds installers for the platform it runs on** —a `.dmg` on macOS, an `.msi`
on Windows, a `.deb` on Linux—, so there is no way to produce all three from one runner.
Hence the matrix; each runner also compiles its own Go binary, which goes inside as the
sidecar.

The installers job **depends** on the tests job: nothing gets packaged that hasn't passed
first, because a broken installer on the downloads page is worse than no installer.

## Publishing a version

The usual way, from the GitHub web UI: **Releases → Draft a new release**, pick a new tag
`v0.2.0` and publish. GitHub creates the tag, and the tag triggers `release.yml`, which runs
the suites, packages on the three systems and attaches the installers to that Release. The
files show up on the Release page a few minutes after publishing.

The other door, **Actions → Release → Run workflow**, typing the version (`0.2.0`). There
the tag doesn't exist yet, so the workflow creates it.

**The app updates itself.** On launch it asks for the latest release and, if there is a new
version, shows a notice at the bottom right with a button to download and install it without
leaving the app. Updates are signed and the signature is verified before installing, so
nobody controlling the network can slip in their own binary. If the check fails —no network,
for example— the app says nothing: there is nothing the user could do.

The tag rules: its version is written into `tauri.conf.json`, `Cargo.toml` and
`package.json`, and injected into the Go binary. **Nothing is published until all three
systems have packaged**, so a failure on Windows doesn't leave a half-done Release with only
the `.dmg`.

Step-by-step details, and what to do when something fails: [`docs/RELEASING.md`](docs/RELEASING.md).

## Status

Verified:

- `go test -race ./...` — domain, store, service, MCP configuration and the MCP server (19
  MCP tests drive a real client against a real server, including the round trip of asking
  the user).
- `bash scripts/e2e.sh` — 54 checks on the binary: two phases, cross-process visibility,
  confirmation over HTTP, edit conflicts, SSE, the project pulse, and the "the agent writes
  with the app off" path.
- `bun run --cwd frontend typecheck` and `bun run --cwd frontend build`.
- `bun run --cwd frontend verify:live-preview` — 32 checks on the Live Preview logic without
  a browser: what gets hidden, what gets styled, where widgets go and when a fence becomes a
  diagram.
- `bun run --cwd frontend verify:notes` — 30 checks on the notes tree and the drag rules:
  composition, empty folders, and when moving something is illegal.
- `bun run --cwd frontend verify:mermaid` — that Mermaid is still loaded **lazily** (a static
  `import` would put it in the initial bundle without failing anything), that the theme tokens
  it asks for exist, that the component classes are in the CSS and that markdown routes
  diagrams.
- `bun run --cwd frontend verify:themes` — **17 themes × 31 tokens**, plus the window opacity
  conversion. It checks that every offered theme has its colours, that there are no orphan
  themes, that none half-inherits another's palette, and **measures WCAG 2.1 contrast** for
  each one, including highlighted code on its background.
- `bun run --cwd frontend verify:css` — makes sure a custom CSS class doesn't override
  (`position`, `display`) a Tailwind utility on the same element. That was the bug that left
  the command palette stuck to the bottom and Settings off screen: `styles.css` comes after
  Tailwind and, at equal specificity, the custom class wins.
- `bun run --cwd frontend verify:i18n` — 26 checks on translations: parity of both
  dictionaries (**912 keys each**), empty strings, lost `{placeholders}`, incomplete plurals,
  and the real runtime (that the provider returns the requested language, interpolates, and
  translates core errors by code).
- `bun run --cwd frontend verify:diff` — 63 checks on the proposal diff, including the
  property that defines a correct diff: applying it rebuilds both texts.
- `bun run --cwd frontend verify:export` — 24 checks on the project export: nothing gets lost
  on the way and the file name can be saved.
- `bun run --cwd frontend verify:changelog` — 28 checks on the release notes, a file that
  leaves the app and is read outside it: no entry gets lost, the summary line stays indented
  as a continuation of its bullet —otherwise markdown reads it as a loose paragraph— and the
  file name can be saved.
- `bun run --cwd frontend verify:share` — 33 checks on what comes out when saving or sharing
  a summary: no frontmatter leaks, the plain text doesn't swallow content (inline code keeps
  its `_`), the X post fits its limit and **every share address matches the shell
  permission**: if it didn't, the button would do nothing.
- `bun run --cwd frontend verify:background` — 28 checks on the background image: which
  image wins (project or global), how strongly it shows on each screen, what counts as a
  screen with a document, the effect maths (dither levels, ASCII ramp, ink in dark and light
  themes) and the cover-fit framing.
- `bun run --cwd frontend verify:sprites` — 24 checks on the project icons: every sprite is
  rectangular, symmetric and filled, no two are equal, names are unique, core-valid and
  translated, a user choice combines with the automatic one (shape or colour alone, unknown
  names fall back), the hash matches FNV-1a test vectors (if it changed, every project would
  get a new icon on update) and the slug spread uses every shape and colour.
- **The app actually running**: the Tauri shell launches the sidecar, injects the port, and
  the core log shows the UI mounting and requesting its data (`/api/config`,
  `/api/categories`, `/api/projects`, `/api/proposals`, `/api/stats`, all 200) plus the SSE
  stream held open.

Pending: an **aesthetic** review by eye. Runtime behaviour is verified; whether you like how
it looks is not.

## Next step

```bash
make dev
```

If it's your first time, create a project with `Cmd+K` and ask your agent for a summary of
the last thing you did.
