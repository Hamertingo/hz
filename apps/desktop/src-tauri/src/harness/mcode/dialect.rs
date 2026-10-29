//! What differs between the ACP agents hz drives.
//!
//! **The wire is the same and the vocabulary is not.** All three speak ACP over
//! stdio, and each answers `session/new` with `configOptions` — but under its own
//! ids and with its own stances. A session's model, effort and permission are all
//! `session/set_config_option`, so the engine never needed three code paths; it
//! needs to know *which id* and *which value*, and how to start the process.
//!
//! Everything below is read off a real `initialize` and `session/new` of each
//! adapter (`fixtures/`), not from documentation:
//!
//! | | model | effort | stance |
//! |---|---|---|---|
//! | Claude | `model` | `effort` | `mode`: default, acceptEdits, plan, auto, bypassPermissions |
//! | Codex | `model` | `reasoning_effort` | `mode`: read-only, workspace-write, agent, agent-full-access; plan is a second option, `collaboration_mode` |
//! | OpenCode | `model` | — | `mode`: build, plan |
//! | mcode | `model` | `thinkingEffort` | `permissionMode`, plus ACP's own plan mode |

use anyhow::{bail, Result};
use std::path::PathBuf;

use crate::events::ApprovalPolicy;
use crate::harness::Harness;

/// An ACP adapter published to npm, **pinned**.
///
/// Pinned to what this build was verified against rather than `latest`: an adapter
/// is the layer that decides what `rawOutput` and the config ids look like, so one
/// that moves under a released app moves the transcript with it. Raised on
/// purpose, with a new capture.
#[derive(Debug, Clone, Copy)]
pub struct Adapter {
    pub package: &'static str,
    pub version: &'static str,
}

/// The adapters the ACP registry names for the two CLIs that do not speak ACP
/// themselves. Each **carries its own engine** (the Claude one depends on
/// `@anthropic-ai/claude-agent-sdk`, the Codex one on `@openai/codex`); the
/// reader's own install of the CLI is what holds their login.
pub const CLAUDE_ADAPTER: Adapter = Adapter {
    package: "@agentclientprotocol/claude-agent-acp",
    version: "0.94.0",
};
pub const CODEX_ADAPTER: Adapter = Adapter {
    package: "@agentclientprotocol/codex-acp",
    version: "2.2.2",
};

impl Adapter {
    /// The folder under `~/.hz/adapters` this version lives in. The version is in
    /// the name so raising it installs beside the old one rather than over it.
    fn dir_name(self) -> String {
        format!("{}-{}", self.package.rsplit('/').next().unwrap_or(self.package), self.version)
    }

    /// The script `node` runs, which is what the package's `bin` names.
    fn entry(self, dir: &std::path::Path) -> PathBuf {
        dir.join("node_modules").join(self.package).join("dist").join("index.js")
    }
}

/// One install at a time, process-wide. The park and the model read both want the
/// same adapter at the same moment, and two `npm install`s into one folder corrupt
/// each other — the second caller waits here and finds it done.
static INSTALLING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Where an adapter is installed, installing it first if this is the first time.
///
/// **Installed once into hz's own folder instead of `npx -y` on every start**, for
/// two measured reasons. `npx` checks the registry each launch, which cost ~3.8s of
/// a 4.7s start. And two of them at once — a park beside a model read — contended
/// for npm's cache and took 12s. A local install starts in about a second and has
/// no network on the hot path.
///
/// `--ignore-scripts`: the adapters need none, and an install that ran their
/// dependencies' lifecycle scripts would be running code nobody reviewed on the
/// reader's machine for no benefit.
async fn ensure_installed(adapter: Adapter) -> Result<PathBuf> {
    use crate::proc::HideConsole as _;

    let dir = crate::store::get_home_app_dir().await?.join("adapters").join(adapter.dir_name());
    let entry = adapter.entry(&dir);
    if entry.is_file() {
        return Ok(entry);
    }

    let _only_one = INSTALLING.lock().await;
    if entry.is_file() {
        return Ok(entry);
    }

    let npm = crate::binpath::npm().await;
    if !npm.is_absolute() {
        bail!("Node.js is needed to set up the agent — install it from nodejs.org");
    }
    std::fs::create_dir_all(&dir)?;

    eprintln!("[adapter] installing {}@{} into {}", adapter.package, adapter.version, dir.display());
    let started = std::time::Instant::now();
    let output = tokio::process::Command::new(&npm)
        .hide_console()
        .args(["install", "--prefix"])
        .arg(&dir)
        .args(["--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"])
        .arg(format!("{}@{}", adapter.package, adapter.version))
        .env("PATH", crate::binpath::child_path(crate::binpath::resolved_bin_dirs()))
        .output()
        .await?;

    if !output.status.success() || !entry.is_file() {
        let said = String::from_utf8_lossy(&output.stderr);
        let tail: String = said.chars().rev().take(300).collect::<Vec<_>>().into_iter().rev().collect();
        bail!("couldn't set up {}: {}", adapter.package, tail.trim());
    }
    eprintln!("[adapter] installed in {:.1}s", started.elapsed().as_secs_f64());
    Ok(entry)
}

