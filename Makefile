# SaveMe — tareas de desarrollo.
#
# Nota sobre el sandbox: si las cachés de Go/bun/Cargo no son escribibles
# (porque viven en $HOME), haz `source scripts/env.sh` antes de invocar make.
# Esa variable se hereda a los subprocesos, así que basta con hacerlo una vez.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# La `v` es del tag, no de la versión: `git describe` sobre el tag `v0.1.0`
# devuelve `v0.1.0`, y la interfaz ya pinta la `v` delante («core listo ·
# v0.1.0»). Sin quitarla aquí, la app enseñaba «v v0.1.0».
VERSION ?= $(shell (git describe --tags --always --dirty 2>/dev/null || echo 0.1.0-dev) | sed 's/^v//')
# Dónde se instala el binario con `make install`. /usr/local puede requerir sudo;
# PREFIX=$HOME/.local no requiere nada.
PREFIX  ?= /usr/local
TRIPLE  ?= $(shell rustc -vV | sed -n 's/^host: //p')
BIN     := backend/bin/saveme
SIDECAR := src-tauri/binaries/saveme-$(TRIPLE)
# Un solo fichero con las dos arquitecturas de macOS, que es lo que Tauri busca
# al empaquetar para `universal-apple-darwin`.
SIDECAR_UNIVERSAL := src-tauri/binaries/saveme-universal-apple-darwin

LDFLAGS := -s -w -X main.version=$(VERSION)

# Clave con la que se firman los paquetes de actualización.
#
# Tauri exige el **contenido** de la clave, no una ruta: si le pasas una ruta la
# interpreta como clave y falla al descifrarla. Por eso se lee al ejecutar el
# target (`$$(cat …)`) y entre comillas, para que las líneas nuevas lleguen
# intactas —el formato de minisign las necesita—.
#
# Con `createUpdaterArtifacts` activo el empaquetado **no funciona sin firmar**,
# así que esto no es opcional para `make dmg` y compañía. La clave se genera con
# `bunx tauri signer generate`; su pública vive en `tauri.conf.json`.
SAVEME_KEY ?= $(HOME)/.tauri/saveme.key
SIGN = TAURI_SIGNING_PRIVATE_KEY="$$(cat $(SAVEME_KEY) 2>/dev/null)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=

.PHONY: help
help: ## Muestra esta ayuda
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.PHONY: setup
setup: ## Instala dependencias de Go, Node y Rust
	cd backend && go mod download
	bun install
	cd src-tauri && cargo fetch

.PHONY: build-core
build-core: ## Compila el core de Go
	cd backend && go build -ldflags "$(LDFLAGS)" -o bin/saveme ./cmd/saveme
	@echo "core listo: $(BIN)"

.PHONY: sidecar
sidecar: build-core ## Copia el core donde Tauri lo espera (con el sufijo del triple)
	@mkdir -p src-tauri/binaries
	cp $(BIN) $(SIDECAR)
	@echo "sidecar listo: $(SIDECAR)"

.PHONY: dev-core
dev-core: build-core ## Corre solo el daemon del core
	$(BIN) serve --verbose

.PHONY: dev-web
dev-web: ## Corre solo el frontend con Vite
	bun run --cwd frontend dev

.PHONY: dev
dev: sidecar ## Corre la app completa en modo desarrollo
	bunx tauri dev

.PHONY: test
test: ## Pruebas de Go y Rust, tipos, Live Preview, traducciones, CSS, temas, Mermaid, notas e icono
	cd backend && go test -race ./...
	cd src-tauri && cargo test --quiet
	bun run --cwd frontend typecheck
	bun run --cwd frontend verify:live-preview
	bun run --cwd frontend verify:i18n
	bun run --cwd frontend verify:css
	bun run --cwd frontend verify:themes
	bun run --cwd frontend verify:mermaid
	bun run --cwd frontend verify:notes
	bun scripts/verify-icon.mjs
	bun scripts/verify-update.mjs
	bun scripts/set-version.mjs --check

.PHONY: test-e2e
test-e2e: ## Verificación end-to-end contra el binario real
	bash scripts/e2e.sh

.PHONY: test-all
test-all: test test-e2e ## Todo

