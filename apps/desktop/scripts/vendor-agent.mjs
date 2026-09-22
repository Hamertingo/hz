// Stage the agent into the app bundle, as Windows ships it.
//
// The counterpart of `vendor-agent.sh`, and it exists for the same reason: hz is
// one download, so the CLI it runs and every dependency that CLI needs travel
// inside it. Without this the bundle carries no agent at all, and the app
// refuses to start a session with nothing on screen that says why.
//
// **Written in Node rather than PowerShell, deliberately.** This is the one
// piece of the Windows port that can be exercised on the machine the port is
// being written on — every other half needs a Windows runner — and a script
// that cannot be dry-run before it is pushed to CI is a script debugged by
// twenty-minute CI cycles. It is also cross-platform as written, so macOS can
// adopt it later; it is not wired in there today because the shell script is
// shipped and tested and this port is not the place to replace it.
//
// Three differences from the shell script, all of them the platform:
//
//   bin/hz-agent.exe   the launcher is a *binary* here. See apps/agent-launcher:
//                      `CreateProcess` cannot start a `.cmd`, so the shell
//                      script's shape is not available on Windows at all.
//   bin/node.exe       the runtime is a PE binary — and it is the one that ran
//                      `pnpm install`, which is the only node that can load the
//                      native module the tree built.
//   everything else    identical, including `install.json`.
//
// usage: node scripts/vendor-agent.mjs [--force]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT = path.resolve(ROOT, '..', 'agent');
const DEST = path.join(ROOT, 'src-tauri', 'resources', 'agent');
const LAUNCHER_CRATE = path.resolve(ROOT, '..', 'agent-launcher');

const IS_WINDOWS = process.platform === 'win32';
const EXE = IS_WINDOWS ? '.exe' : '';

const FORCE = process.argv.includes('--force');

/** Runs a command, inheriting stdio, and throws with the command in the message. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    // `pnpm` is a `.cmd` shim on Windows, and Node's spawn will not run one
    // without a shell — the same reason `Command` cannot, one layer out.
    shell: IS_WINDOWS,
    ...options,
  });

  if (result.error) {
    throw new Error(`could not run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
  }
}

/** The version of a package.json, or a phrase saying it could not be read. */
function versionOf(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

// Already staged is the ordinary case — a release job that runs twice, or a
// developer who has built once. Building the whole agent again to learn nothing
// new is minutes.
if (
  !FORCE &&
  fs.existsSync(path.join(DEST, 'install.json')) &&
  fs.existsSync(path.join(DEST, 'bin', `hz-agent${EXE}`))
) {
  console.log(`already staged: ${versionOf(path.join(DEST, 'install.json'))}`);
  console.log('pass --force to build it again');
  process.exit(0);
}

console.log(`building the agent from ${AGENT}`);
run('pnpm', ['install', '--frozen-lockfile'], { cwd: AGENT });
run('pnpm', ['build'], { cwd: AGENT });

const built = path.join(AGENT, 'dist', 'cli.js');
if (!fs.existsSync(built)) {
  throw new Error(`the build left no ${built}`);
}

// The staged tree is replaced whole: a stale chunk left beside a fresh one is an
// agent that half-updated, and nothing here can tell which half it is running.
console.log(`staging into ${DEST}`);
fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(path.join(DEST, 'bin'), { recursive: true });
fs.mkdirSync(path.join(DEST, 'app'), { recursive: true });

// **The node that installed the source tree installs the copy too.** A native
// module is built for exactly one Node ABI, and both installs have to agree on
// it or the staged tree carries a `better_sqlite3.node` the staged runtime
// refuses. `pin-node.mjs` wrote down which node that was; its directory goes on
// `PATH` so the tooling underneath agrees.
const pinned = (() => {
  try {
    return fs.readFileSync(path.join(AGENT, '.node-runtime'), 'utf8').trim();
  } catch {
    return '';
  }
})();

const installNode = pinned && fs.existsSync(pinned) ? pinned : whichNode();
if (!installNode) {
  throw new Error(`no node to stage (looked at ${pinned || 'nothing'})`);
}

// **The built JS, then the packages the bundle cannot carry.** `dist/` already
// has every JavaScript dependency inlined; what it cannot hold is a native
// module, whose `.node` is a binary and not a module. Both come from the same
// script the macOS launcher calls, because until it did the Windows bundle was
// staged by `pnpm install --prod`: 32,000 files and 524MB for a runtime that
// reads `dist/`, extracted one file at a time by NSIS while the reader watched.
fs.cpSync(path.join(AGENT, 'dist'), path.join(DEST, 'app', 'dist'), { recursive: true });
run(installNode, [path.join(ROOT, 'scripts', 'stage-agent-externals.mjs'), AGENT, path.join(DEST, 'app')]);

// The launcher, built rather than copied: on Windows it is the only shape a
// spawn can start, and on any platform it is the one that knows where the node
// beside it is. See apps/agent-launcher.
console.log('building the launcher');
run('cargo', ['build', '--release', '--manifest-path', path.join(LAUNCHER_CRATE, 'Cargo.toml')]);
const launcher = path.join(LAUNCHER_CRATE, 'target', 'release', `hz-agent${EXE}`);
if (!fs.existsSync(launcher)) {
  throw new Error(`the launcher build left no ${launcher}`);
}
fs.copyFileSync(launcher, path.join(DEST, 'bin', `hz-agent${EXE}`));
fs.chmodSync(path.join(DEST, 'bin', `hz-agent${EXE}`), 0o755);

// **The runtime ships with the agent, and it has to.** A `.exe` opened from
// Explorer inherits a `PATH` that holds none of the places a version manager
// installs a node, so resolving one from `PATH` is a release that works on the
// machine that built it. And the native module above pins the ABI besides.
fs.copyFileSync(installNode, path.join(DEST, 'bin', `node${EXE}`));

// What this tree was built from — not an npm package. Named so a machine
// carrying both cannot confuse the copy inside the bundle with an installed one,
// and so a build left half-staged can be told from a fresh one by its revision.
fs.writeFileSync(
  path.join(DEST, 'install.json'),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      product: 'minimax-code',
      builtFrom: 'apps/agent',
      version: versionOf(path.join(AGENT, 'package.json')),
      sourceRevision: JSON.parse(
        fs.readFileSync(path.join(AGENT, 'release', 'extraction.json'), 'utf8'),
      ).sourceRevision,
    },
    null,
    2,
  )}\n`,
);

// The last line is the one worth reading: it is the same resolution the app
// makes at spawn time, so a tree that cannot answer here cannot answer there.
const staged = spawnSync(path.join(DEST, 'bin', `hz-agent${EXE}`), ['--version'], {
  encoding: 'utf8',
});
console.log(`staged: ${(staged.stdout || staged.stderr || '').trim()}`);

/** The `node` a shell would find, which is the fallback for an unpinned tree. */
function whichNode() {
  const result = spawnSync(IS_WINDOWS ? 'where' : 'which', ['node'], { encoding: 'utf8' });
  if (result.status !== 0) return '';
  return (result.stdout || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
}