/// The adapter an ACP harness is spoken to through, or `None` for one that
/// needs none (OpenCode speaks ACP itself).
pub fn adapter_for(harness: Harness) -> Option<Adapter> {
    match harness {
        Harness::Claude => Some(CLAUDE_ADAPTER),
        Harness::Codex => Some(CODEX_ADAPTER),
        _ => None,
    }
}

/// The adapter's entry script if it is already installed, **without installing
/// it**. For reads that are not worth a 300 MB `npm install`, like the usage probe.
pub async fn adapter_entry_if_installed(harness: Harness) -> Option<PathBuf> {
    let adapter = adapter_for(harness)?;
    let dir = crate::store::get_home_app_dir().await.ok()?.join("adapters").join(adapter.dir_name());
    let entry = adapter.entry(&dir);
    entry.is_file().then_some(entry)
}

/// Installs the pinned adapter if it is missing, and answers its entry script.
pub async fn install_adapter(adapter: Adapter) -> Result<PathBuf> {
    ensure_installed(adapter).await
}

/// A process to start, before the caller adds its environment and directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub program: PathBuf,
    pub args: Vec<String>,
}

/// The `configOptions` ids a harness uses for the three things a session lets the
/// reader move. `effort` is `None` where the agent has no such option at all —
/// which is a fact about the agent, not a gap: OpenCode puts a model's effort in
/// the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    pub model: &'static str,
    pub effort: Option<&'static str>,
}

pub fn options(harness: Harness) -> Options {
    match harness {
        Harness::Claude => Options { model: "model", effort: Some("effort") },
        Harness::Codex => Options { model: "model", effort: Some("reasoning_effort") },
        Harness::OpenCode => Options { model: "model", effort: None },
        Harness::Mcode | Harness::Other(_) => Options { model: "model", effort: Some("thinkingEffort") },
    }
}

/// The `session/set_config_option` writes that put a session on a stance, in the
/// order they must be sent.
///
/// **A stance outside what the agent offers is refused, never rounded.** Running a
/// session wider than the reader asked for is the failure worth an error, so
/// `DontAsk` — Claude Code's own word — is an `Err` on every harness whose captured
/// list has no such mode, rather than landing on whichever mode sounds close.
///
/// OpenCode is the odd one out: its modes are `build` and `plan`, which say whether
/// the agent may change things, not who approves. Approvals there are the reader's
/// own `opencode.json`, so every stance but plan lands on `build` and the composer
/// says so.
pub fn stance(harness: Harness, policy: ApprovalPolicy) -> Result<Vec<(&'static str, &'static str)>> {
    use ApprovalPolicy::*;

    match harness {
        Harness::Claude => {
            let mode = match policy {
                Plan => "plan",
                Manual => "default",
                Auto => "auto",
                BypassPermissions => "bypassPermissions",
                DontAsk => bail!("Claude has no Don't ask stance — pick Manual, Auto, Plan or Full access"),
            };
            Ok(vec![("mode", mode)])
        }
        Harness::Codex => match policy {
            // Plan is a collaboration mode, not a sandbox, so leaving it has to
            // be said too: a session left in `plan` stays there whatever `mode`
            // is set to.
            Plan => Ok(vec![("collaboration_mode", "plan")]),
            Manual => Ok(vec![("collaboration_mode", "default"), ("mode", "read-only")]),
            Auto => Ok(vec![("collaboration_mode", "default"), ("mode", "agent")]),
            BypassPermissions => Ok(vec![("collaboration_mode", "default"), ("mode", "agent-full-access")]),
            DontAsk => bail!("Codex has no Don't ask stance — pick Manual, Auto, Plan or Full access"),
        },
        Harness::OpenCode => Ok(vec![("mode", if policy == Plan { "plan" } else { "build" })]),
        Harness::Mcode | Harness::Other(_) => bail!("no stance table for {}", harness.wire_name()),
    }
}

/// The CLI's own path, or the sentence that says it is missing.
async fn installed(harness: Harness, name: &str, how: &str) -> Result<PathBuf> {
    let bin = crate::binpath::agent_binary(harness).await;
    if bin.is_absolute() {
        Ok(bin)
    } else {
        bail!("{name} isn't installed on this computer — {how}")
    }
}

