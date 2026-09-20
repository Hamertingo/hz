//! Finding the CLI this app spawns when it wasn't launched from a shell.
//!
//! **Never `Command::new("mcode")`.** A bundled `.app` launched from Finder or
//! Dock inherits launchd's `PATH` — `/usr/bin:/bin:/usr/sbin:/sbin` — none of
//! which holds an `mcode` however it was installed. So a bare name resolves
//! under `pnpm tauri dev` and fails in the bundle, where the failure reads as
//! "the agent is broken" rather than "the agent is unreachable", and no event
//! ever arrives.
//!
//! Resolution escalates by cost: the copy bundled into this app (see
//! [`bundled_mcode`]), then the inherited `PATH`, then the directories a
//! user-installed CLI lands in, then `$SHELL -l -c 'command -v mcode'` — `-l`
//! because zsh otherwise reads `.zshrc` only and misses a `PATH` exported from
//! `.zprofile`.
//!
//! `git` and `gh` need none of this: both are found where the system keeps
//! them, or not at all.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{OnceLock, RwLock};
use tokio::process::Command;

use crate::harness::Harness;

/// The one CLI this app spawns. Resolved once and reused, like every other
/// answer here.
static MCODE_PATH: OnceLock<PathBuf> = OnceLock::new();

/// `gh`'s slot. Not a `OnceLock` like the one above, because this one caches an
/// *absence* too, and a reader who has just installed `gh` has to be able to
/// throw that answer away without restarting the app.
static GH_PATH: RwLock<Option<Option<PathBuf>>> = RwLock::new(None);

/// Bumped by [`forget_gh`], so a probe that started before it does not publish
/// an answer about the machine as it was.
static GH_GENERATION: AtomicU64 = AtomicU64::new(0);

/// The slot's answer, or `resolve`'s, kept for the life of the process.
///
/// A race here is harmless: both threads resolved the same binary, and the
/// loser just drops its copy.
async fn cached<T: Clone>(slot: &'static OnceLock<T>, resolve: impl Future<Output = T>) -> T {
    if let Some(hit) = slot.get() {
        return hit.clone();
    }
    let resolved = resolve.await;
    slot.get_or_init(|| resolved).clone()
}

/// Resolves `name`, falling back to the bare name rather than erroring: that
/// keeps the failure where it already was — a spawn error naming the binary —
/// instead of turning a resolvable-by-PATH case we didn't predict into a hard
/// stop.
async fn or_bare(name: &str) -> PathBuf {
    resolve(name).await.unwrap_or_else(|| PathBuf::from(name))
}

/// The absolute path to `gh`, or `None` where it isn't installed.
///
/// `None` rather than a bare-name fallback, unlike [`claude`]: `gh` is optional
/// here, and the caller turns a missing one into a line telling the reader to
/// install it. A spawn error naming the binary would be the same fact worded as
/// a crash.
///
/// The absence is cached too — the probe below costs a login shell and the PR
/// panel asks on every session — but unlike every other answer here it can be
/// thrown away, since [`forget_gh`] is how a reader who has just installed `gh`
/// gets an answer without restarting the app.
pub async fn gh() -> Option<PathBuf> {
    // Cloned out and the guard dropped before the probe: `resolve` awaits, and
    // a std guard must not be held across one.
    let cached = GH_PATH.read().unwrap().clone();
    if let Some(hit) = cached {
        return hit;
    }

    // Read before the probe, compared after it — the same bargain the issue
    // caches make with their own generation. A probe that started before
    // [`forget_gh`] is answering a question about the machine as it was, and
    // the reader has since installed the very binary it did not find: publish
    // it and the recheck they just made is undone by a read older than it.
    let generation = GH_GENERATION.load(Ordering::Acquire);
    let found = resolve("gh").await;

    // Resolved outside the lock: `resolve` spawns a login shell, and holding a
    // write guard across it would park every other caller behind it.
    let mut slot = GH_PATH.write().unwrap();
    if GH_GENERATION.load(Ordering::Acquire) == generation {
        *slot = Some(found.clone());
    }
    // Answered either way. The caller asked before the forget and this is the
    // honest answer to *their* question; only the cache has to refuse it.
    found
}

