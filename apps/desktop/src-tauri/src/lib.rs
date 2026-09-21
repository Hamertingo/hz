use crate::{
    attachments::Attachment,
    events::ApprovalPolicy,
    models::{Effort, Model, ModelId},
    session::{Harness, QueuedMessage, SendOutcome, SessionManager},
    store::{SessionIndexItem, SessionSnapshot, SessionStatus},
};
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

/// `anyhow::bail!` for a function returning [`Fail`]: `bail!` returns the bare
/// `anyhow::Error`, which does not coerce, where `?` would have converted it.
macro_rules! fail {
    ($($t:tt)*) => {
        return Err(anyhow::anyhow!($($t)*).into())
    };
}

pub mod analytics;
mod automations;
pub mod search;
pub mod apps;
pub mod attachments;
pub mod binpath;
#[cfg(all(feature = "cef", target_os = "macos"))]
#[path = "cef/cef.rs"]
pub mod cef;
// Compiled on **every** platform, not only where the browser is. The module
// needs nothing platform-specific — it fetches a tarball and remembers where
// it landed — and the `target_os` gate it used to carry cost its type from
// `events.ts`: a Windows `cargo test` regenerated the file without
// `ChromiumStatus`, and the frontend build then failed on three files that
// import it. `cef` above is genuinely feature-shaped; this was not.
//
// What stays macOS-only is the *commands*, registered below.
pub mod chromium;
pub mod context;
mod local_servers;
pub mod docs;
pub mod download;
#[path = "events/events.rs"]
pub mod events;
pub mod files;
pub mod git;
pub mod github;
#[path = "harness/harness.rs"]
pub mod harness;
pub mod identity;
#[path = "issues/issues.rs"]
pub mod issues;
#[path = "models/models.rs"]
pub mod models;
pub mod notifications;
pub mod orchestration;
pub mod plugins;
pub mod projects;
pub mod quit;
pub mod session;
pub mod settings;
pub mod store;
pub mod title;
#[path = "transcription/transcription.rs"]
pub mod transcription;
pub mod updater;

/// The rows the rules this crate states for itself are pinned against, and the
/// same rows the frontend's suite reads. Test-only: nothing the app runs reads
/// a fixture.
#[cfg(test)]
mod shared_rules;

/// A command's failure as the frontend sees it: the outermost message, as a
/// string. `anyhow::Error` cannot cross the bridge itself, and the alternative
/// was a wrapper per command mapping it to `String`. Converts both ways, so a
/// function returning this still reads as `anyhow` to every caller in the crate.
pub struct Fail(anyhow::Error);

impl From<anyhow::Error> for Fail {
    fn from(e: anyhow::Error) -> Self {
        Self(e)
    }
}

impl From<Fail> for anyhow::Error {
    fn from(f: Fail) -> Self {
        f.0
    }
}

impl std::fmt::Debug for Fail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

impl serde::Serialize for Fail {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0.to_string())
    }
}

#[tauri::command]
// **The parameter list is the wire shape**, which is why it is not a struct:
// the webview calls this with flat camelCase keys, Tauri maps them onto these
// names, and nesting them into one argument would change what every caller
// sends. The nine settings among them mirror the composer's own controls.
#[allow(clippy::too_many_arguments)]
async fn send_msg(
    session_id: &str,
    prompt: &str,
    attachment_paths: Vec<String>,
    // Deserialized straight into the enum rather than matched off a string: the
    // wire spelling is `Harness`'s own `snake_case`, so a third arm here was a
    // third list to keep in step and its failure was one word — "invalid
    // harness" — for a name the enum could have named.
    harness: Harness,
    model: ModelId,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
    fast: bool,
    cwd: &str,
    branch: Option<&str>,
    use_worktree: bool,
    worktree_name: Option<&str>,
    // Where a new session's worktree starts from. **Two fields and not one**
    // because they carry different things: a ref holds committed work only,
    // where a seed is a snapshot of another checkout's working tree — and a
    // review of a turn nobody has committed needs the second. The composer sets
    // neither; the second opinion sets the seed.
    base_ref: Option<String>,
    seed_tree: Option<String>,
    // The session that asked for this one, so the sidebar nests the row beside
    // the work it was asked about.
    parent_session_id: Option<String>,
    // The Agent the composer picked for a new session, or `None` for the
    // runtime's own default. Applied only when a session is created — an
    // existing one already runs as whatever it was made with, and `send_msg`
    // ignores it otherwise.
    agent_name: Option<String>,
    is_new_session: bool,
    // The webview's own clock at the press, which is the only witness to it:
    // a cold session's first prompt waits out the child's whole boot before it
    // reaches this function, and the transcript is asked for the wait, not for
    // the part of it that happened after the process was up.
    sent_at: Option<String>,
    app: AppHandle,
    manager: State<'_, SessionManager>,
) -> Result<SendOutcome, String> {
    // The tolerant `Deserialize` reads a name this build doesn't know as
    // `Other`, which is right off the index and wrong here: this is the
    // composer naming a harness to *start*, so an unknown one is a caller
    // error rather than a session some other build wrote.
    if !harness.names_a_cli() {
        return Err("invalid harness".to_string());
    }

    // Reported here rather than inside `SessionManager::send_msg`, which is the
    // chokepoint for *prompts* and not for people: the orchestration socket
    // reaches that function directly, both to relay a `hz send` and to start
    // a session `hz new` asked for, and an agent finishing at 3am would mark
    // the day active with nobody in the room. A Tauri command is reachable from
    // the webview alone, so getting here means somebody pressed send.
    analytics::active_day();

    manager
        .send_msg(
            crate::session::SendRequest {
                session_id,
                prompt,
                attachment_paths: &attachment_paths,
                // Nothing named, ever: the app tags its issues in the prompt
                // text, the composer's `#` picker being the only route, so there
                // is one rule on this side of the bridge. `--issue` on the CLI
                // is the other caller, and it names them because a flag is not
                // prose.
                issue_ids: &[],
                harness,
                model,
                effort,
                permission_mode,
                fast,
                cwd,
                branch,
                use_worktree,
                worktree_name,
                base_ref: base_ref.as_deref(),
                seed_tree: seed_tree.as_deref(),
                agent_name: agent_name.as_deref(),
                is_new_session,
                parent_session_id: parent_session_id.as_deref(),
                from: None,
                sent_at: sent_at.as_deref(),
            },
            &app,
        )
        .await
        .map_err(|e| e.to_string())
}