/// How to start the agent for `harness`.
///
/// Claude and Codex go through their registry adapter, installed once into
/// `~/.hz/adapters` and run with `node` (so `node` and `npm` are needed on the
/// machine), and OpenCode starts `opencode acp` itself. The CLI each
/// one wraps has to be there and signed in: hz holds no key, so a missing CLI is
/// said as such rather than failing inside an adapter's own start-up.
pub async fn launch(harness: Harness) -> Result<Launch> {
    use crate::binpath;

    match harness {
        Harness::OpenCode => {
            let program = installed(harness, "OpenCode", "install it and run `opencode auth login`").await?;
            Ok(Launch { program, args: vec!["acp".into()] })
        }
        Harness::Claude | Harness::Codex => {
            let (name, how, adapter) = if harness == Harness::Claude {
                ("Claude Code", "install it and run `claude auth login`", CLAUDE_ADAPTER)
            } else {
                ("Codex", "install it and run `codex login --device-auth`", CODEX_ADAPTER)
            };
            // The CLI is what holds the login the adapter uses.
            installed(harness, name, how).await?;

            let node = binpath::node().await;
            if !node.is_absolute() {
                bail!("{name} needs Node.js to start — install it from nodejs.org");
            }
            let entry = ensure_installed(adapter).await?;
            Ok(Launch { program: node, args: vec![entry.to_string_lossy().into_owned()] })
        }
        Harness::Mcode => Ok(Launch { program: binpath::mcode().await, args: vec!["acp".into()] }),
        Harness::Other(name) => bail!("this build can't drive {name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ApprovalPolicy::*;

    fn writes(harness: Harness, policy: ApprovalPolicy) -> Vec<(&'static str, &'static str)> {
        stance(harness, policy).expect("a stance the agent offers")
    }

    #[test]
    fn claude_stances_are_its_own_modes() {
        assert_eq!(writes(Harness::Claude, Manual), [("mode", "default")]);
        assert_eq!(writes(Harness::Claude, Auto), [("mode", "auto")]);
        assert_eq!(writes(Harness::Claude, Plan), [("mode", "plan")]);
        assert_eq!(writes(Harness::Claude, BypassPermissions), [("mode", "bypassPermissions")]);
    }

    #[test]
    fn codex_plan_is_a_collaboration_mode_and_leaving_it_is_said() {
        assert_eq!(writes(Harness::Codex, Plan), [("collaboration_mode", "plan")]);
        // Every other stance first takes the session out of plan, or it stays
        // there however the sandbox is set.
        for (policy, mode) in [(Manual, "read-only"), (Auto, "agent"), (BypassPermissions, "agent-full-access")] {
            assert_eq!(writes(Harness::Codex, policy), [("collaboration_mode", "default"), ("mode", mode)]);
        }
    }

    #[test]
    fn opencode_only_has_plan_and_build() {
        assert_eq!(writes(Harness::OpenCode, Plan), [("mode", "plan")]);
        for policy in [Manual, Auto, BypassPermissions, DontAsk] {
            assert_eq!(writes(Harness::OpenCode, policy), [("mode", "build")]);
        }
    }

    #[test]
    fn a_stance_the_agent_does_not_offer_is_refused_not_rounded() {
        assert!(stance(Harness::Claude, DontAsk).is_err());
        assert!(stance(Harness::Codex, DontAsk).is_err());
    }

    #[test]
    fn opencode_has_no_effort_option_and_the_others_name_theirs() {
        assert_eq!(options(Harness::OpenCode).effort, None);
        assert_eq!(options(Harness::Claude).effort, Some("effort"));
        assert_eq!(options(Harness::Codex).effort, Some("reasoning_effort"));
    }

    #[test]
    fn the_adapters_are_pinned_not_floating() {
        for adapter in [CLAUDE_ADAPTER, CODEX_ADAPTER] {
            assert!(
                adapter.version.chars().next().is_some_and(|c| c.is_ascii_digit()),
                "{} floats",
                adapter.package
            );
        }
    }

    #[test]
    fn an_adapter_installs_beside_the_old_version_not_over_it() {
        assert_eq!(CLAUDE_ADAPTER.dir_name(), "claude-agent-acp-0.94.0");
        assert_eq!(CODEX_ADAPTER.dir_name(), "codex-acp-2.2.2");
        let dir = std::path::Path::new("/a");
        assert_eq!(
            CODEX_ADAPTER.entry(dir),
            PathBuf::from("/a/node_modules/@agentclientprotocol/codex-acp/dist/index.js")
        );
    }
}
