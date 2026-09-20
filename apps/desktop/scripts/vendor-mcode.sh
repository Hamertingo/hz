#!/usr/bin/env bash
# Stage the agent into the app bundle, so hz is one download.
#
# **This is what makes a fresh install: open hz, configure a provider, pick a
# model.** Nothing to install first and nothing to keep in step by hand — the
# app ships the CLI it runs, the Node runtime that CLI needs, and every native
# dependency, rather than borrowing whatever `mcode` the reader happens to have
# on their PATH. Without it the version on screen is decided by an accident of
# somebody's shell, and the app is not usable until they have run an installer
# they were never told about.
#
# It runs MiniMax's own installer rather than copying files, and that is the
# whole design: the runtime it needs is a *pinned, checksummed* Node build, the
# CLI has a native SQLite dependency whose install script npm blocks by default
# (the trap its own error message documents), and its launcher is written by the
# thing that knows where it put everything. A hand-rolled copy of the same tree
# gets the CLI without any of that and fails on `provider list` — measured.
#
# The installed copy is read by `binpath::bundled_mcode`, which looks for
# `Contents/Resources/mcode/bin/mcode` — the path the installer writes its own
# launcher to. That is not a coincidence to preserve: it is the contract.
#
# usage: scripts/vendor-mcode.sh [--force]
#
# Run it before `pnpm tauri build`. The staged tree is gitignored — build
# output, not source — and it is ~230MB, which is what a self-contained agent
# costs.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/src-tauri/resources/mcode"
INSTALLER_URL="${HZ_MCODE_INSTALLER:-https://filecdn.minimax.chat/public/install.sh}"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -x "$DEST/bin/mcode" ] && [ "$FORCE" != "1" ]; then
  echo "already staged: $("$DEST/bin/mcode" --version 2>/dev/null || echo unknown)"
  echo "pass --force to fetch it again"
  exit 0
fi

echo "fetching $INSTALLER_URL"
INSTALLER="$(mktemp -t hz-mcode-installer)"
trap 'rm -f -- "$INSTALLER"' EXIT
curl -fsSL -o "$INSTALLER" "$INSTALLER_URL"

echo "installing into $DEST"
mkdir -p "$DEST"

# Three environment facts, each load-bearing:
#
# - `MCODE_INSTALL_DIR` is where the tree lands, and it is inside the bundle so
#   the app resolves it before anything on `PATH`.
# - `MCODE_NO_MODIFY_PATH` keeps the installer from writing to the reader's
#   shell profiles. A build step that edits somebody's `.zshrc` on their behalf
#   is a build step doing something it was not asked to do, and the app does not
#   need the CLI on `PATH` to spawn it.
# - the mirror is left at its default (official sources). A vendored copy is
#   what every reader of a release gets, so it should be what the vendor
#   publishes rather than what is fastest from the machine that built it.
MCODE_INSTALL_DIR="$DEST" \
MCODE_NO_MODIFY_PATH=1 \
  bash "$INSTALLER"

[ -x "$DEST/bin/mcode" ] || {
  echo "the installer finished without a launcher at $DEST/bin/mcode" >&2
  exit 1
}

echo "staged: $(du -sh "$DEST" | cut -f1) — $("$DEST/bin/mcode" --version)"
echo "the app resolves this before anything on PATH — see binpath::bundled_mcode"
