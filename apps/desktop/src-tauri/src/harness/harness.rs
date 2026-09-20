//! Per-harness integrations. Each CLI gets a directory with two stages:
//! `parser.rs` (wire format → its own typed events) and `mapper.rs` (those →
//! [`AgentEvent`](crate::events::AgentEvent)). A wire-format change then touches
//! only the parser, a vocabulary change only the mapper.

#[path = "mcode/mcode.rs"]
pub mod mcode;

pub mod permissions;

pub mod rpc;

use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

/// The child's `PATH`: the inherited one with the user-bin directories put
/// back.
///
/// Load-bearing rather than defensive. A bundled `.app` launched from Finder
/// inherits launchd's `PATH` — `/usr/bin:/bin:/usr/sbin:/sbin` — so a `dray`
/// installed to `~/.local/bin` is simply not there for the agent, and the
/// failure reads as "the CLI is broken" rather than "the CLI is unreachable".
/// Appended, not prepended: the user's own `PATH` should still win where the
/// two name the same binary.
///
/// Shared by both harnesses because the trap is the bundle's, not the CLI's.
///
/// The directory each resolved CLI was found in rides along too, and a `node`
/// found the same way: an npm-installed CLI is a `node` script, and under a
/// version manager `node` sits in a per-version `bin` the fixed list cannot
/// name. `bin`'s own dir leads, so a CLI runs on the `node` it was installed
/// beside rather than another harness's — a Claude on nvm's node 18 must not
/// pick the interpreter for a pi installed against fnm's node 22.
pub fn agent_path(bin: &std::path::Path) -> String {
    // A bare-name fallback's parent is `""`, and an empty `PATH` segment is
    // the working directory — a same-named file in the project would run.
    let mut dirs: Vec<std::path::PathBuf> = bin
        .is_absolute()
        .then(|| bin.parent().map(Into::into))
        .flatten()
        .into_iter()
        .collect();
    dirs.extend(crate::binpath::resolved_bin_dirs());
    crate::binpath::child_path(dirs)
}

/// The environment every agent child is spawned with.
///
/// Two things, and both are the app taking responsibility for something the
/// reader's shell must not decide:
///
/// - **`PATH`**, so the launcher can find its own `node` and its own tools.
/// - **`MINIMAX_DATA_DIR`**, which is where the CLI keeps its sessions, its
///   provider configuration, its credentials and its login. Left unset the CLI
///   resolves it from the environment it inherited, so a reader with that
///   variable set — for their own TUI, another profile, anything — would have
///   *their* agent state written wherever it pointed. Measured the hard way: a
///   probe spawned from a shell with `MAVIS_DATA_DIR` set wrote its provider
///   credentials into hz's own data directory, where the app's issue-tracker
///   store then failed to read them and reported it once per launch.
///
/// So it is pinned to a directory of the agent's own inside hz's:
/// `~/.hz/agent`. Nothing else writes there, the app's own files stay the
/// app's, and a reader's provider setup belongs to this install of hz rather
/// than to whatever the shell happened to say.
pub async fn agent_env(command: &mut tokio::process::Command, bin: &std::path::Path) {
    command.env("PATH", agent_path(bin));

    if let Ok(dir) = crate::store::get_home_app_dir().await {
        command.env("MINIMAX_DATA_DIR", dir.join("agent"));
    }
}

/// Whether a harness's failure text names a login problem, case-insensitively.
///
/// Each harness keeps its own needle list rather than sharing one: the lists
/// are written to under-match, since the failed-turn row draws the sentence
/// whatever this answers — a wording missed costs the login button and keeps
/// the report, while one claimed wrongly sends the reader to log in over
/// something else entirely. Widen only from a real capture.
pub fn mentions_any(text: &str, needles: &[&str]) -> bool {
    let text = text.to_lowercase();
    needles.iter().any(|needle| text.contains(needle))
}

/// Whether a `<harness>/<stage>` pair is being reported for the first time in
/// this run, recording it either way.
///
/// A poisoned lock answers false — a dropped event beats a panic raised from
/// the middle of a read loop written to survive anything.
fn first_of_its_kind(key: String) -> bool {
    static REPORTED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);

    REPORTED.lock().is_ok_and(|mut seen| seen.insert(key))
}

#[cfg(test)]
mod report_tests {
    use super::first_of_its_kind;

    /// The whole of the parse-failure report's volume guard: a wire format that
    /// moved fails every line of a live session, and the second failure says
    /// nothing the first did not.
    #[test]
    fn a_stage_is_reported_once_per_run() {
        assert!(first_of_its_kind("test-harness/parse".into()));
        assert!(!first_of_its_kind("test-harness/parse".into()));
        assert!(first_of_its_kind("test-harness/map".into()));
        assert!(first_of_its_kind("test-other/parse".into()));
    }
}