/// Describes dropped or picked paths for the composer's tray. Returns only the
/// ones that can be attached — a folder dragged in alongside two files leaves
/// the two files.
#[tauri::command]
async fn read_attachments(paths: Vec<String>) -> Vec<Attachment> {
    attachments::read_attachments(paths).await
}

/// Parks text too large to sit in the composer and answers the attachment for
/// the file it landed in, so the paste costs a path rather than a context
/// window. See `attachments::write_pasted_text` for where it is kept and for how
/// long.
#[tauri::command]
async fn write_pasted_text(text: String) -> Result<Attachment, String> {
    attachments::write_pasted_text(&text)
        .await
        .map_err(|e| e.to_string())
}

/// Which agents can actually be run on this machine, and what to say about
/// one that can't.
///
/// Read when the composer mounts, so an agent with no CLI behind it is marked
/// before anybody writes a prompt for it. The resolution is cached in
/// `binpath`, so this is a filesystem check on the first call and free after —
/// but the first call can spawn a login shell, hence `async` and hence a
/// command rather than something the picker computes per render.
///
/// The cure travels with the answer. A row saying "not installed" and nothing
/// else is the errno reworded; naming the command and the page is the whole
/// point of asking.
#[tauri::command]
async fn agent_availability() -> Vec<AgentAvailability> {
    let mut out = Vec::new();
    for harness in harness::Harness::ALL {
        let (reason, curable) = unavailable_reason(harness).await;

        out.push(AgentAvailability {
            harness,
            available: binpath::agent_available(harness).await,
            label: harness.label().to_string(),
            reason,
            install_command: curable.then(|| harness.install_command().to_string()),
            docs_url: curable.then(|| harness.docs_url().to_string()),
            login_command: harness.login_command().to_string(),
            login_hint: harness.login_hint().map(str::to_string),
        });
    }
    out
}

/// What to say about an agent that cannot run, and whether the install command
/// is what fixes it.
///
/// Three answers wearing one word before this, and each wants a different cure.
/// A CLI that is not on the machine is fixed by installing it. One that is
/// present and too old is fixed by *re-running* the same installer, so the
/// buttons still help — but a sentence saying "not installed" tells the reader
/// to fix something they already have. And a harness this build cannot drive
/// yet is fixed by neither, so it draws the sentence alone: sending someone to
/// an installer for a CLI that is sitting right there is the worst of the
/// three.
async fn unavailable_reason(harness: harness::Harness) -> (String, bool) {
    let label = harness.label();

    // Asked before drivability, and the order is the whole of it. A CLI that is
    // not on the machine is missing whatever this build could do with it, and
    // the install command is the answer — the same one Claude and Codex give.
    // Checking drivability first told a reader with no pi at all that hz
    // cannot run pi, which is true, useless, and hides the one thing they could
    // have done about it.
    if !binpath::agent_installed(harness).await {
        return (
            format!("{label} isn't installed, so this session can't start."),
            true,
        );
    }

    (format!("hz can't run {label} sessions yet."), false)
}

#[derive(serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
struct AgentAvailability {
    harness: harness::Harness,
    available: bool,
    label: String,
    /// The sentence the composer's notice draws. Built here for the reason the
    /// cure travels with the answer: a row saying "unavailable" and nothing
    /// else is the errno reworded.
    reason: String,
    /// What fixes it, where installing is what fixes it. `None` where the CLI
    /// is not the problem, so the notice draws no buttons rather than buttons
    /// that change nothing.
    install_command: Option<String>,
    docs_url: Option<String>,
    /// Read by a different notice from the two fields above it: those cure a
    /// CLI that is missing, this cures one that is logged out. Both are facts
    /// about the harness rather than about the machine, so they ride one read.
    login_command: String,
    /// What is left to do once `login_command` has run, for a harness whose
    /// command is not the whole cure. `None` for the two whose command is.
    login_hint: Option<String>,
}