/// Forgets where `gh` is, so the next [`gh`] call probes again.
///
/// The PR panel's recheck button is the only caller: without it, installing the
/// CLI the panel just asked for changes nothing until the app is restarted, and
/// nothing on screen would say so.
///
/// Bumping under the same lock the value is written through is what makes the
/// refusal above stick: a probe cannot slip between the clear and the bump and
/// come back looking current.
pub fn forget_gh() {
    let mut slot = GH_PATH.write().unwrap();
    *slot = None;
    GH_GENERATION.fetch_add(1, Ordering::Release);
}

/// Where `mcode` is: the copy inside this bundle if there is one, then the
/// ordinary places, then a login shell — or the bare name as a last resort, the
/// shape every resolver here ends on, which keeps the failure where it already
/// was: a spawn error naming the binary.
///
/// **The bundled copy leads.** This app is built around one CLI, so a build
/// that ships it must run *its* copy rather than whatever `mcode` the reader
/// happens to have on their `PATH` — otherwise a machine with an older one
/// installed runs that instead of the one we tested against, and the version
/// the reader sees depends on an accident of their shell.
pub async fn mcode() -> PathBuf {
    cached(&MCODE_PATH, resolve_mcode()).await
}

async fn resolve_mcode() -> PathBuf {
    if let Some(bundled) = shipped_mcode() {
        return bundled;
    }
    or_bare("mcode").await
}