/// Logs a line this build could not use and files it for investigation, with
/// the raw line beside it. One file and one set of stages for every harness,
/// because the question it answers is the same: how well does *this build*
/// cover the wire format. Failing to *record* a failure is itself only logged —
/// the read loop must survive anything.
///
/// Reported here rather than at [`crate::store::record_parse_failure`] one call
/// down, which is the same chokepoint and cannot name the harness. Two closed
/// tags go out and nothing else: `raw` is the whole CLI line, carrying prompts,
/// file contents and tool results, and `detail` is a serde message free to
/// embed the value it choked on. Neither leaves the machine.
pub async fn record_failure(harness: Harness, session_id: &str, stage: &str, detail: &str, line: &str) {
    let name = harness.wire_name();
    eprintln!("[{name} {stage} err] {detail}\n[{stage} err] raw line: {line}");

    if first_of_its_kind(format!("{name}/{stage}")) {
        // Volume is the reason: a wire format that moved fails *every* line, so
        // reporting each one is one HTTPS request per line of a live session
        // for an answer the first already gave. What the event says is that
        // this build stopped covering the format, which is true once per run.
        crate::analytics::error(
            "parse_failure",
            serde_json::json!({ "stage": stage, "harness": name }),
        );
    }

    if let Err(err) = crate::store::record_parse_failure(session_id, stage, detail, line).await {
        eprintln!("[{name} parse-failure write err] {err}");
    }
}

/// Copies the child's stderr to this process's, for logging only.
pub async fn read_stderr(harness: Harness, stderr: tokio::process::ChildStderr) -> anyhow::Result<()> {
    use tokio::io::AsyncBufReadExt;

    let name = harness.wire_name();
    let mut lines = tokio::io::BufReader::new(stderr).lines();

    while let Some(line) = lines.next_line().await? {
        if !line.trim().is_empty() {
            eprintln!("[{name} stderr] {line}");
        }
    }

    Ok(())
}

/// What a throwaway probe answered, kept by directory — every picker's list is
/// per-repo, and a probe costs a child. `fresh_for` is how long an answer
/// stands: `Duration::MAX` for the life of the process, where "restart the app"
/// is the accepted cure, and a window where the reader can change the answer
/// while Dray is open (pi's providers and extensions).
///
/// A failed probe is never cached, and the lock is not held across one, so two
/// early readers may probe twice rather than one waiting on the other.
pub struct ProbeCache<T> {
    entries: std::sync::Mutex<HashMap<String, (Instant, T)>>,
    fresh_for: Duration,
}

impl<T: Clone> ProbeCache<T> {
    pub fn new(fresh_for: Duration) -> Self {
        Self {
            entries: std::sync::Mutex::new(HashMap::new()),
            fresh_for,
        }
    }

    /// The cached answer for `key` while it is fresh, else `probe`'s.
    pub async fn get_or_probe<F, Fut>(&self, key: &str, probe: F) -> anyhow::Result<T>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = anyhow::Result<T>>,
    {
        if let Some((at, hit)) = self.entries.lock().unwrap().get(key) {
            if at.elapsed() < self.fresh_for {
                return Ok(hit.clone());
            }
        }

        let answer = probe().await?;
        self.entries
            .lock()
            .unwrap()
            .insert(key.to_string(), (Instant::now(), answer.clone()));
        Ok(answer)
    }

    /// The cached answer for `key` if still fresh, without ever probing. Lets a
    /// caller prefer a real probe result over a cheaper fallback it would
    /// otherwise return.
    pub fn peek(&self, key: &str) -> Option<T> {
        let entries = self.entries.lock().unwrap();
        let (at, hit) = entries.get(key)?;
        (at.elapsed() < self.fresh_for).then(|| hit.clone())
    }

    /// Stores `value` under `key` as fresh, replacing any entry. For a caller
    /// that probed outside [`Self::get_or_probe`] and decided for itself whether
    /// the answer is safe to cache.
    pub fn insert(&self, key: &str, value: T) {
        self.entries
            .lock()
            .unwrap()
            .insert(key.to_string(), (Instant::now(), value));
    }

    /// Drops every answer, so the next read probes again.
    pub fn forget(&self) {
        self.entries.lock().unwrap().clear();
    }
}

