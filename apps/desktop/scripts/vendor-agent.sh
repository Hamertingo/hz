#!/usr/bin/env bash
# Stage the agent into the app bundle, so hz is one download.
#
# **This is what makes a fresh install: open hz, configure a provider, pick a
# model.** Nothing to install first and nothing to keep in step by hand — the
# app ships the CLI it runs and every dependency that CLI needs, rather than
# borrowing whatever `mcode` the reader happens to have on their PATH. Without
# it the version on screen is decided by an accident of somebody's shell, and the
# app is not usable until they have run an installer they were never told about.
#
# **It stages *this repository's* build, and that is the whole of the change.**
# It used to run MiniMax's own installer, which produced a correct tree and the
# vendor's code — so anything patched under `apps/agent` was discarded on the way
# into the bundle, silently, by the step whose job is to put the agent there.
# The source is ours, the patch is ours, and the stage has to be ours too.
#
# The layout is written here rather than borrowed:
#
#   resources/agent/bin/hz-agent   a launcher, and the path `binpath::bundled_mcode`
#                               resolves — that name is the contract
#   resources/agent/app/        the built tree, dependencies pruned to production
#   resources/agent/install.json  what revision this was built from
#
# **Node is found, not shipped.** The runtime is ~50MB per platform and the
# agent's own launcher resolves a `node` the way `binpath` resolves `mcode`:
# PATH, then the directories a version manager installs into, then a login shell.
# A release built on a machine whose node no reader has is the failure that
# pinning used to cause — the installer wrote an absolute Homebrew cellar path
# into the launcher, which works on the builder and nowhere else.
#
# usage: scripts/vendor-agent.sh [--force]
#
# Run it before `pnpm tauri build`. The staged tree is gitignored — build output,
# not source, and it is a few hundred megabytes, which is what a self-contained
# agent costs.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT="$ROOT/../agent"
DEST="$ROOT/src-tauri/resources/agent"
FORCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ -f "$DEST/install.json" ] && [ -x "$DEST/bin/hz-agent" ] && [ "$FORCE" != "1" ]; then
  echo "already staged: $(node -p "require('$DEST/install.json').version" 2>/dev/null || echo unknown)"
  echo "pass --force to build it again"
  exit 0
fi

command -v pnpm >/dev/null 2>&1 || { echo "pnpm is required to build the agent" >&2; exit 1; }

echo "building the agent from $AGENT"
(cd "$AGENT" && pnpm install --frozen-lockfile && pnpm build)

[ -f "$AGENT/dist/cli.js" ] || { echo "the build left no $AGENT/dist/cli.js" >&2; exit 1; }

# The staged tree is replaced whole: a stale chunk left beside a fresh one is an
# agent that half-updated, and nothing here can tell which half it is running.
echo "staging into $DEST"
rm -rf "$DEST"
mkdir -p "$DEST/bin" "$DEST/app"

# The source, less everything already built. `pnpm install --prod` inside the
# copy is what keeps the bundle from carrying TypeScript, Vitest and Esbuild —
# the toolchain that built the agent is not the agent.
(cd "$AGENT" && tar -cf - --exclude=node_modules --exclude=dist --exclude=.git .) |
  (cd "$DEST/app" && tar -xf -)

# **The node that installed the source tree installs the copy too.** A native
# module is built for one Node ABI, and both installs have to agree on it or the
# staged tree carries a `better_sqlite3.node` the staged runtime refuses — which
# is exactly how this broke the first time. `pin-node.mjs` wrote down which node
# that was; its directory goes on `PATH` so the tooling underneath agrees.
INSTALL_NODE="$(cat "$AGENT/.node-runtime" 2>/dev/null || command -v node)"
[ -x "$INSTALL_NODE" ] || { echo "no node to stage (looked at $INSTALL_NODE)" >&2; exit 1; }

# `onlyBuiltDependencies` in the tree's own package.json is what lets the two
# native modules build; nothing here needs to override it.
(cd "$DEST/app" && PATH="$(dirname "$INSTALL_NODE"):$PATH" pnpm install --prod --frozen-lockfile)

# The built JS is not a dependency, so it comes over after the install decides
# what the production tree is.
cp -R "$AGENT/dist" "$DEST/app/dist"

# **The source was scaffolding and goes.** `pnpm install` needed the workspace
# manifests to resolve the tree; the runtime needs `dist/`, which the build
# bundled, and the packages npm still owns. Keeping the rest cost ~70MB of
# TypeScript nobody in a bundle will ever read — and nothing points back at it:
# the only symlinks under `node_modules` are the `.bin` shims, and the shipped
# CLI never reaches for a workspace path.
#
# The licences stay, because what is redistributed still has to carry them.
rm -rf \
  "$DEST/app/packages" \
  "$DEST/app/third_party" \
  "$DEST/app/scripts" \
  "$DEST/app/test" \
  "$DEST/app/docs" \
  "$DEST/app/examples"

# **The runtime ships with the agent, and it has to.** Two reasons, and the
# second is what made this a bug rather than a preference:
#
# - A `.app` opened from Finder inherits launchd's PATH, which holds none of the
#   places a version manager installs a node — so resolving one from PATH is a
#   release that works on the machine that built it.
# - `better-sqlite3` is a native module and a native module is built for exactly
#   one Node ABI. Whatever installed the tree is the only node that can run it,
#   and `PATH` is free to find a different one: measured here, a module built
#   under Node 26 (ABI 147) was refused by the Node 24 a launchd PATH reaches
#   first, as `NODE_MODULE_VERSION 147 … requires 137`.
#
# So the node that ran `pnpm install` is copied in beside the launcher, and that
# is the node the bundle uses. `pin-node.mjs` is what records which one that was.
cp "$INSTALL_NODE" "$DEST/bin/node"
chmod +x "$DEST/bin/node"

cat > "$DEST/bin/hz-agent" <<'LAUNCHER'
#!/bin/sh
# The agent, as this bundle ships it.
#
# The node beside this launcher is the one that built the tree's native module,
# so it is the one that can load it — never a node off PATH, which is a
# different ABI more often than not. The fallback is for a staged tree somebody
# pruned by hand, and it is a fallback rather than the rule.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)

node_bin="$root/bin/node"
[ -x "$node_bin" ] || node_bin=$(command -v node 2>/dev/null || true)
[ -n "$node_bin" ] || {
  echo "hz could not find the node its agent runs on." >&2
  exit 1
}

exec "$node_bin" "$root/app/dist/cli.js" "$@"
LAUNCHER
chmod +x "$DEST/bin/hz-agent"

node - "$DEST" "$AGENT" <<'WRITE_MANIFEST'
const fs = require('node:fs');
const [dest, agent] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${agent}/${name}`, 'utf8'));

// What this tree was built from — not an npm package. Named so a machine
// carrying both cannot confuse the copy inside the bundle with an installed one,
// and so a build left half-staged can be told from a fresh one by its revision.
fs.writeFileSync(
  `${dest}/install.json`,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      product: 'minimax-code',
      builtFrom: 'apps/agent',
      version: read('package.json').version,
      sourceRevision: read('release/extraction.json').sourceRevision,
    },
    null,
    2,
  )}\n`,
);
WRITE_MANIFEST

du -sh "$DEST"
echo "staged: $("$DEST/bin/hz-agent" --version) — the app resolves this before anything on PATH"
