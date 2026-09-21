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
#   resources/agent/app/        the runtime — `dist/` plus the packages esbuild
#                               could not bundle, which means the natives
#   resources/agent/install.json  what revision this was built from
#
# **Node ships, and it has to.** `better-sqlite3` is a native module, and a
# native module is built for exactly one Node ABI — so the node that built this
# tree is the only node that can run it, and it is copied in beside the launcher.
# See the note further down for the measurement that made this a bug rather than
# a preference.
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

# **The runtime needs `dist/` and a handful of packages, and this used to stage
# the whole production closure instead.** `pnpm install --prod` inside the copy
# resolved every dependency of every workspace package: 36,848 files and 554MB,
# of which the shipped CLI reads almost none — it runs `dist/`, which already
# carries every JavaScript dependency inlined. What a bundle cannot carry is a
# **native** module, because its `.node` is a binary and not a module — so this
# stages exactly the packages esbuild marked `external`, read off the build's own
# metafile rather than from a list here that would age.
#
# Cost of the old shape was not disk but **the installer**: NSIS and its Windows
# counterpart extract file by file, so 32,077 files is minutes of progress bar
# (`Extract: agent\app\node_modules\@smithy\core\…`), where ~800 is seconds.
INSTALL_NODE="$(cat "$AGENT/.node-runtime" 2>/dev/null || command -v node)"
[ -x "$INSTALL_NODE" ] || { echo "no node to stage (looked at $INSTALL_NODE)" >&2; exit 1; }

# The built JS is the tree. Its own `package.json` rides inside `dist/`, which is
# what tells node the chunks are ESM.
cp -R "$AGENT/dist" "$DEST/app/dist"

"$INSTALL_NODE" - "$AGENT" "$DEST/app" <<'STAGE_EXTERNALS'
const fs = require('node:fs');
const path = require('node:path');

const [agent, app] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(path.join(agent, 'dist/metafile.json'), 'utf8'));

// esbuild lists node's own modules as external too; only npm packages can be
// missing from a bundle, and only those need a directory beside it.
const builtin = /^(node:)?(fs|path|os|util|crypto|stream|events|buffer|net|http|http2|https|tls|zlib|url|assert|child_process|worker_threads|perf_hooks|async_hooks|module|process|readline|string_decoder|tty|dns|dgram|vm|v8|inspector|constants|timers|querystring|punycode|sys|domain|repl|cluster|trace_events|diagnostics_channel|wasi|sea|sqlite|console)(\/.*)?$/;

const roots = new Set();
for (const output of Object.values(meta.outputs ?? {})) {
  for (const imported of output.imports ?? []) {
    if (imported.external && !builtin.test(imported.path)) {
      // `@scope/name/sub` and `name/sub` both name the package.
      const parts = imported.path.split('/');
      roots.add(imported.path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  }
}

// A package's own dependencies are not bundled either, and nothing in the
// metafile says so — `bindings` is what resolves `better_sqlite3.node`, and it
// arrives as a dependency of a package that was marked external. So the walk
// follows each manifest, which is the only statement of who needs whom.
//
// **A package for another platform is skipped**, which is the statement its own
// manifest makes: `clipboard` installs ten variants and a bundle needs the one
// the runner is on. `os`/`cpu` are the two fields that carry it.
const copied = new Set();
const copy = (name) => {
  if (copied.has(name)) return;
  copied.add(name);
  const from = path.join(agent, 'node_modules', name);
  if (!fs.existsSync(from)) return; // an optional dependency this platform did not install
  const manifest = path.join(from, 'package.json');
  if (!fs.existsSync(manifest)) return;
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const oneOf = (field, value) => !pkg[field] || [].concat(pkg[field]).includes(value);
  if (!oneOf('os', process.platform) || !oneOf('cpu', process.arch)) {
    copied.delete(name); // not for this runner, and its dependents still are
    return;
  }

  const to = path.join(app, 'node_modules', name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });

  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) copy(dep);
};

for (const name of roots) copy(name);

// The platform halves of a package installed as one-of-many — `clipboard` ships
// a `-darwin-arm64` beside it — are chosen by the install, so whatever is on
// disk here is what belongs on disk there.
for (const entry of fs.readdirSync(path.join(agent, 'node_modules')).filter((n) => n.startsWith('@'))) {
  for (const sub of fs.readdirSync(path.join(agent, 'node_modules', entry))) {
    if (roots.has(`${entry}/${sub}`)) continue;
    if (![...roots].some((r) => `${entry}/${sub}`.startsWith(`${r}-`))) continue;
    copy(`${entry}/${sub}`);
  }
}

console.log(`staged ${copied.size} package(s): ${[...copied].sort().join(', ')}`);
STAGE_EXTERNALS

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
#
# **And it has to be a node that travels.** `cp` of one file is only enough for a
# node built to stand alone — the tarball from nodejs.org, which is what
# `actions/setup-node` installs. A Homebrew node is not that: measured here, its
# `bin/node` is 50KB and links `libnode.137.dylib` plus libuv, simdjson, brotli
# and c-ares **by absolute `/opt/homebrew/opt/…` path**, so the copy resolves to
# nothing on any other machine — and the failure surfaces as an installer that
# finished, an app that opens, and an agent that never answers. So the copy is
# run once, here, where the cure is still cheap to apply.
cp "$INSTALL_NODE" "$DEST/bin/node"
chmod +x "$DEST/bin/node"

# **And it has to be readable by the build, which a `com.apple.provenance`
# xattr stops it from being.** A node copied out of a downloaded tarball carries
# that attribute, and `tauri-build` reads every file under `resources/` to decide
# what to rebuild — so it died with a bare `Permission denied (os error 13)` and
# no file named, on every local `cargo` command, while CI (which never had the
# xattr) built the very same tree. Stripped here rather than explained there.
if command -v xattr >/dev/null 2>&1; then
  xattr -c "$DEST/bin/node" 2>/dev/null || true
fi
if ! "$DEST/bin/node" -e 'process.exit(0)' >/dev/null 2>&1; then
  cat >&2 <<EOF
the node at $INSTALL_NODE cannot be shipped: it does not run from the copy.

It is almost certainly a Homebrew node, which is a thin binary plus dylibs at
absolute paths. Stage a self-contained one instead — the build from nodejs.org,
or whatever \`actions/setup-node\` installs — by putting it first on PATH and
re-running this script.
EOF
  exit 1
fi

# **And the native module has to load under it.** A node that runs is not the
# same as a node that can load what was built beside it: `better-sqlite3` is
# compiled for one ABI, and `pnpm install` does not rebuild a module that is
# already there — so a tree installed under one node and staged under another
# carries a `.node` the runtime refuses, as `NODE_MODULE_VERSION 147 … requires
# 137`. That is the same trap as the one above, one step further along, and it
# surfaces identically: an installer that finished, an app that opens, an agent
# that never answers.
#
# The check opens a database and not merely the module: `better-sqlite3` binds
# its addon on the first instance, so `require` alone succeeds against a binary
# the agent will refuse a moment later.
if ! (cd "$DEST/app" && "$DEST/bin/node" -e "new (require('better-sqlite3'))(':memory:')" >/dev/null 2>&1); then
  echo "the native SQLite module in $DEST does not load under the node beside it" >&2
  echo "rebuild it with that node: (cd '$AGENT' && rm -rf node_modules/better-sqlite3/build && \\" >&2
  echo "  PATH=\"$(dirname "$INSTALL_NODE"):\$PATH\" pnpm rebuild better-sqlite3)" >&2
  exit 1
fi

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