#[cfg(test)]
mod path_tests {
    /// The spawned binary's own dir is the first thing after the inherited
    /// `PATH`, ahead of every other harness's cached dir — so its `env node`
    /// lands on the node it was installed beside.
    #[test]
    fn the_spawned_binary_dir_leads_the_additions() {
        let bin = std::path::Path::new("/home/u/.fnm/node-versions/v22/installation/bin/pi");
        let inherited: Vec<std::path::PathBuf> =
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();

        let path = super::agent_path(bin);
        let dirs: Vec<std::path::PathBuf> = std::env::split_paths(&path).collect();

        assert_eq!(&dirs[..inherited.len()], &inherited[..]);
        assert_eq!(dirs[inherited.len()], bin.parent().unwrap());
    }

    /// A bare-name fallback must add nothing: its parent is `""`, which as a
    /// `PATH` segment is the working directory.
    #[test]
    fn a_bare_name_adds_no_empty_segment() {
        let path = super::agent_path(std::path::Path::new("pi"));

        assert!(!path.split(':').any(str::is_empty), "{path}");
    }
}

#[cfg(test)]
mod wire_tests {
    use super::Harness;

    /// The one that matters. `index.json` is rewritten whole by whichever build
    /// writes last, so a name a newer build wrote reaches an older one — and
    /// serde's default there is to fail the *value*, which fails the line,
    /// which is the whole file. One `"pi"` from a dev build made a released app
    /// read 256 sessions as none at all.
    #[test]
    fn a_name_this_build_does_not_know_costs_nothing() {
        let harness: Harness = serde_json::from_str(r#""some_future_agent""#).expect("parses");

        assert_eq!(harness, Harness::Other("some_future_agent"));
    }

    /// And it is written back exactly as it arrived. A placeholder would parse
    /// fine and quietly destroy the harness of every session it did not
    /// recognise — the worse half of this failure, not a lesser one.
    #[test]
    fn an_unknown_name_survives_a_round_trip() {
        for name in ["some_future_agent", "claude_code", "codex", "pi", "fx", "omp"] {
            let json = format!("\"{name}\"");
            let parsed: Harness = serde_json::from_str(&json).expect("parses");

            assert_eq!(serde_json::to_string(&parsed).expect("serializes"), json);
        }
    }

    /// Interning is what lets [`Harness::Other`] stay `Copy`, and it is only
    /// safe because the same name is the same pointer — otherwise every read of
    /// a session index would leak another copy of it.
    #[test]
    fn one_name_is_interned_once() {
        let a: Harness = serde_json::from_str(r#""repeated_agent""#).unwrap();
        let b: Harness = serde_json::from_str(r#""repeated_agent""#).unwrap();

        let (Harness::Other(a), Harness::Other(b)) = (a, b) else {
            panic!("both should be unknown");
        };

        assert!(std::ptr::eq(a, b), "the same name leaked twice");
    }

    /// An unknown harness is a value read off disk, never one to offer — so no
    /// spelling resolves to one, and a picker or availability read built from
    /// [`Harness::ALL`] cannot reach it.
    #[test]
    fn an_unknown_harness_is_not_offerable() {
        assert!(Harness::from_wire_name("some_future_agent").is_none());
        assert!(!Harness::ALL.iter().any(|h| matches!(h, Harness::Other(_))));
    }

    /// Nothing this build cannot name may be handed a CLI to spawn. Every
    /// route to one goes through this, so a `false` here is what keeps the
    /// refusal ahead of the child rather than running somebody else's agent in
    /// this reader's session.
    #[test]
    fn an_unknown_harness_names_no_cli() {
        assert!(!Harness::Other("some_future_agent").names_a_cli());

        for harness in Harness::ALL {
            assert!(harness.names_a_cli(), "{harness:?} has no CLI to spawn");
        }
    }
}

#[cfg(test)]
mod capability_tests {
    use super::{FastMode, Harness};

    /// Everything in place, and that is a measured claim rather than a
    /// convenient one: `session/set_config_option` moves the model and the
    /// thinking effort on a running session (verified live against `mcode acp`
    /// 0.4.12), and the permission stance rides the same call. A `false` here
    /// costs a respawn for a setting the wire can carry, and reads on screen as
    /// the composer's model list resetting itself.
    #[test]
    fn mcode_takes_every_setting_in_place() {
        let caps = Harness::Mcode.caps();
        assert!(caps.applies_model_in_place);
        assert!(caps.applies_effort_in_place);
        assert!(caps.applies_permission_in_place);
    }

    /// No `-w` — mcode has no worktree concept at all — so hz resolves the base
    /// ref and makes the tree itself before the spawn. A `true` here is a
    /// session that never gets one: `Session::init` refuses a worktree name with
    /// the index row already written.
    #[test]
    fn mcode_makes_no_worktree_of_its_own() {
        assert!(!Harness::Mcode.caps().creates_own_worktree);
    }

    /// Where every harness's fast mode can be reached from, row by row out of
    /// `shared_rules.json` — the same table `FAST_MODE_BY_HARNESS` is read from
    /// in `src/lib/mcode.test.ts`, so the backend's answer and the switch the
    /// composer draws cannot come apart.
    ///
    /// A row here is a claim about the CLI's wire, and mcode's has no tier on it
    /// at all: `serviceTier` is not a thing on this CLI and the ACP surface has
    /// no field for one — which is why no model of its list draws a switch, and
    /// why the row is absent rather than inert.
    ///
    /// A harness this build cannot name is not in the table and cannot be: it
    /// has no variant to write a spelling for, and `an_unknown_harness_offers_nothing`
    /// below is where its answer is pinned.
    #[test]
    fn the_fast_mode_each_harness_has_is_the_route_the_frontend_draws_from() {
        for row in crate::shared_rules::rules().fast_mode {
            let fast = harness_named(&row.harness).caps().fast_mode;

            assert_eq!(fast_mode_name(fast), row.support, "{} route", row.harness);
            assert_eq!(fast.offered(), row.offered, "{} offered", row.harness);
        }
    }

    /// The frontend's four words for [`FastMode`], which is the one thing the
    /// two sides have to spell identically — the fixture's `support` column.
    fn fast_mode_name(fast: FastMode) -> &'static str {
        match fast {
            FastMode::Unsupported => "none",
            FastMode::InPlace => "in-place",
            FastMode::OnSpawn => "on-spawn",
            FastMode::AtCreation => "at-creation",
        }
    }

    /// A harness by its wire spelling, which is how the frontend keys its own
    /// table. A row naming one this build has no variant for is a fixture
    /// nothing here can answer, rather than a row quietly skipped.
    fn harness_named(name: &str) -> Harness {
        Harness::from_wire_name(name).unwrap_or_else(|| {
            panic!("fixture names a harness this build has no variant for: {name}")
        })
    }

    /// `session/fork` answers a whole new session on the CLI's side, so there is
    /// nothing left for hz to perform on a tree — where `fork_needs_cli` true
    /// would have hz copy a transcript the CLI is about to write itself.
    #[test]
    fn mcode_forks_through_the_cli_alone() {
        assert!(Harness::Mcode.caps().forkable);
        assert!(!Harness::Mcode.caps().fork_needs_cli);
    }

    /// No `@path` expansion: mcode's prompt path has no parser for it, so a
    /// mention would reach the model as literal punctuation it has to guess the
    /// meaning of. The composer names the file in prose instead.
    #[test]
    fn mcode_expands_no_mentions() {
        assert!(!Harness::Mcode.caps().expands_at_mentions);
    }

    /// Nothing spawns for a harness this build cannot name, and every
    /// capability is `false` so nothing is offered either — the row still draws
    /// and its transcript still reads, which is the whole of what the tolerant
    /// read bought.
    #[test]
    fn an_unknown_harness_offers_nothing() {
        let unknown = Harness::Other("pi");
        let caps = unknown.caps();

        assert!(!unknown.names_a_cli());
        assert!(!caps.creates_own_worktree);
        assert!(!caps.applies_model_in_place);
        assert!(!caps.applies_effort_in_place);
        assert!(!caps.applies_permission_in_place);
        assert!(!caps.forkable);
        assert_eq!(caps.fast_mode, FastMode::Unsupported);
        // And nothing to copy: there is no CLI to install and no guide to link,
        // because what is missing is this build rather than the agent.
        assert_eq!(unknown.install_command(), "");
        assert_eq!(unknown.docs_url(), "");
        assert_eq!(unknown.login_command(), "");
    }
}

#[cfg(test)]
mod install_tests {
    use super::Harness;

    /// **The agent ships with the app, so there is no cure to name.** An
    /// install command here would be a reader sent to fetch a second copy of
    /// what is already inside the bundle they just opened.
    #[test]
    fn the_shipped_agent_names_no_installer() {
        assert_eq!(Harness::Mcode.install_command(), "");
        assert_eq!(Harness::Mcode.docs_url(), "");
        assert_eq!(Harness::Mcode.login_command(), "");
        assert!(!Harness::Mcode.label().is_empty());

        // And the name is the app's own, because the prose around it is: a
        // reader told to install "MiniMax Code" would go looking for a second
        // download.
        assert_eq!(Harness::Mcode.label(), "hz");
    }

    /// The login command is stated twice — once for the reader to copy, once
    /// as argv for the launcher — and the two must describe one command. Drift
    /// here is silent: the copied spelling still works by hand while the
    /// button quietly logs in to something else, or nothing.
    #[test]
    fn both_spellings_of_the_login_command_agree() {
        for harness in Harness::ALL {
            let words: Vec<&str> = harness.login_command().split(' ').collect();
            assert_eq!(
                words[1..],
                *harness.login_args(),
                "{:?} spells its login command two different ways",
                harness
            );
        }

        // Both halves empty, and that is the shape: there is no `mcode` on the
        // reader's PATH to type, so the notice draws the hint alone and the
        // reader acts in Settings.
        assert_eq!(Harness::Mcode.login_command(), "");
        assert!(Harness::Mcode.login_args().is_empty());
    }
}

use ts_rs::TS;
/// Which agent runs a session.
///
/// **Unknown spellings are kept, not refused.** `index.json` is a shared store
/// rewritten whole by whichever build writes last, so a value a newer build
/// wrote reaches an older one — and serde's default for an unrecognised variant
/// is to fail the *line*, which here is the whole file. One `"pi"` written by a
/// dev build made a released app read 256 sessions as none at all, with
/// `unknown variant \`pi\`` the only thing said about it.
///
/// So this is the same bargain [`SessionIndexItem.unknown`] makes one level
/// out: carry what you cannot understand through untouched. [`Harness::Other`]
/// holds the original string and serializes it back verbatim, so an old build
/// reading and rewriting the index leaves a newer build's sessions exactly as it
/// found them. Storing a placeholder instead would parse fine and quietly
/// destroy the harness of every session it did not recognise, which is the
/// worse half of this failure rather than a lesser one.
///
/// It is **not** in [`Harness::ALL`]: that is the set this build offers, and an
/// unknown one is not offerable. Nothing spawns for it either — see
/// [`Harness::names_a_cli`].
///
/// [`SessionIndexItem.unknown`]: crate::store::SessionIndexItem
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case", into = "String")]
pub enum Harness {
    /// MiniMax Code, the `mcode` CLI. The only one this build runs, and the
    /// only one it knows how to spawn: what was five harnesses with five
    /// dialects is one ACP peer.
    Mcode,
    /// A harness some other build named and this one has never heard of, with
    /// its spelling kept so a round trip does not lose it.
    ///
    /// An index written by an older build names `claude_code`, `codex`, `pi`,
    /// `omp` or `fx`, and every one of those lands here — the session still
    /// lists, its transcript still reads, and nothing spawns for it, because
    /// [`names_a_cli`](Self::names_a_cli) is false. That is the whole reason
    /// this variant is not deleted along with its harnesses.
    ///
    /// `&'static str` rather than `String`, from the intern table below, so
    /// this type stays `Copy`. It is passed by value through most of
    /// `session.rs`, and a `String` here put a `.clone()` on 44 call sites —
    /// permanent reader load on the hot path, to carry a tag.
    #[serde(skip)]
    #[ts(skip)]
    Other(&'static str),
}

/// Spellings read off the wire that this build does not know.
///
/// Leaked on first sight and shared thereafter, which is what lets
/// [`Harness::Other`] stay `Copy`. Bounded by the number of *distinct* harness
/// names any build ever writes — one or two in practice — so this is a fixed
/// cost, not a leak that grows with use.
static UNKNOWN_NAMES: std::sync::Mutex<Option<std::collections::HashSet<&'static str>>> =
    std::sync::Mutex::new(None);

fn intern(name: &str) -> &'static str {
    let mut guard = UNKNOWN_NAMES.lock().unwrap_or_else(|e| e.into_inner());
    let names = guard.get_or_insert_with(Default::default);

    if let Some(existing) = names.get(name) {
        return existing;
    }

    let leaked: &'static str = Box::leak(name.to_string().into_boxed_str());
    names.insert(leaked);
    leaked
}

impl<'de> Deserialize<'de> for Harness {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let name = String::deserialize(d)?;

        Ok(Harness::from_wire_name(&name).unwrap_or_else(|| Harness::Other(intern(&name))))
    }
}

impl From<Harness> for String {
    fn from(harness: Harness) -> String {
        harness.wire_name()
    }
}

impl Harness {
    /// Every harness this build offers.
    ///
    /// [`Harness::Other`] is deliberately absent: it is a value read off disk,
    /// never one to pick, so a picker or an availability read built from this
    /// cannot offer it.
    pub const ALL: [Harness; 1] = [Harness::Mcode];

