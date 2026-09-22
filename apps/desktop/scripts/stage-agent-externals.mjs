// Stage the packages the agent's bundle cannot carry, and nothing else.
//
// **One implementation, called by both launchers** — `vendor-agent.sh` for the
// macOS bundle and `vendor-agent.mjs` for the Windows one. They are separate
// scripts because the launchers differ (`#!/bin/sh` against a built `.exe`), but
// the tree they stage is the same tree, and it was staged by two copies of this
// logic until the Windows one was found still running `pnpm install --prod`:
// 32,000 files and 524MB for a runtime that reads `dist/`, which NSIS then
// extracted one file at a time while the installer sat there.
//
// What ships is `dist/` — which already carries every JavaScript dependency
// inlined — plus the packages esbuild marked `external`, read off the build's own
// metafile rather than from a list kept here that would age. A bundle cannot
// carry a native module, because its `.node` is a binary and not a module, so
// those are exactly what has to travel beside it.
//
// usage: node stage-agent-externals.mjs <agent-root> <staged-app-dir>

import fs from 'node:fs';
import path from 'node:path';

const [agent, app] = process.argv.slice(2);
if (!agent || !app) {
  console.error('usage: stage-agent-externals.mjs <agent-root> <staged-app-dir>');
  process.exit(2);
}

const meta = JSON.parse(fs.readFileSync(path.join(agent, 'dist/metafile.json'), 'utf8'));

// esbuild lists node's own modules as external too; only npm packages can be
// missing from a bundle, and only those need a directory beside it.
const BUILTIN =
  /^(node:)?(fs|path|os|util|crypto|stream|events|buffer|net|http|http2|https|tls|zlib|url|assert|child_process|worker_threads|perf_hooks|async_hooks|module|process|readline|string_decoder|tty|dns|dgram|vm|v8|inspector|constants|timers|querystring|punycode|sys|domain|repl|cluster|trace_events|diagnostics_channel|wasi|sea|sqlite|console)(\/.*)?$/;

const roots = new Set();
for (const output of Object.values(meta.outputs ?? {})) {
  for (const imported of output.imports ?? []) {
    if (imported.external && !BUILTIN.test(imported.path)) {
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
    copied.delete(name); // not for this platform, and its dependents still are
    return;
  }

  const to = path.join(app, 'node_modules', name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });

  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) copy(dep);
};

// The externals themselves, and what each one needs.
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

console.log(`staged ${copied.size} package(s)`);