/// The models a harness can run here.
///
/// Async because one harness's answer is not a table: pi is multi-provider, so
/// its list depends on which providers the reader has logged into and only pi
/// can say. That read is cached and cheap after the first, and it answers empty
/// rather than erroring — a reader with no provider configured is in an
/// ordinary state, and the picker draws its own empty row for it.
#[tauri::command]
async fn list_models(harness: Option<harness::Harness>) -> Vec<Model> {
    // Defaulted rather than required so a caller that predates the argument
    // still gets a list.
    match harness.unwrap_or(harness::Harness::Mcode) {
        // The agent's own answer, read live off a short session and cached — an
        // empty list on a machine that has never run it, which the picker draws
        // as "mcode names the model until you pick one".
        harness::Harness::Mcode => harness::mcode::models::all().await,
        other => models::models_for(other),
    }
}

/// Drops the cached model list, so the next read probes again.
///
/// For the refresh a reader asks for by hand: they have just connected or
/// removed a provider, and waiting out the freshness window would read as the
/// picker being wrong.
#[tauri::command]
async fn refresh_models() {
    harness::mcode::models::forget();
}

/// Starts the agent child a session is about to need, so the reader's first
/// prompt does not pay for its boot.
///
/// **The session id is named here because the child has to carry it.** `spawn`
/// is where `HZ_SESSION_ID` is fixed, and the hz CLI reads it as the default
/// session for `hz issue link` for the rest of that child's life — so a child
/// parked without one would quietly lose that. The frontend mints the id when
/// the composer first has something in it and hands the same one to `send_msg`.
///
/// **A hint, not a step.** Nothing is created here — no index entry, no session
/// record — and `send_msg` spawns its own child when nothing is parked. So a
/// reader who types and closes the composer leaves a process to be reaped, not
/// a session; and a failure here costs a few seconds rather than the send.
///
/// **The Agent rides this, not only the send.** A park completes the handshake and
/// the `session/new`, and the Agent is composed into a session at that moment — so
/// a park made under one Agent cannot be adopted by a send asking for another, and
/// `mcode::init` refuses the mismatch and pays a spawn.
#[tauri::command]
async fn prepare_session(
    session_id: String,
    cwd: String,
    model: ModelId,
    effort: Option<Effort>,
    permission_mode: ApprovalPolicy,
    agent_name: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    // The same resolution the send does, so a park is opened on the model the
    // composer is showing rather than on a spelling of it this build invented.
    // A pick that is not in the live list is `None`, which leaves the CLI on its
    // own default — the same answer `send_msg` gives, and the diff in
    // `mcode::init` is what corrects it if the reader picks something else
    // before sending.
    let spec = harness::mcode::models::find(&model).await;

    harness::mcode::prepare(
        &session_id,
        &cwd,
        spec.as_ref(),
        effort,
        permission_mode,
        agent_name.as_deref(),
        &app,
    )
    .await
    .map_err(|e| format!("{e:#}"))
}

/// Where models come from, as Settings draws it.
///
/// The agent's own provider list, read live rather than cached: a provider
/// added in another window, or by the CLI itself, is one the reader will expect
/// to see the moment they open the form. **Only the providers hz manages** —
/// the CLI's own MiniMax account entries are dropped in
/// [`providers::list`](harness::mcode::providers::list), since this app has no
/// screen that could sign in to one.
#[tauri::command]
async fn list_providers() -> Result<Vec<harness::mcode::providers::Provider>, String> {
    harness::mcode::providers::list()
        .await
        .map_err(|e| format!("{e:#}"))
}

/// The providers this build can set up for the reader in one step.
///
/// Fetched rather than hardcoded in the frontend: the URL and the dialect are
/// facts about the agent's own gateway wiring, so they live beside the code
/// that talks to it.
#[tauri::command]
async fn list_provider_presets() -> Vec<harness::mcode::providers::ProviderPreset> {
    harness::mcode::providers::presets()
}