    /// How the wire spells it — what `dray new --harness` takes and what an
    /// index entry holds.
    ///
    /// Every caller that needs the *set* of spellings builds it from
    /// [`Harness::ALL`] rather than writing a second list — that second copy is
    /// what drifts, and `--harness pi` was once refused by a hand-written match
    /// in `orchestration` for a harness the app could already run.
    ///
    /// Spelled out here rather than read back out of the serializer: the enum
    /// serializes `into = "String"` *through this function*, so asking serde
    /// would recurse.
    pub fn wire_name(self) -> String {
        match self {
            Harness::Mcode => "mcode".to_string(),
            Harness::Other(name) => name.to_string(),
        }
    }

    /// The harness that spelling names, if this build has one.
    pub fn from_wire_name(name: &str) -> Option<Harness> {
        Harness::ALL.into_iter().find(|h| h.wire_name() == name)
    }

    /// Whether this build has a CLI to spawn for it.
    ///
    /// The one question every path from a [`Harness`] to a running child has to
    /// ask. False for [`Harness::Other`] and nothing else: a name this build
    /// cannot resolve must be *refused*, never fall back to Claude Code —
    /// spawning the wrong agent into somebody's session is the failure the
    /// tolerant read is protecting against, not a milder version of it.
    pub fn names_a_cli(self) -> bool {
        !matches!(self, Harness::Other(_))
    }
}

/// When a fast-mode pick can reach the child, if at all.
///
/// One enum rather than a pair of bools, because the four answers are not two
/// independent questions: "offered" and "changeable" would let a harness claim
/// a combination no CLI has, and fx's is exactly the one a bool pair spells
/// wrong — it *has* fast mode and a running session can never be moved onto it,
/// not even by replacing the child.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FastMode {
    /// No route to it on this CLI's wire. pi plumbs `serviceTier` through its
    /// provider layer and populates it from nowhere: no flag, no settings key,
    /// and `set_model`/`set_session_name` are the only setters its RPC has.
    Unsupported,
    /// Reaches a running child. Claude Code's `apply_flag_settings` carries
    /// `{"fastMode": <bool>}` both ways, verified against v2.1.270 — the reply
    /// is `success` and the next `init`/`result` reports the new state.
    InPlace,
    /// Rides the spawn, so changing it replaces the child.
    ///
    /// Codex's `serviceTier` does have a turn-level form — `turn/start` takes
    /// it and it persists to later turns, exactly like `effort` — but
    /// [`TurnSettings`](crate::harness::codex::TurnSettings) is fixed for the
    /// life of the child by design, and every other Codex setting respawns for
    /// the same reason. One more is cheaper than a second mutation path into a
    /// struct that is cloned.
    OnSpawn,
    /// Settled when the session is first created and unreachable after.
    ///
    /// fx alone. It reads `fast_mode` out of `~/.fx/settings.json` at
    /// `session/new` and **stamps it onto its own session record**; a
    /// `session/resume` keeps the stamp whatever the settings file says since,
    /// verified live. So a respawn would not move it either, and the composer
    /// draws the row on a new session alone.
    AtCreation,
}

