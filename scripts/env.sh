#!/usr/bin/env bash
# Entorno de build aislado.
#
# El sandbox de escritura de esta sesión solo permite escribir dentro del repo y en
# las áreas temporales de la plataforma. Las cachés por defecto de Go, bun y Cargo
# viven en $HOME, así que las redirigimos a un área temporal para poder compilar sin
# permisos adicionales y sin llenar el repositorio de gigabytes.
#
# Uso: source scripts/env.sh

SAVEME_CACHE_ROOT="${SAVEME_CACHE_ROOT:-${TMPDIR:-/tmp}/saveme-build-cache}"
export SAVEME_CACHE_ROOT
mkdir -p "$SAVEME_CACHE_ROOT"

# --- Go ---
# Nota: no se define GOFLAGS aquí. El comando `go` la interpreta como lista de
# flags, así que un valor heredado del entorno rompe llamadas como
# `go build -ldflags ...` y produce errores desconcertantes.
export GOPATH="$SAVEME_CACHE_ROOT/go"
export GOMODCACHE="$GOPATH/pkg/mod"
export GOCACHE="$SAVEME_CACHE_ROOT/go-build"
export GOTMPDIR="$SAVEME_CACHE_ROOT/gotmp"
mkdir -p "$GOMODCACHE" "$GOCACHE" "$GOTMPDIR"

# --- Node / bun ---
# bun guarda su caché global en ~/.bun, que el sandbox no deja escribir, así que
# se redirige a un área temporal junto al resto de cachés de build.
export BUN_INSTALL="$SAVEME_CACHE_ROOT/bun"
export BUN_INSTALL_CACHE_DIR="$BUN_INSTALL/install/cache"
export XDG_CACHE_HOME="$SAVEME_CACHE_ROOT/xdg"
export XDG_DATA_HOME="$SAVEME_CACHE_ROOT/xdg-data"
mkdir -p "$BUN_INSTALL_CACHE_DIR" "$XDG_CACHE_HOME" "$XDG_DATA_HOME"

# --- Rust / Cargo ---
# `cargo` es un shim de rustup: RUSTUP_HOME conserva los toolchains ya instalados
# (solo lectura) y CARGO_HOME guarda el registry en el área temporal.
export CARGO_HOME="$SAVEME_CACHE_ROOT/cargo"
mkdir -p "$CARGO_HOME"

# --- SaveMe ---
# En desarrollo los datos viven dentro del repo para no tocar ~/Documents.
export SAVEME_ROOT="${SAVEME_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.saveme-dev}"
