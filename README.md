# Hyze Code

A desktop home for a coding agent. A Tauri 2 app wrapping the agent it ships —
[Hz Agent](apps/agent), the MiniMax Code CLI, vendored into the bundle and spoken
to over **ACP** — in a native chat UI: many sessions at once, each in its own
worktree, with a diff and commit view, a pull-request panel, an issue panel, a
file tree, an embedded browser and local dictation. macOS and Windows.

[![Greptile: The War on Bugs](https://www.greptile.com/badge.svg)](https://www.greptile.com/?utm_source=oss_badge&utm_medium=readme&utm_campaign=greptile_for_open_source)

## Install

Downloads are on the [releases page](https://github.com/Hamertingo/hz/releases).

- **macOS** — the `.dmg`. The app is ad-hoc signed and notarized by nobody, so
  macOS refuses the first launch; right-click → Open is the cure, or
  `xattr -dr com.apple.quarantine "/Applications/Hyze Code.app"`.
- **Windows** — the `-setup.exe`. NSIS, and it installs without an administrator
  prompt.

**The agent ships inside the bundle.** There is no CLI to install first and no
terminal to open: the app resolves the copy it carries before anything on your
`PATH`. Connect a provider in Settings on the first run and the model picker
fills from whatever it answers.

Building from source instead is [below](#getting-started).

## Layout

A pnpm workspace for the app and the site — the agent's own tree sits *outside*
it, with its own lockfile — and four cargo crates beside them, with no root
workspace.

| Path                    | What                                                        |
| ----------------------- | ----------------------------------------------------------- |
| `apps/desktop`          | The Tauri app. React 19 + Vite frontend, Rust backend.       |
| `apps/agent`            | The agent, vendored and renamed. `bin/hz-agent` runs it.     |
| `apps/agent-launcher`   | The small Rust crate that starts it from the bundle.         |
| `apps/cli`              | The `hz` CLI agents use to fan work out into sessions.       |
| `apps/web`              | Marketing site. Next.js App Router, deployed to Vercel.      |
| `crates/hz-proto`       | Wire types shared by the CLI and the app.                    |

## Getting started

You need Node with pnpm, a Rust toolchain, and **cmake** — the local
transcription engine builds through it.

Install once, from the root — the lockfile covers the whole workspace.

```bash
pnpm install
```

Then run either app from the root:

```bash
pnpm app    # desktop app (Tauri + Vite)
pnpm web    # marketing site on :3000
pnpm test   # frontend tests
```

Anything beyond starting them wants the package's own directory, because
`tauri.conf.json`, `.cargo/config.toml` and `scripts/install.sh` all resolve
their paths against it:

```bash
cd apps/desktop && pnpm tauri build
cd apps/desktop/src-tauri && cargo test
```

`cargo test` regenerates the TypeScript event types in
`apps/desktop/src/types/events.ts`, so a filtered run (`cargo test git::`)
leaves only that module's types behind — always follow one with a bare
`cargo test`.

## The `hz` CLI

A standalone binary, not part of the app: it has to run where no hz app does.
It talks to the running app over a **unix socket** at `~/.hz/hz.sock` — or, on
Windows, over the **named pipe** of the same name, since there is no socket
there to open — which is how an agent inside one session creates, lists and
messages others. A dev build listens on `hz-dev.sock`, so the two do not take
each other's channel.

```bash
curl -fsSL https://raw.githubusercontent.com/Hamertingo/hz/main/apps/web/public/install.sh | sh
```

The install script also writes the CLI's skill into `~/.claude/skills/hz/` and
`~/.codex/skills/hz/`; `hz update` re-runs it. The app installs nothing —
it names the command and the agent runs it.

## The embedded browser

Chromium through CEF, behind the `cef` cargo feature and macOS only, so an
ordinary `cargo check` needs none of it. The bundle ships the five helper apps
and **not** the framework — ~330MB that would ride every download — which the
app fetches into `~/.hz/cef/<version>/` a few seconds after first launch.

Working on it wants the CEF SDK plus cmake and ninja, with the dev layout laid
down beside the debug binary first:

```bash
cd apps/desktop
CEF_PATH=~/.local/share/cef ./scripts/cef-dev-bundle.sh
CEF_PATH=~/.local/share/cef pnpm tauri dev --features cef
```

Nothing runs that script for you, and a cleaned `target/` takes its work away.

## Deploying the site

Vercel, with **Root Directory** set to `apps/web`. Vercel reads the workspace
lockfile at the repo root on its own; no `vercel.json` is needed.

GitHub Pages on this repo is already taken — it serves the desktop app's
updater manifests off the `updates` branch. Don't point the site at it.

## Releasing

The app and the CLI ship on their own schedules, under tags that don't collide.

**App:** `vX.Y.Z` for stable, `vX.Y.Z-beta.N` for beta. The version in the tag
has to match `apps/desktop/src-tauri/tauri.conf.json`, and a stable release
needs a matching `## X.Y.Z` section in `apps/desktop/CHANGELOG.md` — the
workflow fails loudly on either.

**CLI:** `cli-vX.Y.Z`, matching `apps/cli/Cargo.toml`. `install.sh` resolves the
newest `cli-v*` tag itself, so these are never published as prereleases.

## Themes

Four of the palettes hz ships are ports of other people's work, used under
the MIT licence and unchanged in intent — the colours are theirs, the token
names are ours. hz, the default, is our own.

| Theme                                                   | By                       |
| ------------------------------------------------------- | ------------------------ |
| [Catppuccin](https://github.com/catppuccin/catppuccin)   | the Catppuccin org       |
| [Cobalt2](https://github.com/wesbos/cobalt2-vscode)      | Wes Bos, Roberto Achar   |
| [One Dark Pro](https://github.com/Binaryify/OneDark-Pro) | Binaryify                |
| [gruvbox](https://github.com/morhetz/gruvbox)            | Pavel Pertsev (@morhetz) |

Full licence texts are in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md) —
MIT asks the notice travel with the work, so a credit line on its own is not
enough.

**Which repo a port comes from is part of the port.** Cobalt2 is taken from the
**VS Code** theme, not `wesbos/cobalt2`, which is the original Sublime one and
carries no licence file at all — the colours are the same in both and only one
of them grants permission to ship them. gruvbox is the reverse trap: it has no
licence file either, so GitHub reports it as unlicensed, but it declares MIT in
its `package.json`. One Dark Pro takes its surfaces from that repo's own
`darker` variant and its text from the main one.

Cobalt2 and One Dark Pro are dark-only, because neither has a light palette
upstream and a light one is a second full ramp rather than an inversion.
Picking either disables the mode control and says why.

Ports live in `apps/desktop/src/App.css`, each value commented with the name it
carries upstream (`surface0`, `bg0_h`) so a port can be checked against its
source rather than taken on trust.

## Marks

The agent's own mark, drawn as an inline SVG on `currentColor`
(`apps/desktop/src/components/AgentIcon.tsx`) so it sits in a row of muted chrome
rather than shouting over it. It is **the app's mark and not a vendor's**: there
is one agent here and it is the one this repository builds, so there is nobody
else's logo to carry and nobody else's trademark to name.

`AgentIcon` still takes a `harness` and reads it nowhere. That is deliberate: the
day a second agent exists, the picker draws two marks again and the argument is
already the thing that decides which.

## Transcription

Dictation in the composer is local, and it runs on
[transcribe.cpp](https://github.com/handy-computer/transcribe.cpp) — MIT, the
`transcribe-cpp` crate, which executes the GGUF model and is Metal-accelerated
on Apple Silicon.

That engine is its own repository under the `handy-computer` org, published and
licensed separately from the app below, and hz depends on it the ordinary way
through Cargo. Updates arrive as crate versions; **nothing here tracks the Handy
app, because none of it is vendored.**

The debt is to [Handy](https://github.com/cjpais/Handy) by
[CJ Pais](https://cjpais.com) — MIT — the privacy-focused speech-to-text app
that got there first and got it right, and the reason that engine exists at all.
Two files are taken from it directly: the dictation sounds, below.

The models are the `handy-computer` org's own GGUF conversions, fetched from
Hugging Face and pinned to a revision
(`apps/desktop/src-tauri/src/transcription/catalog.rs`). Weights are CC-BY-4.0
and carry their base models' own terms.

The two dictation sounds are Handy's own marimba pair, copied verbatim from its
repository under its MIT licence
(`apps/desktop/src/assets/dictate-{start,stop}.wav`). They are the only Handy
files in this tree.

**What hz did not take is the app.** Handy solves global hotkeys, injecting
text into whatever window has focus, a tray and a history — none of which hz
needs, because it owns the composer the words land in. The debt is to the engine
and to the judgement about which models are worth offering, and Handy's own
ranking is where this one's list started.

Handy's name, logo and brand assets are **not** covered by its MIT licence and
are not used here.