impl FastMode {
    /// Whether the reader can be offered it here at all.
    pub fn offered(self) -> bool {
        self != FastMode::Unsupported
    }
}

/// What [`crate::session`] has to know about a harness, in one place.
///
/// Every field here was an equality test against a *named* harness scattered
/// through that file. Two of the eight branch sites are `match` arms the
/// compiler checks; the other six were `==`, and a third harness slips past
/// every one of them silently and in the wrong direction — the worktree rule
/// kept treating "make the tree myself" as Codex's alone, so a pi worktree
/// session would have bailed inside `Session::init` with its index row already
/// written.
///
/// **These describe what Dray does, not what the CLI can do.** pi answers
/// `set_model` on a live connection and this build still respawns for one,
/// because nothing here drives that connection yet. A `false` is safe in a way
/// a `true` is not: replacing a child always applies the change, where applying
/// it in place is only correct if the wire really carries it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Capabilities {
    /// Whether the CLI creates a worktree itself, given a name.
    ///
    /// Claude Code's `-w` does. Nothing else has such a flag, so Dray resolves
    /// a base ref and makes the tree before the spawn — and a harness wrongly
    /// marked `true` here never gets a tree at all.
    pub creates_own_worktree: bool,
    /// Whether a running child can be moved onto another model without being
    /// replaced.
    pub applies_model_in_place: bool,
    /// Whether a running child can be moved onto another effort.
    ///
    /// False for Claude Code, and that is the CLI's own fact rather than a
    /// choice here: there is no `set_effort` control request, and an `effort`
    /// field on `set_model` is accepted and ignored.
    pub applies_effort_in_place: bool,
    /// Whether a running child can be moved onto another permission mode.
    pub applies_permission_in_place: bool,
    /// Where this harness's fast mode can be reached from, if anywhere.
    pub fast_mode: FastMode,
    /// Whether the CLI expands an `@path` mention in a prompt into the file's
    /// contents.
    ///
    /// Claude Code's own parser does, before the model turn and with no tool
    /// call on the wire, which is what makes a non-image attachment cost a path
    /// rather than a context window. Neither other harness has such a parser, so
    /// an `@path` sent there reaches the model as literal punctuation it has to
    /// guess the meaning of — the file is named in prose instead, which any
    /// model can read and act on with its own tools.
    pub expands_at_mentions: bool,
    /// Whether a session can be forked.
    pub forkable: bool,
    /// Whether a fork has a second half only the CLI can perform.
    ///
    /// Claude Code's does. What Dray copies is its *own* log; the conversation
    /// the CLI holds is forked lazily on the first send, with
    /// `--resume <parent> --fork-session`, so the fork's index entry carries
    /// `fork_from` as an instruction until that happens.
    ///
    /// pi's does not, and that makes pi's fork the simpler of the two. Its
    /// resume handle is a *file*, so copying that file is the entire fork — the
    /// first send is an ordinary spawn on a session that already holds the
    /// conversation. Setting `fork_from` there would be an instruction with
    /// nothing to carry it out.
    pub fork_needs_cli: bool,
}