/// The agent this app ships, in the order the two builds put it.
///
/// **hz carries its own agent**, so this is where "is it installed" is really
/// answered — and the answer is yes for anything hz itself built. Three
/// candidates, cheapest first:
///
/// - **A release bundle**: `<Name>.app/Contents/Resources/mcode/bin/mcode`,
///   which `scripts/vendor-mcode.sh` wrote and Tauri copied in. Read off the
///   running executable, two directories up, because Tauri's own `resource_dir`
///   needs an `AppHandle` this module has no business holding.
/// - **The source tree this repository owns**: `apps/agent/bin/mcode`, the
///   launcher beside the built CLI. `CARGO_MANIFEST_DIR` is baked at compile
///   time, so this exists in `tauri dev` and in a debug build and points
///   nowhere in a released app — which is exactly the shape wanted, since a
///   released bundle carries the first candidate instead.
/// - **A staged vendor tree**: `src-tauri/resources/mcode/bin/mcode`, what the
///   vendoring script leaves for the bundle to pick up. Reached in dev before
///   the script has run only as a miss, and worth keeping in the list because
///   it is the copy that will actually ship.
///
/// Every one of these is a *launcher*, not the CLI's JS: the app spawns
/// `<this> acp`, so whatever is named here has to take the subcommand.
fn shipped_mcode() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let resources = exe.parent()?.parent()?.join("Resources");
    let bundled = resources.join("mcode").join("bin").join("mcode");
    if bundled.is_file() {
        return Some(bundled);
    }

    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let workspace = crate_dir.parent()?.parent()?.parent()?;
    [
        workspace.join("apps/agent/bin/mcode"),
        crate_dir.join("resources/mcode/bin/mcode"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

/// Whether the agent's CLI is installed and usable.
///
/// Read off the resolver's own answer rather than probing again: both cache in
/// a `OnceLock`, absence included, so this costs nothing after the first call —
/// which matters, since a failed resolution is the expensive one (it ends in a
/// login shell reading the whole rc chain).
///
/// **The test is `is_absolute`.** A successful resolution is always an absolute
/// path; the bare-name fallback both resolvers end at is the only relative
/// answer either can give. For Codex that covers the stale binary for free: one
/// with no `app-server` subcommand never satisfies `speaks_app_server`, so it
/// falls through to the bare name exactly like an absent one — and "installed
/// but cannot be driven" is the same answer to the reader as "not installed".
///
/// The cache never invalidates, so a CLI installed while the app runs still
/// reads as missing until restart. That is the same bargain `gh` already makes,
/// and it is why nothing here offers to install anything: the reader is at a
/// terminal by then anyway.
pub async fn agent_available(harness: Harness) -> bool {
    harness.names_a_cli() && agent_installed(harness).await
}

/// Whether the CLI is on this machine, whether or not this build can drive it.
///
/// Split from [`agent_available`] because the two are different questions with
/// different cures, and folding them cost the reader the useful half: a pi that
/// is genuinely missing was reported as "hz can't run pi yet", which names no
/// cure, while an installed one was never looked for at all.
pub async fn agent_installed(harness: Harness) -> bool {
    agent_binary(harness).await.is_absolute()
}

/// The resolved binary, for the callers that need to name it rather than spawn
/// it — the login launcher writes it into a shell script, where the bare name
/// would be looked up under launchd's `PATH` and not found.
///
/// A bare name is the one relative answer any of these resolvers gives, which
/// is what [`agent_installed`] reads to tell a resolved CLI from an absent one.
pub async fn agent_binary(harness: Harness) -> PathBuf {
    match harness {
        Harness::Mcode => mcode().await,
        // A harness only some other build knows — one of the four this app
        // used to run, most likely. Its own spelling, which is relative and so
        // reads as "not installed" — the refusal has to happen here rather than
        // by falling back to the one CLI this build does drive, which would run
        // the wrong agent in somebody else's session.
        Harness::Other(name) => PathBuf::from(name),
    }
}

/// Looks for `bin` on the inherited `PATH`, then in the usual install
/// locations, then by asking a login shell. Ordered by cost: the first two are
/// filesystem checks, the last spawns a shell that reads the user's rc files.
async fn resolve(bin: &str) -> Option<PathBuf> {
    if let Some(path) = search_path(bin) {
        return Some(path);
    }

    if let Some(path) = search_known_dirs(bin) {
        return Some(path);
    }

    login_shell_which(bin).await
}

/// Walks the `PATH` this process actually inherited. Covers `tauri dev` and any
/// launch from a terminal, where nothing further is needed.
fn search_path(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(bin))
        .find(|candidate| is_executable(candidate))
}

/// Where a user-installed CLI tends to land.
///
/// Public because the spawn needs them for the *other* direction: a child
/// inherits this process's `PATH`, and a bundled `.app` launched from Finder
/// inherits launchd's, which holds none of these. So a `hz` the user has
/// installed is invisible to the agent unless these are put back — the same
/// failure this module exists to solve for `claude`, one layer out.
pub fn known_dirs() -> Vec<PathBuf> {
    let Some(home) = std::env::home_dir() else {
        return Vec::new();
    };

    vec![
        home.join(".local/bin"),
        home.join(".claude/local"),
        home.join(".bun/bin"),
        home.join(".npm-global/bin"),
        // Managers whose shims run on their own, found by absolute path. asdf's
        // and mise's do not — one is a script calling `asdf`, the other refuses
        // a tool pinned in no config — so those are globbed by install below.
        home.join(".volta/bin"),
        home.join("Library/pnpm"),
        home.join(".local/share/pnpm"),
        home.join(".yarn/bin"),
        home.join(".n/bin"),
        // Nix keeps binaries in the store; these profile links are how they
        // reach a PATH. The second is home-manager's per-user profile.
        home.join(".nix-profile/bin"),
        PathBuf::from("/etc/profiles/per-user")
            .join(home.file_name().unwrap_or_default())
            .join("bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]
}

/// The directory each resolved CLI sits in, for the child's `PATH`.
///
/// An npm-installed CLI is a `#!/usr/bin/env node` script, and under a version
/// manager `node` lives beside it in a per-version `bin` that [`known_dirs`]
/// cannot name. Resolving the script and spawning it under launchd's `PATH`
/// then fails with `env: node: No such file or directory` — so whatever
/// directory a resolver landed in goes back to the child. Only cached answers
/// are read, and every spawn site resolves its own binary before building the
/// `PATH`, so the one it needs is always there.
///
/// A `node` found by the same walk goes with them, since it is not always a
/// sibling: mise's npm backend puts the CLI under `installs/npm-<pkg>` and
/// node under `installs/node`, proto puts globals one dir over from its node.
pub fn resolved_bin_dirs() -> Vec<PathBuf> {
    // Read, never probed: this runs on the spawn path, and `gh`'s slot is the
    // one here that can be empty because nothing has asked yet.
    let gh = GH_PATH.read().unwrap().clone().flatten();
    [MCODE_PATH.get()].into_iter().flatten()
        .cloned()
        .chain(gh)
        .filter(|path| path.is_absolute())
        .filter_map(|path| path.parent().map(Path::to_path_buf))
        .chain(node_dir().cloned())
        .collect()
}

static NODE_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// The `bin` holding a `node`, looked for exactly as the CLIs are but with no
/// shell probe — a `node` only the shell knows about is one the child would
/// see anyway if the shell's `PATH` were inherited, and it is not.
fn node_dir() -> Option<&'static PathBuf> {
    NODE_DIR
        .get_or_init(|| {
            search_path("node")
                .or_else(|| search_known_dirs("node"))
                .and_then(|node| node.parent().map(Path::to_path_buf))
        })
        .as_ref()
}

/// The `PATH` for a child this app spawns: the inherited one, then `extra`,
/// then [`known_dirs`] — each once. `extra` ahead of the fixed list, since a
/// CLI resolved out of a version manager wants *its* sibling `node`, not
/// whichever shim `~/.volta/bin` or `~/.n/bin` happens to hold.
pub fn child_path(extra: Vec<PathBuf>) -> String {
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs = extra;
    dirs.extend(known_dirs());
    with_dirs(&inherited, dirs)
}

/// `inherited` with each of `extra` appended once, in order.
fn with_dirs(inherited: &std::ffi::OsStr, extra: Vec<PathBuf>) -> String {
    let mut dirs: Vec<PathBuf> = std::env::split_paths(inherited).collect();

    for dir in extra {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }

    std::env::join_paths(dirs)
        .map(|joined| joined.to_string_lossy().into_owned())
        .unwrap_or_else(|_| inherited.to_string_lossy().into_owned())
}

/// The directories `claude` actually installs to, checked directly so the
/// common bundle launch never pays for a shell spawn. Not exhaustive by design
/// — [`login_shell_which`] is the general answer, this is the fast path.
fn search_known_dirs(bin: &str) -> Option<PathBuf> {
    let home = std::env::home_dir()?;
    let candidates = known_dirs();

    if let Some(found) = candidates
        .iter()
        .map(|dir| dir.join(bin))
        .find(|candidate| is_executable(candidate))
    {
        return Some(found);
    }

    // Version managers keep one directory per installed version, so the path
    // depends on which is current — glob the versions rather than guess one.
    // Each row: the root, how many directory levels sit between it and a
    // version, and where the binary lives relative to that version.
    let versioned: [(PathBuf, usize, &[&str]); 7] = [
        (home.join(".nvm/versions/node"), 1, &["bin"]),
        (home.join(".nodenv/versions"), 1, &["bin"]),
        (
            home.join("Library/Application Support/fnm/node-versions"),
            1,
            &["installation/bin"],
        ),
        (home.join(".local/share/fnm/node-versions"), 1, &["installation/bin"]),
        // installs/<tool>/<version>/bin — `<tool>` is `nodejs` for an `npm -g`
        // under an asdf node, or the plugin's own name.
        (home.join(".asdf/installs"), 2, &["bin"]),
        // tools/<tool>/<version>/bin; an `npm -g` under a proto node lands in
        // tools/node/globals/bin, which the same walk reaches.
        (home.join(".proto/tools"), 2, &["bin"]),
        // Same shape, but mise unpacks a release as it ships, so the binary
        // sits wherever the archive put it: `bin`, the version root, or one
        // level in under the tool's name (`installs/pi/latest/pi/pi`). Globbed
        // across every tool rather than `installs/<bin>`, since a CLI lands
        // under `node` (npm -g), its registry name (`claude`, `claude-code`,
        // `codex`) or `npm-<package>` depending on how it was asked for.
        (home.join(".local/share/mise/installs"), 2, &["bin", "", bin]),
    ];
    versioned
        .iter()
        .find_map(|(root, depth, layouts)| find_versioned(root, *depth, layouts, bin))
}

/// Looks for `bin` under every directory `depth` levels below `root`, trying
/// each layout as a path relative to it. A missing `root` is ordinary rather
/// than an error — most machines have at most one of these managers.
///
/// Walked in reverse lexical order so `latest` (mise's symlink) outranks any
/// numbered directory.
// ponytail: lexical, so 0.9 beats 0.10 — a semver sort if that ever bites.
fn find_versioned(root: &Path, depth: usize, layouts: &[&str], bin: &str) -> Option<PathBuf> {
    let mut dirs = vec![root.to_path_buf()];
    for _ in 0..depth {
        dirs = dirs
            .iter()
            .filter_map(|dir| std::fs::read_dir(dir).ok())
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .collect();
    }
    dirs.sort();
    dirs.into_iter().rev().find_map(|version| {
        layouts
            .iter()
            .map(|layout| version.join(layout).join(bin))
            .find(|candidate| is_executable(candidate))
    })
}

/// Asks the user's login shell where `bin` is, which is the only way to see a
/// `PATH` built by rc files the app never sourced.
///
/// `-l` matters more than it looks: without it zsh reads `.zshrc` only, and a
/// `PATH` exported from `.zprofile` — where the installers write it — stays
/// invisible.
async fn login_shell_which(bin: &str) -> Option<PathBuf> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());

    let output = Command::new(shell)
        .args(["-l", "-c", &format!("command -v {bin}")])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let line = String::from_utf8(output.stdout).ok()?;
    // `command -v` prints the name unchanged for a shell builtin or function,
    // which is not something we can spawn.
    let path = PathBuf::from(line.trim());
    is_executable(&path).then_some(path)
}