.PHONY: install
install: build-core ## Instala el binario en $(PREFIX)/bin para usarlo como MCP global
	@mkdir -p "$(PREFIX)/bin" 2>/dev/null || { \
		echo "no puedo escribir en $(PREFIX)/bin"; \
		echo "prueba con:  PREFIX=$$HOME/.local make install"; \
		exit 1; }
	install -m 0755 $(BIN) "$(PREFIX)/bin/saveme"
	@echo "instalado: $(PREFIX)/bin/saveme"
	@if command -v saveme >/dev/null 2>&1; then \
		echo "ya está en tu PATH: los clientes MCP pueden lanzarlo como \`saveme\`"; \
	else \
		echo "añade $(PREFIX)/bin a tu PATH para poder escribir sólo \`saveme\`"; \
	fi
	@echo "siguiente paso:  saveme doctor"

.PHONY: mcp-setup
mcp-setup: build-core ## Configura el MCP en tu cliente (PROVIDER=opencode|codex|cursor|...)
	@if [ -z "$(PROVIDER)" ]; then \
		$(BIN) mcp-config --list; \
	else \
		$(BIN) mcp-config --provider $(PROVIDER) --write; \
	fi

.PHONY: reindex
reindex: build-core ## Reconstruye el índice desde los archivos
	$(BIN) reindex

.PHONY: guide
guide: build-core ## Imprime las instrucciones para agentes (para pegar en CLAUDE.md)
	@$(BIN) guide

.PHONY: icon
icon: ## Regenera los iconos desde scripts/make-icon.py
	python3 scripts/make-icon.py src-tauri/icons/icon.png 1024
	bunx tauri icon src-tauri/icons/icon.png

# Sin NEXT solo muestra la version; con NEXT la fija en los tres ficheros. Ojo:
# `VERSION` (arriba) es lo que se inyecta en el binario de Go y sale de
# `git describe`, que no es una version limpia cuando hay commits por delante del
# tag. Por eso este target usa su propia variable.
.PHONY: version
version: ## Muestra la version, o la fija con NEXT=1.2.3
	@if [ -n "$(NEXT)" ]; then \
		bun scripts/set-version.mjs "$(NEXT)"; \
	else \
		bun scripts/set-version.mjs --print; \
	fi

.PHONY: build-app
build-app: sidecar ## Empaqueta solo el .app/.exe (sin instalador)
	$(SIGN) bunx tauri build --bundles app

.PHONY: build
build: sidecar ## Empaqueta la aplicación y sus instaladores nativos
	$(SIGN) bunx tauri build

# Instaladores concretos. Tauri solo puede construir los de la plataforma en la
# que corre: un .dmg se hace en macOS, un .msi en Windows y un .deb en Linux.
.PHONY: dmg
dmg: sidecar ## Instalador .dmg para macOS (el que se arrastra a Aplicaciones)
	$(SIGN) bunx tauri build --bundles dmg

.PHONY: sidecar-universal
sidecar-universal: ## Compila el core para un macOS universal (los dos por-arquitectura y el unido)
	@mkdir -p src-tauri/binaries
	cd backend && GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/saveme-aarch64-apple-darwin ./cmd/saveme
	cd backend && GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/saveme-x86_64-apple-darwin ./cmd/saveme
	# Hacen falta los tres. Tauri compila la app una vez por arquitectura y cada
	# compilación exige el sidecar de ESA arquitectura; después, al empaquetar el
	# universal, busca además uno que ya sea universal y no lo combina él.
	cp backend/bin/saveme-aarch64-apple-darwin src-tauri/binaries/saveme-aarch64-apple-darwin
	cp backend/bin/saveme-x86_64-apple-darwin src-tauri/binaries/saveme-x86_64-apple-darwin
	lipo -create -output $(SIDECAR_UNIVERSAL) \
		backend/bin/saveme-aarch64-apple-darwin \
		backend/bin/saveme-x86_64-apple-darwin
	@echo "sidecar universal listo: $(SIDECAR_UNIVERSAL)"

.PHONY: dmg-universal
dmg-universal: sidecar-universal ## .dmg para Intel y Apple Silicon en un solo archivo
	rustup target add aarch64-apple-darwin x86_64-apple-darwin
	$(SIGN) bunx tauri build --bundles dmg --target universal-apple-darwin

.PHONY: msi
msi: sidecar ## Instalador .msi para Windows
	$(SIGN) bunx tauri build --bundles msi

.PHONY: nsis
nsis: sidecar ## Instalador .exe (NSIS) para Windows
	$(SIGN) bunx tauri build --bundles nsis

.PHONY: deb
deb: sidecar ## Paquete .deb para Debian/Ubuntu
	$(SIGN) bunx tauri build --bundles deb

.PHONY: appimage
appimage: sidecar ## AppImage para Linux
	$(SIGN) bunx tauri build --bundles appimage

.PHONY: clean
clean: ## Borra artefactos de compilación
	rm -rf backend/bin src-tauri/target src-tauri/binaries frontend/dist