impl Harness {
    /// The one table. Exhaustive, so a harness added later is asked every
    /// question the last one was asked.
    pub fn caps(self) -> Capabilities {
        match self {
            // Every one of these is ACP's own surface, verified live against
            // `mcode acp` 0.4.12: `session/set_config_option` moves the model
            // and the thinking effort on a running session,
            // `session/set_config_option permissionMode` moves the stance, and
            // `session/fork` forks. So all three changes are requests rather
            // than respawns, and the fork has no second half for the CLI to
            // perform — `session/fork` answers a whole new session.
            //
            // No `-w` flag: mcode has no worktree concept, so hz resolves a
            // base ref and makes the tree before the spawn.
            //
            // No fast mode. `serviceTier` is not a thing here at all and the
            // ACP surface has no field for one.
            //
            // No `@path` expansion: mcode's prompt path has no parser for it,
            // so a mention reaches the model as literal punctuation it has to
            // guess the meaning of. The composer names the file in prose
            // instead.
            Harness::Mcode => Capabilities {
                creates_own_worktree: false,
                applies_model_in_place: true,
                applies_effort_in_place: true,
                applies_permission_in_place: true,
                fast_mode: FastMode::Unsupported,
                expands_at_mentions: false,
                forkable: true,
                fork_needs_cli: false,
            },
            // A session some other build wrote and this one cannot run. `false`
            // throughout: the row still draws, so the reader can see the session
            // is there and read its transcript, and `names_a_cli` is what stops
            // anything spawning a child for a CLI it cannot name.
            Harness::Other(_) => Capabilities {
                creates_own_worktree: false,
                applies_model_in_place: false,
                applies_effort_in_place: false,
                applies_permission_in_place: false,
                fast_mode: FastMode::Unsupported,
                expands_at_mentions: false,
                forkable: false,
                fork_needs_cli: false,
            },
        }
    }