#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &std::path::Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The resolver must agree with the shell about where `claude` is. Skipped
    /// rather than failed where it isn't installed, so CI without the CLI stays
    /// green.
    #[tokio::test]
    async fn finds_the_claude_binary() {
        let Some(found) = resolve("claude").await else {
            eprintln!("claude not installed; skipping");
            return;
        };

        assert!(found.is_absolute(), "got a bare name: {found:?}");
        assert!(is_executable(&found));
    }

    /// A name that exists nowhere must resolve to nothing rather than to a
    /// path that fails only at spawn time.
    #[tokio::test]
    async fn a_missing_binary_resolves_to_none() {
        assert!(resolve("hz-definitely-not-a-real-binary").await.is_none());
    }

    /// mise's nesting is the layout that went missing: `installs/<tool>/<v>/`
    /// with the binary one level further in under the tool's own name.
    #[test]
    fn finds_a_binary_nested_under_a_version_dir() {
        let root = std::env::temp_dir().join("hz-binpath-versioned-test");
        let _ = std::fs::remove_dir_all(&root);
        let place = |rel: &str| {
            let bin = root.join(rel);
            std::fs::create_dir_all(bin.parent().unwrap()).unwrap();
            std::fs::write(&bin, "").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            bin
        };
        let _numbered = place("pi/0.84.4/pi/pi");
        let latest = place("pi/latest/pi/pi");
        let under_node = place("node/22.0.0/bin/claude");

        let layouts: &[&str] = &["bin", "", "pi"];
        assert_eq!(find_versioned(&root, 2, layouts, "pi"), Some(latest));
        assert_eq!(find_versioned(&root, 2, &["bin"], "claude"), Some(under_node));
        assert_eq!(find_versioned(&root, 2, &["bin"], "pi"), None);
        assert_eq!(find_versioned(&root.join("nope"), 2, layouts, "pi"), None);

        std::fs::remove_dir_all(&root).unwrap();
    }

    /// launchd's `PATH` plus a CLI resolved out of a version manager's bin:
    /// that bin must be on the child's `PATH` — or the script's `env node`
    /// finds nothing — and ahead of the fixed list, or a `node` shim there
    /// wins over the sibling the CLI was installed against. Each dir once.
    #[test]
    fn a_resolved_bin_dir_comes_after_inherited_and_before_known() {
        let launchd = std::ffi::OsStr::new("/usr/bin:/bin:/usr/sbin:/sbin");
        let nvm_bin = PathBuf::from("/home/u/.nvm/versions/node/v25.2.1/bin");
        let volta = PathBuf::from("/home/u/.volta/bin");

        let path = with_dirs(
            launchd,
            vec![PathBuf::from("/bin"), nvm_bin.clone(), nvm_bin, volta],
        );

        assert_eq!(
            path,
            "/usr/bin:/bin:/usr/sbin:/sbin:/home/u/.nvm/versions/node/v25.2.1/bin:/home/u/.volta/bin"
        );
    }

    #[test]
    fn a_directory_is_not_executable() {
        assert!(!is_executable(&PathBuf::from("/usr")));
    }
}