/// Adds a provider and hands back the list as it stands after.
///
/// The list rather than a bare `()` because the CLI mints the id from the name
/// — `custom_provider:<slug>` — and a caller that guessed the slug would be
/// guessing a rule the vendor owns. It also drops the cached model list on the
/// way through, so the picker is drawn from the providers that exist now.
#[tauri::command]
async fn add_provider(
    provider: harness::mcode::providers::NewProvider,
) -> Result<Vec<harness::mcode::providers::Provider>, String> {
    harness::mcode::providers::add(&provider)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn remove_provider(
    provider_id: String,
) -> Result<Vec<harness::mcode::providers::Provider>, String> {
    harness::mcode::providers::remove(&provider_id)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Tests a provider, handing back the CLI's own sentence about what happened.
#[tauri::command]
async fn test_provider(provider_id: String, model: Option<String>) -> Result<String, String> {
    harness::mcode::providers::test(&provider_id, model.as_deref())
        .await
        .map_err(|e| format!("{e:#}"))
}

/// What the settings dialog draws about **reporting**; the other rows it draws
/// are ordinary preferences and come from [`get_preferences`]. Both stores are
/// described in [`settings`].
///
/// Answers with the **effective** state, off `analytics::enabled`, not with
/// what is on disk. The two differ whenever `HZ_NO_ANALYTICS` is set, and a
/// switch drawn from the file there would sit at `on` while nothing was being
/// sent.
#[tauri::command]
async fn get_settings() -> settings::SettingsView {
    settings_view().await
}

/// Every preference the frontend owns, in one payload.
///
/// Read once from `src/lib/prefs.ts`, before its first render, which is what
/// lets a pick paint on the first frame and lets these live outside the webview
/// at all. Absent fields are `None` — see [`settings::Preferences`] for why
/// that distinction is the migration's whole signal.
#[tauri::command]
async fn get_preferences() -> settings::Preferences {
    settings::read().await.into()
}

/// Writes the preferences a batch names and leaves every other one alone.
///
/// A batch rather than a field, because the one caller that writes several at
/// once is the migration — nine picks moving out of the webview — and half of
/// them landing would leave a reader unable to tell which half. Answers with
/// the file as it now stands, so a caller can keep what it did not name without
/// a second read.
#[tauri::command]
async fn set_preferences(
    patches: Vec<settings::PreferencesPatch>,
) -> Result<settings::Preferences, Fail> {
    // Through `settings::update` like every other write, so this shares the one
    // lock and the one atomic rename: a batch cannot be interleaved with the
    // install id minting itself, or with the analytics switch.
    let next = settings::update(|next| settings::apply(patches, next)).await?;

    Ok(next.into())
}

/// Persists the analytics opt-out. Every send reads the file, so the switch
/// needs no restart to mean anything.
///
/// Read-modify-write rather than a fresh struct: with a second field here one
/// day, building this from `enabled` alone would reset whatever the caller did
/// not name.
#[tauri::command]
async fn set_analytics_enabled(enabled: bool) -> Result<settings::SettingsView, Fail> {
    // `update` and not read-then-write: the two steps can be interleaved by the
    // install id minting itself, whose write would then carry a snapshot taken
    // before this switch moved and put `analytics_enabled: true` straight back.
    settings::update(|next| {
        next.analytics_enabled = enabled;
        // Turning it off takes the identifier with it, so nothing is left on
        // disk naming an install that has asked not to be counted. Opting back
        // in mints a fresh one, which reads as a new person — the honest
        // answer, since the gap in between is unmeasured either way.
        if !enabled {
            next.install_id = None;
        }
    })
    .await?;

    Ok(settings_view().await)
}

/// What the webview needs to run PostHog for itself, or `None` where it may not.
///
/// Surveys are drawn by `posthog-js` and by nothing else, so the SDK is the one
/// thing here the Rust POST cannot stand in for. `None` is the refusal and the
/// frontend initialises nothing on it — see [`analytics::identity`] for why the
/// answer is one value rather than a consent flag the other side pairs with a
/// lookup of its own.
#[tauri::command]
async fn analytics_identity() -> Option<analytics::SurveyIdentity> {
    analytics::identity().await
}

/// Reports a feature whose only chokepoint is in the frontend.
///
/// The backend reports its own — this exists for the handful, like the handoff
/// row's buttons, where the thing being measured is a click handler and nothing
/// in Rust can see it happen. Consent and the install id are still read inside
/// [`analytics::track`], so a call from the webview cannot report anything a
/// call from here would not.
///
/// Takes the feature as a `String` and does not validate it. The only caller is
/// this app's own frontend, and a list of permitted names here would be a
/// second copy of one the call sites already are.
#[tauri::command]
fn track_feature(feature: String) {
    analytics::track("feature_used", serde_json::json!({ "feature": feature }));
}

/// Reports that the app is being used today, from the frontend's focus channel.
///
/// The one kind of use nothing in Rust can see: coming back to read a session
/// an agent is already running sends no prompt and starts nothing. The signal
/// comes from `src/lib/focus.ts`, which is where the rule for reading it
/// already lives — the DOM's `focus` fires for a native menu or devtools
/// closing too, which is not the reader arriving.
///
/// Called on every focus gain and decides nothing: the daily throttle is in
/// [`analytics::active_day`] and shared with the two backend call sites.
#[tauri::command]
fn track_active_day() {
    analytics::active_day();
}

async fn settings_view() -> settings::SettingsView {
    settings::SettingsView {
        analytics_enabled: analytics::enabled().await,
        analytics_locked: analytics::env_opt_out(),
    }
}

/// The committed side of the repo view's uncommitted list. Paired with a `None`
/// head on [`changes_since`], which snapshots the working tree to answer — so
/// the two together are "what have I changed but not committed".
///
/// Takes an owned `cwd` where every command around it borrows: an async command
/// with a borrowed argument has to return `Result`, and this cannot fail — a
/// `Result` here would be a lie the caller then has to handle.
#[tauri::command]
async fn head_tree(cwd: String) -> Option<String> {
    git::head_tree(&cwd).await
}

#[tauri::command]
async fn work_status(cwd: String) -> git::WorkStatus {
    git::work_status(&cwd).await
}

/// What removing this session's worktree would cost, for the dialog that asks.
///
/// Answers for a session with no worktree too — an all-zero, `exists: false`
/// reading — so the caller has one shape to render rather than a null to
/// branch on.
#[tauri::command]
async fn worktree_disposition(session_id: &str) -> Result<git::WorktreeDisposition, String> {
    let item = store::get_session_index_item(session_id)
        .await
        .map_err(|e| e.to_string())?;

    let Some(item) = item.filter(|i| i.worktree_name.is_some()) else {
        return Ok(git::WorktreeDisposition::default());
    };

    let path = store::worktree_path(&item.project_path, item.worktree_name.as_deref().unwrap());

    Ok(git::worktree_disposition(&path, &item.project_path).await)
}

/// Deletes the session's worktree and its branch, and moves the session to its
/// project root. The session, its transcript and its log all survive.
///
/// Returns the relocated index entry so the frontend replaces its row from
/// what the disk holds rather than from what it hoped the write would do —
/// `set_session_flags` makes the same bargain.
#[tauri::command]
async fn remove_session_worktree(
    session_id: &str,
    manager: State<'_, SessionManager>,
) -> Result<SessionIndexItem, String> {
    manager
        .remove_worktree(session_id)
        .await
        .map_err(|e| e.to_string())
}

/// Removes a session for good: its child, its index entry, and its log. `false`
/// means the index never held the id, which the sidebar treats the same as a
/// success — either way the row it was asked to remove is gone.
#[tauri::command]
async fn delete_session(
    session_id: &str,
    manager: State<'_, SessionManager>,
) -> Result<bool, String> {
    manager.delete(session_id).await.map_err(|e| e.to_string())
}

/// Copies a session onto `fork_id`, to be carried on separately from the one it
/// came from. `worktree` gives the fork a tree of its own rather than leaving it
/// in the parent's directory.
///
/// The id comes from the caller for the same reason a new session's does: this
/// app chooses session ids and the CLI adopts them, and `--fork-session` honours
/// `--session-id` like any other spawn.
///
/// Returns what the fork replays — the parent's log, already copied — so the
/// frontend can open it without a second read.
#[tauri::command]
async fn fork_session(
    session_id: &str,
    fork_id: &str,
    worktree: bool,
    manager: State<'_, SessionManager>,
) -> Result<SessionSnapshot, String> {
    let snapshot = manager
        .fork(session_id, fork_id, worktree)
        .await
        .map_err(|e| e.to_string())?;

    analytics::feature_used("fork");

    Ok(snapshot)
}

/// The agent's own reading of what its context window holds.
///
/// **The command, not a computed estimate.** `/context` is the agent's, it is
/// answered inside the agent (no model call), and its answer carries the six
/// categories — System prompt, Memory, Tools, Skills, Messages, Other — that its
/// own TUI draws and that ACP does not otherwise send. `None` where there is
/// nothing to report: no child up, or a child whose runtime has not counted a run
/// yet.
#[tauri::command]
async fn context_snapshot(
    session_id: String,
    manager: State<'_, SessionManager>,
) -> Result<Option<crate::context::ContextSnapshot>, String> {
    manager.context_snapshot(&session_id).await
}

/// The agent's own roster of the subagents this session started.
///
/// **Live only, and read on the session's own child.** The agent pushes the same
/// shape as `subagent_delegations` whenever the roster moves, so this is for a
/// pane opened after the last push rather than the ordinary path. Nothing here
/// reaches a log: a member names a child session no restart survives.
#[tauri::command]
async fn session_delegations(
    session_id: String,
    manager: State<'_, SessionManager>,
) -> Result<Vec<crate::harness::mcode::delegation::DelegatedMember>, String> {
    manager.delegations(&session_id).await
}

/// Stops every subagent this session's root started, together.
///
/// The only stop there is: mcode publishes no per-task handle over ACP, so a
/// narrower one is not something this app is declining to offer.
#[tauri::command]
async fn stop_session_delegations(
    session_id: String,
    manager: State<'_, SessionManager>,
) -> Result<crate::harness::mcode::delegation::DelegationStop, String> {
    manager.stop_delegations(&session_id).await
}

/// A delegated child's own session, as this app's events.
///
/// **Polled while the child runs, and that is the design rather than a shortcut.**
/// A delegated Session is separate, its stream never reaches the parent's, and the
/// agent reports only its status — so a reader watching one is watching a read,
/// not a subscription. The read attaches nothing on the agent's side, which is
/// what makes repeating it free of consequence.
///
/// **It answers in the app's own event vocabulary**, which is what lets a subagent
/// be drawn by the transcript's own components rather than by a second renderer
/// written for it.
#[tauri::command]
async fn session_delegation_messages(
    session_id: String,
    member_session_id: String,
    limit: Option<u64>,
    manager: State<'_, SessionManager>,
) -> Result<Vec<crate::events::AgentEvent>, String> {
    manager
        .delegation_transcript(&session_id, &member_session_id, limit)
        .await
}

/// Every Skill the agent holds, the switched-off ones included.
///
/// **A management read, not the runtime one.** The list the *model* is told about
/// leaves out a Skill that is switched off, so a screen built on it could switch
/// one off and then have no row left to switch it back on. The child this is asked
/// through is the one [`plugins`] keeps — that module says why it is kept rather
/// than opened per press.
#[tauri::command]
async fn list_plugin_skills() -> Result<crate::plugins::SkillRoster, String> {
    crate::plugins::skills().await.map_err(|e| format!("{e:#}"))
}

/// Switches one Skill, answering whether the registry took it.
#[tauri::command]
async fn set_plugin_skill_enabled(
    name: String,
    enabled: bool,
    location_uri: Option<String>,
) -> Result<crate::plugins::SkillToggle, String> {
    crate::plugins::set_skill_enabled(name, enabled, location_uri)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// One Skill's own text, or `None` for one the registry cannot find.
#[tauri::command]
async fn read_plugin_skill(
    name: String,
    location_uri: Option<String>,
) -> Result<Option<String>, String> {
    crate::plugins::read_skill(name, location_uri)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Every Agent this machine holds, the built-in roles included.
///
/// **A definition, not a Session.** An Agent is what a Session is started
/// *under*; the roster says nothing about what is running, which the delegation
/// events answer instead. Read through the child [`plugins`] keeps, the same one
/// the Skill and MCP screens ask.
#[tauri::command]
async fn list_plugin_agents() -> Result<Vec<crate::plugins::PluginAgent>, String> {
    crate::plugins::agents().await.map_err(|e| format!("{e:#}"))
}

/// One Agent with its stored prompt, or `None` for one that is gone.
#[tauri::command]
async fn get_plugin_agent(name: String) -> Result<Option<crate::plugins::AgentDetail>, String> {
    crate::plugins::agent(name)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Writes a new Agent down, or refuses in the agent's own words.
#[tauri::command]
async fn create_plugin_agent(
    draft: crate::plugins::AgentDraft,
) -> Result<crate::plugins::AgentDetail, String> {
    crate::plugins::create_agent(draft)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Rewrites an Agent's identity and prompt.
#[tauri::command]
async fn update_plugin_agent(
    name: String,
    draft: crate::plugins::AgentDraft,
) -> Result<crate::plugins::AgentDetail, String> {
    crate::plugins::update_agent(name, draft)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Removes an Agent definition, answering whether the store took it.
#[tauri::command]
async fn delete_plugin_agent(name: String) -> Result<bool, String> {
    crate::plugins::delete_agent(name)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Every MCP server this machine has written down, the switched-off ones included.
///
/// **The reader's own store, not what a session can reach.** The agent's other MCP
/// list is what a *session* can reach, and a server switched off is absent from it
/// — so a screen built on that one could switch a server off and never see it again
/// to switch it back on.
///
/// The read carries **no configuration**: `env` and `headers` are credentials, and
/// they arrive only through [`get_plugin_mcp_server`], one server at a time.
#[tauri::command]
async fn list_plugin_mcp_servers(
    keyword: Option<String>,
) -> Result<Vec<crate::plugins::PluginMcpServer>, String> {
    crate::plugins::mcp_servers(keyword)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// One server's whole configuration, or `None` for one that is gone.
#[tauri::command]
async fn get_plugin_mcp_server(
    name: String,
) -> Result<Option<crate::plugins::McpServerDetail>, String> {
    crate::plugins::mcp_server(name)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Writes a server down. Refusals arrive in the agent's own words — a duplicate
/// name, a missing command, a transport that does not take these fields.
#[tauri::command]
async fn create_plugin_mcp_server(
    name: String,
    config: crate::plugins::McpConfig,
) -> Result<crate::plugins::McpServerDetail, String> {
    crate::plugins::create_mcp_server(name, config)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Rewrites a server that is already written down.
#[tauri::command]
async fn update_plugin_mcp_server(
    name: String,
    config: crate::plugins::McpConfig,
) -> Result<crate::plugins::McpServerDetail, String> {
    crate::plugins::update_mcp_server(name, config)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn delete_plugin_mcp_server(name: String) -> Result<bool, String> {
    crate::plugins::delete_mcp_server(name)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn set_plugin_mcp_server_enabled(
    name: String,
    enabled: bool,
) -> Result<crate::plugins::PluginMcpServer, String> {
    crate::plugins::set_mcp_server_enabled(name, enabled)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Connects once and answers what happened — apart from saving, because an entry
/// can be written down cleanly and still be unreachable.
#[tauri::command]
async fn test_plugin_mcp_server(name: String) -> Result<crate::plugins::McpTestResult, String> {
    crate::plugins::test_mcp_server(name)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Stops the in-flight turn without killing the session — the CLI aborts its
/// tools and streaming, ends the turn, and stays alive for the next prompt.
#[tauri::command]
async fn interrupt_session(
    session_id: &str,
    manager: State<'_, SessionManager>,
    app: AppHandle,
) -> Result<(), String> {
    manager
        .interrupt(session_id, &app)
        .await
        .map_err(|e| e.to_string())
}

/// Takes back the newest prompt still held for a running turn, returning its
/// text so the composer can restore it. `None` once the flush has written it —
/// past that point the CLI owns the prompt and there is no way to retract it.
#[tauri::command]
async fn cancel_queued(
    session_id: &str,
    manager: State<'_, SessionManager>,
) -> Result<Option<QueuedMessage>, String> {
    Ok(manager.cancel_queued(session_id).await)
}

/// Hands the held prompts into the running turn and answers how many went.
///
/// The alternative to `interrupt_session`, which is the only other way a held
/// prompt reaches the agent early — and which throws the turn away to do it. The
/// session's own queue is emptied here rather than by the frontend, since the
/// backend is what drained it.
#[tauri::command]
async fn steer_queued(
    session_id: &str,
    manager: State<'_, SessionManager>,
    app: AppHandle,
) -> Result<usize, String> {
    manager
        .steer_queued(session_id, &app)
        .await
        .map_err(|e| e.to_string())
}

/// Answers a permission request the agent is blocked on. `option_id` names one
/// of the options carried on the `permission_requested` event — the standing
/// rule it may apply never leaves the backend, so the frontend cannot widen a
/// grant beyond what the CLI proposed.
#[tauri::command]
async fn respond_permission(
    session_id: &str,
    request_id: &str,
    option_id: &str,
    manager: State<'_, SessionManager>,
    app: AppHandle,
) -> Result<(), String> {
    manager
        .respond_permission(session_id, request_id, option_id, &app)
        .await
        .map_err(|e| e.to_string())
}

/// Answers the questions on a `questions_asked` event. `answers` is keyed by
/// each question's verbatim text — the CLI matches on the string — and a
/// question left out of it is one the user skipped, which is a real answer
/// rather than a refusal.
#[tauri::command]
async fn answer_questions(
    session_id: &str,
    request_id: &str,
    answers: HashMap<String, String>,
    manager: State<'_, SessionManager>,
    app: AppHandle,
) -> Result<(), String> {
    manager
        .answer_questions(session_id, request_id, answers, &app)
        .await
        .map_err(|e| e.to_string())
}

/// Clears a finished session's unread mark. The frontend calls this when the
/// user views the session; a `completed` badge is "finished and unread", so
/// reading is what retires it. Returns the status as written, `None` when
/// nothing changed — the session wasn't `completed`, or the id is unknown.
#[tauri::command]
async fn mark_session_idle(
    session_id: &str,
    manager: State<'_, SessionManager>,
) -> Result<Option<SessionStatus>, String> {
    manager
        .mark_idle(session_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before the builder, so a panic while the app is still coming up — the
    // window nobody could report from — is covered like any other.
    analytics::install_panic_hook();

    // And before the window, which is what opens the webview's storage under
    // whichever identifier this build carries — see `identity`.
    identity::adopt_previous_identity();

    tauri::Builder::default()
        .plugin(tauri_plugin_macos_permissions::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SessionManager::default())
        .manage(updater::PendingUpdate::default())
        .manage(quit::PendingQuit::default())
        .manage(transcription::TranscriptionState::default())
        .menu(quit::menu)
        .on_menu_event(|app, event| {
            if event.id() == quit::QUIT_ID {
                quit::request(app);
            } else if event.id() == updater::CHECK_UPDATE_ID {
                if let Err(e) = app.emit(updater::CHECK_UPDATE_REQUESTED, ()) {
                    eprintln!("[check update emit err] {e}");
                }
            }
        })
        .on_window_event(|window, event| {
            // The dialog answers with `confirm_quit`, which exits outright — so
            // this arm never has to let a close through.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                quit::request(window.app_handle());
            }
        })
        .setup(|app| {
            // Chromium first: it patches NSApp and starts its pump, and every
            // window already exists here for it to parent a view into.
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::init(app.handle());
            // A persisted `in_progress` can't be true anymore — no child
            // survived the restart. Spawned, not awaited: the reset needs no
            // window, and the frontend's first fetch lands well after it.
            tauri::async_runtime::spawn(async {
                if let Err(e) = store::reset_in_progress_sessions().await {
                    eprintln!("[status reset err] {e}");
                }
                // Sessions whose worktree was deleted before the index had a
                // field for it, which is what their PR tab reads to know its
                // branch outranks the shared checkout's HEAD.
                if let Err(e) = store::backfill_removed_worktrees().await {
                    eprintln!("[worktree backfill err] {e}");
                }
                // Dictations kept past a failure. Pruning on write alone left
                // the last one on disk forever, since nothing else sweeps them
                // and a reader who gives up after one failure writes no more.
                transcription::recordings::prune().await;
            });

            // Orchestration is a side channel: a socket that won't bind must
            // cost the feature, never the app. Logged and dropped for that
            // reason — there is nothing the reader could act on either.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = orchestration::serve(handle).await {
                    eprintln!("[orchestration err] {e:#}");
                }
            });

            // Prompts that run themselves. A task in this process rather than a
            // daemon — an automation nobody can watch run is one the reader finds
            // out about by reading a diff they did not expect. See `automations`.
            automations::start(app.handle().clone());

            // Returns immediately: consent is read, and the id minted, inside
            // the task `track` spawns — so nothing on screen waits on a file
            // read and an opted-out install still sends nothing.
            analytics::app_started();
            // The guaranteed half of `active_day`: `focus.ts` reports focus
            // *changes*, so a window that comes up already frontmost never
            // reports gaining it, and somebody who opens hz, works and quits
            // without switching apps would go uncounted. Free to state beside
            // the other two sites — all three claim one daily key.
            analytics::active_day();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_msg,
            read_attachments,
            write_pasted_text,
            list_models,
            list_providers,
            list_provider_presets,
            add_provider,
            remove_provider,
            test_provider,
            refresh_models,
            git::undo_turn,
            prepare_session,
            agent_availability,
            automations::list_automations,
            automations::create_automation,
            automations::delete_automation,
            automations::set_automation_enabled,
            search::search_transcripts,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_open,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_tabs,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_activate,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_close,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_nav,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_layout,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_shutter_ready,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_zoom,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_devtools,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::browser_pick,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            cef::automation::browser_snapshot,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            chromium::chromium_status,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            chromium::chromium_download,
            #[cfg(all(feature = "cef", target_os = "macos"))]
            chromium::chromium_remove,
            local_servers::list_local_servers,
            get_settings,
            set_analytics_enabled,
            get_preferences,
            set_preferences,
            analytics_identity,
            track_feature,
            track_active_day,
            files::warm_file_index,
            files::search_files,
            files::list_dir,
            files::read_file,
            store::list_session_index_items,
            store::get_session_by_id,
            projects::list_projects,
            projects::add_project,
            projects::remove_project,
            projects::set_last_selected_project,
            projects::set_project_space,
            projects::retag_space,
            git::list_branches,
            git::checkout_branch,
            git::project_repos,
            git::changes_since,
            git::file_change,
            head_tree,
            git::log_commits,
            git::log_branch_commits,
            work_status,
            store::set_session_flags,
            store::detach_session,
            delete_session,
            fork_session,
            worktree_disposition,
            remove_session_worktree,
            mark_session_idle,
            interrupt_session,
            context_snapshot,
            session_delegations,
            stop_session_delegations,
            session_delegation_messages,
            list_plugin_skills,
            set_plugin_skill_enabled,
            read_plugin_skill,
            list_plugin_mcp_servers,
            get_plugin_mcp_server,
            create_plugin_mcp_server,
            update_plugin_mcp_server,
            delete_plugin_mcp_server,
            set_plugin_mcp_server_enabled,
            test_plugin_mcp_server,
            list_plugin_agents,
            get_plugin_agent,
            create_plugin_agent,
            update_plugin_agent,
            delete_plugin_agent,
            cancel_queued,
            steer_queued,
            respond_permission,
            answer_questions,
            notifications::notify_session,
            updater::check_update,
            updater::install_update,
            issues::get_integrations,
            issues::connect_linear,
            issues::disconnect_linear,
            issues::list_issues,
            issues::get_issue,
            issues::fetch_issue_asset,
            issues::list_issue_filters,
            issues::unlink_issue,
            issues::update_issue,
            github::prs_for_branch,
            github::pr_marks,
            github::list_pull_requests,
            github::list_workflow_runs,
            github::get_workflow_run,
            github::rerun_workflow,
            github::get_run_log,
            github::merge_pr,
            github::delete_branch,
            github::reopen_pr,
            github::mark_pr_ready,
            github::comment_on_pr,
            github::reply_to_thread,
            github::set_thread_resolved,
            github::submit_review,
            github::request_reviewers,
            github::close_pr,
            github::recheck_gh,
            github::source_control_state,
            quit::confirm_quit,
            quit::dismiss_quit,
            docs::read_doc,
            docs::save_doc,
            docs::watch_docs,
            apps::list_open_apps,
            apps::open_in_app,
            apps::open_login_terminal,
            transcription::transcription_status,
            transcription::download_transcription_model,
            transcription::cancel_transcription_download,
            transcription::delete_transcription_model,
            transcription::select_transcription_model,
            transcription::select_transcription_device,
            transcription::set_transcription_mute,
            transcription::start_transcription,
            transcription::transcription_level,
            transcription::stop_transcription,
            transcription::retry_transcription,
            transcription::cancel_transcription,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            // The record of what the output was before a dictation muted it
            // lives in this process and nowhere else, so quitting mid-recording
            // is the one ordinary way to leave a machine silent with nothing
            // left to undo it. Synchronous and blocking, since the runtime is
            // already going down and there is nothing to spawn onto. A hard
            // kill still gets past this — see `Known issues`.
            if matches!(event, tauri::RunEvent::Exit) {
                transcription::audio::restore_other_audio();
                // The Plugins screen's child is nobody's session and outlives no
                // app: a quit that left it running would leave an agent process
                // the reader can neither see nor reach. Synchronous for the same
                // reason the restore above is — there is no executor left to
                // await the polite close on, and the process ends below.
                plugins::close_now();
                // Tao ends the process with `process::exit`, which runs the C
                // atexit chain — and ggml-metal's global device registry frees
                // its Metal residency sets there, after the Metal runtime is
                // already down, and `ggml_abort`s. So every quit filed a crash
                // report. `process::exit` skips every Rust destructor anyway,
                // so skipping the C half too costs nothing we still rely on.
                //
                // It skips the rest of Tauri's own exit arm too, which is where
                // `AppHandle::restart` relaunches from — so `restart` here is a
                // quit that never comes back. That was DRA-160; the updater
                // launches the new bundle itself before asking to exit.
                unsafe { libc::_exit(0) }
            }
        });
}