    /// What to call it in a sentence somebody reads.
    pub fn label(self) -> &'static str {
        match self {
            // **The agent is hz's own.** It ships inside the app, so prose that
            // named the vendor would read as a second thing the reader had to
            // install and keep in step — which is exactly what this build does
            // away with.
            Harness::Mcode => "hz",
            // Its own spelling, the only thing known about it — and the honest
            // thing to put in a sentence, since the name a newer build wrote is
            // the one its reader will recognise.
            Harness::Other(name) => name,
        }
    }

    /// The command that installs it, for a reader to copy into a terminal.
    ///
    /// Each vendor's own installer, not npm: it is the one route that needs
    /// nothing already on the machine (no Node, no package manager) and it is
    /// the one every other install surface — the vendor's own docs, `dray
    /// update`'s pattern for itself — already points at. Both verified live
    /// (`curl -fsSL … | sh -n`, a dry parse, not a run) before landing here.
    ///
    /// Dray never runs this. Choosing the method for somebody installs a
    /// second copy beside one they may already have, and a failure inside our
    /// installer is ours to debug where a failure on the vendor's page is
    /// theirs to follow.
    pub fn install_command(self) -> &'static str {
        match self {
            // **Empty, and that is the product.** The CLI is staged into the
            // bundle by `scripts/vendor-mcode.sh`, so hz is one download and
            // there is no command a reader could be given. A copyable installer
            // here would send them to fetch a second copy of what they already
            // have — and the notice is built to draw the sentence alone where
            // this is empty.
            Harness::Mcode => "",
            // Empty, because there is nothing to install: the CLI is not what
            // is missing, this build is. A command guessed from the name would
            // be the one thing worse than no command.
            Harness::Other(_) => "",
        }
    }

    /// Where the vendor documents installing it, for the reader without `curl`
    /// or wary of piping one into a shell — the escape hatch
    /// [`install_command`](Self::install_command) exists beside rather than
    /// behind.
    pub fn docs_url(self) -> &'static str {
        match self {
            // Nothing to link either: the documentation a reader needs is the
            // provider form in Settings, which is in this app.
            Harness::Mcode => "",
            // Empty, so the notice draws no link rather than a wrong one: the
            // cure here is a newer hz, not a CLI to install.
            Harness::Other(_) => "",
        }
    }

    /// The command that logs it in, spelled the way a reader would type it.
    ///
    /// Empty for every harness this build can name, and that is the answer
    /// rather than a gap: the agent ships inside the app, so there is no
    /// `mcode` on the reader's PATH to type — the copy inside the bundle is
    /// addressed by the app rather than by them. What is left to configure
    /// happens in Settings, where they are looking at it.
    pub fn login_command(self) -> &'static str {
        match self {
            Harness::Mcode => "",
            // Nothing to log in to, for the same reason there is nothing to
            // install: this build cannot name the CLI, let alone drive it.
            Harness::Other(_) => "",
        }
    }

    /// The same command as arguments after the *resolved* binary.
    ///
    /// The launcher cannot use [`login_command`](Self::login_command): a
    /// `.command` script runs under launchd's `PATH`, which holds none of the
    /// directories [`binpath`](crate::binpath) exists to search. So the reader
    /// copies one spelling and the terminal runs another, and a test pins the
    /// two together. Both are empty here — there is no command either way.
    pub fn login_args(self) -> &'static [&'static str] {
        match self {
            Harness::Mcode => &[],
            Harness::Other(_) => &[],
        }
    }

    /// What the reader still has to do once [`Harness::login_command`] has run,
    /// or `None` where the command is the whole cure.
    ///
    /// The shipped agent has no command at all — nothing about its setup happens
    /// in a terminal — so this line *is* what the notice has to say, and it says
    /// where to go rather than what to type. The failure it answers is the
    /// agent's own "Authentication required: Run `mcode login`", which on this
    /// build means no provider is connected: the managed account is never
    /// signed in to and its models are not drawn.
    pub fn login_hint(self) -> Option<&'static str> {
        match self {
            // Where the reader can actually act: Settings' Agent tab is where a
            // provider is connected, and there is no sign-in here to point at.
            Harness::Mcode => Some("Connect a provider in Settings → Agent"),
            Harness::Other(_) => None,
        }
    }
}

#[cfg(test)]
mod login_tests {
    use super::Harness;

    /// A harness that can be driven has to be able to say *where* the reader
    /// fixes a login — and that is not a command any more. The agent ships
    /// inside the app, so there is nothing on their PATH to run: an empty
    /// command with no hint would reach the notice as a sentence and two dead
    /// buttons.
    #[test]
    fn every_drivable_harness_says_where_a_login_is_fixed() {
        for harness in Harness::ALL {
            let (command, hint) = (harness.login_command(), harness.login_hint());
            assert!(
                !command.is_empty() || hint.is_some(),
                "{harness:?} draws a login notice with nothing the reader can act on"
            );
        }
    }

    /// The pairing is the rule, not pi being the one with a hint. A command
    /// that lands somewhere other than a login needs the rest said out loud,
    /// and `login_args` is how you tell the two apart: an empty one means the
    /// command opens the CLI rather than starting anything.
    #[test]
    fn a_login_that_only_opens_the_cli_carries_a_hint() {
        for harness in Harness::ALL {
            if harness.login_args().is_empty() {
                assert!(
                    harness.login_hint().is_some(),
                    "{harness:?} opens its CLI and says nothing about what to do there"
                );
            }
        }
    }

    /// `Other` is the harness this build cannot name, let alone drive, so it
    /// must not claim a cure. It is excluded from `ALL`, which is why the two
    /// tests above cannot cover it.
    #[test]
    fn an_unknown_harness_offers_nothing() {
        let unknown = Harness::Other("opencode");
        assert!(unknown.login_command().is_empty());
        assert!(unknown.login_hint().is_none());
    }
}
