//! What the agent holds beyond a session — its Skills — and the child that answers.
//!
//! **The reader that speaks the wire is separate**
//! ([`harness::mcode::skills`](crate::harness::mcode::skills)), for the reason
//! [`context`](crate::context) is split from its own: a wire format belongs to the
//! agent that wrote it and moves whenever it does, while what this screen draws —
//! a name, a sentence, a switch — is this app's vocabulary. A second agent answers
//! its own way and maps onto these same rows.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::LazyLock;
use std::time::Instant;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;

use crate::harness::mcode::{self, Control, CONTROL_IDLE};

/// One Skill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PluginSkill {
    /// The registry's own name for it, and what a switch is addressed to.
    pub name: String,
    /// What the row is called on screen — the agent's own label where it has one.
    pub display_name: String,
    pub description: String,
    /// Whether the model is told about it. **A Skill switched off keeps its row**,
    /// which is the whole reason this screen can switch one back on.
    pub enabled: bool,
    /// Where it came from, in the agent's own words — `user`, `builtin-global`,
    /// `builtin-agent`. Carried verbatim rather than mapped onto an enum of ours,
    /// for the reason [`ContextComponent`](crate::context::ContextComponent)
    /// gives: a kind added after this build should draw as itself rather than as
    /// nothing.
    pub source_kind: Option<String>,
    /// The registry's own key for it. Handed back on a switch so a Skill renamed
    /// between the read and the press still moves the right one.
    pub location_uri: Option<String>,
}

/// The roster as the screen reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SkillRoster {
    pub skills: Vec<PluginSkill>,
    /// Whether the agent holds more than it answered with.
    pub has_more: bool,
}

/// What a switch did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SkillToggle {
    pub name: String,
    /// The state that was asked for.
    pub enabled: bool,
    /// **Not the same thing as `enabled`.** The registry answers nothing for a
    /// Skill it does not recognise, and a screen that read the flag for the
    /// outcome would draw a switch that moved over a Skill nobody changed.
    pub applied: bool,
}

/// One Agent this machine holds — a definition a Session is started *under*.
///
/// **Not a Session and not a subagent.** Three are built in (`explore`,
/// `worker`, `verifier`) and the reader may write their own; a `task` call names
/// one in its `agent_name`, which is why a screen for them belongs beside the
/// Tools the agent can reach.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PluginAgent {
    /// The store's own key for it, and what a write addresses.
    pub name: String,
    /// What the row is called on screen — the agent's own label where it has one.
    pub display_name: String,
    pub description: Option<String>,
    /// A built-in portrait marker (`mavis-agent-avatar://default/v1/N`) or an
    /// image, as stored. The frontend decides which of the two it is drawing.
    pub avatar: Option<String>,
    /// The role it plays, in the agent's own words.
    pub agent_role: String,
    /// Where it came from — `builtin`, `manual`, and whatever the agent adds
    /// later. Carried verbatim rather than mapped onto an enum of ours, for the
    /// reason [`PluginSkill::source_kind`] gives.
    pub creation_source: String,
    /// Whether the agent ships it. Derived here from `creation_source` so the
    /// screen files built-ins apart without keeping its own list of names — a
    /// role added after this build files itself correctly.
    pub builtin: bool,
}

/// One Agent with its stored prompt — the read a form opens on.
///
/// **The prompt rides this read and never the listing.** A roster carrying every
/// prompt would be whole documents for a screen drawing names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct AgentDetail {
    pub agent: PluginAgent,
    pub system_prompt: Option<String>,
    pub persona: Option<String>,
}

/// What the form writes down.
///
/// **Absent means "leave it as stored".** One shape serves a creation and a
/// rewrite, so a screen that only changed the prompt cannot blank the
/// description by not mentioning it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct AgentDraft {
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub avatar: Option<String>,
    pub system_prompt: Option<String>,
    pub persona: Option<String>,
    /// The model the Agent runs on, as a source-qualified key.
    ///
    /// **Not decoration: the store will not save an Agent without a resolvable
    /// model.** An Agent that inherits the runtime default is resolved through
    /// that default's context window, and where the catalog carries no physical
    /// limit for it the write is refused outright. Left empty, the create fills
    /// it from the machine's own default — see [`create_agent`].
    pub model: Option<String>,
}

/// One MCP server this machine has written down, as a row.
///
/// **The reader's own store, not what a session can reach.** The agent keeps two
/// MCP lists: the other one is what a *session* can reach — built-ins, the
/// project's own file, the session's own set — and a server switched off is not in
/// it at all. A screen with switches in it needs this one, because otherwise
/// switching a server off would take its own row away.
///
/// **No configuration rides here.** `env` and `headers` hold credentials, and a
/// listing drawn to show names has no business carrying every secret on the
/// machine — [`McpServerDetail`] is the one read that does, and it is asked for one
/// server at a time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PluginMcpServer {
    pub name: String,
    pub enabled: bool,
    /// The agent's own word for how it talks: `stdio`, `http`, `streamable-http` or
    /// `sse`. Carried verbatim rather than mapped onto an enum of ours, for the
    /// reason [`PluginSkill::source_kind`] gives — a transport added after this
    /// build should draw as itself.
    pub transport: String,
    pub description: Option<String>,
    /// The command for a stdio server, or the URL for a remote one — and never the
    /// arguments, the environment or the headers.
    pub endpoint: Option<String>,
}

/// How a server talks, as the form on the other side spells it.
///
/// **Flat, with the fields of both transports.** The form switches between them
/// and the fields follow it, so the shape it holds is one object with both; the
/// agent narrows this to its own union — a stdio server has no `url` — at the
/// boundary that owns that rule. Kept flat here too rather than mirrored as a Rust
/// enum: an enum would make this app the second place the rule lives, and two
/// copies of it is one copy that can be wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<BTreeMap<String, String>>,
    pub url: Option<String>,
    pub headers: Option<BTreeMap<String, String>>,
    pub timeout_ms: Option<u64>,
    pub description: Option<String>,
}

/// One server with its whole configuration — the read the edit form opens on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpServerDetail {
    pub name: String,
    pub enabled: bool,
    pub config: McpConfig,
}

/// One tool a server offers.
///
/// The name and the sentence the server wrote about it, and **not** its input
/// schema: a schema per tool is a payload nothing drawing a list reads, and the
/// reader who wants one is asking the agent, not this screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpTool {
    pub name: String,
    pub description: Option<String>,
}

/// What a connection test answered.
///
/// **`success: false` with a code rather than an error.** A server that saves
/// cleanly and cannot be reached is the ordinary failure here, and the code is what
/// tells "the command is not installed" from "the handshake failed" — two different
/// things for the reader to go and do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct McpTestResult {
    pub success: bool,
    pub tool_count: Option<u64>,
    /// What the server offers, empty on a failure.
    ///
    /// **Already in the agent's hand when it counted them**, so this is not a second
    /// connection — it is the same answer with the list kept instead of thrown away.
    /// Defaulted, because a failure has no tools to speak of and should read as none
    /// rather than as a reply this build could not parse.
    #[serde(default)]
    pub tools: Vec<McpTool>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

/// The one control child, if one is up.
///
/// **One, process-wide, and that is the point.** It is a resident agent process —
/// a few hundred megabytes, measured at 278–426MB while booting — so a slot per
/// caller would be a slot too many. It is opened on the first question and every
/// question after it reuses that same child. `None` is the ordinary state: nothing
/// has asked yet, or the reader has left the screen and the reap has taken it.
static CONTROL: LazyLock<Mutex<Option<Control>>> = LazyLock::new(|| Mutex::new(None));

/// A question and its answer, boxed so one slot can serve several shapes of both.
///
/// A closure returning a boxed future rather than a plain one: the future borrows
/// the session it was handed, and naming that lifetime here is what lets the same
/// slot answer a roster, a switch and a read without three copies of
/// [`with_control`].
type Question<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

/// Every Skill the agent holds, the switched-off ones included.
pub async fn skills() -> Result<SkillRoster> {
    with_control(|session| Box::pin(mcode::skills::roster(session))).await
}

/// Switches one Skill on or off.
pub async fn set_skill_enabled(
    name: String,
    enabled: bool,
    location_uri: Option<String>,
) -> Result<SkillToggle> {
    with_control(move |session| {
        Box::pin(async move {
            mcode::skills::set_enabled(session, &name, enabled, location_uri.as_deref()).await
        })
    })
    .await
}

/// One Skill's own text, or `None` for one the registry cannot find.
pub async fn read_skill(name: String, location_uri: Option<String>) -> Result<Option<String>> {
    with_control(move |session| {
        Box::pin(async move { mcode::skills::read(session, &name, location_uri.as_deref()).await })
    })
    .await
}

/// Every MCP server this machine has written down, the switched-off ones included.
pub async fn mcp_servers(keyword: Option<String>) -> Result<Vec<PluginMcpServer>> {
    with_control(move |session| {
        Box::pin(async move { mcode::mcp::list(session, keyword.as_deref()).await })
    })
    .await
}

/// One server's whole configuration, or `None` for one that is gone.
pub async fn mcp_server(name: String) -> Result<Option<McpServerDetail>> {
    with_control(move |session| Box::pin(async move { mcode::mcp::get(session, &name).await })).await
}

/// Writes a server down, or refuses — in the agent's own words.
pub async fn create_mcp_server(name: String, config: McpConfig) -> Result<McpServerDetail> {
    with_control(move |session| {
        Box::pin(async move { mcode::mcp::create(session, &name, &config).await })
    })
    .await
}

/// Rewrites a server that is already written down.
pub async fn update_mcp_server(name: String, config: McpConfig) -> Result<McpServerDetail> {
    with_control(move |session| {
        Box::pin(async move { mcode::mcp::update(session, &name, &config).await })
    })
    .await
}

pub async fn delete_mcp_server(name: String) -> Result<bool> {
    with_control(move |session| Box::pin(async move { mcode::mcp::delete(session, &name).await }))
        .await
}

pub async fn set_mcp_server_enabled(name: String, enabled: bool) -> Result<PluginMcpServer> {
    with_control(move |session| {
        Box::pin(async move { mcode::mcp::set_enabled(session, &name, enabled).await })
    })
    .await
}

/// Connects once and answers what happened.
pub async fn test_mcp_server(name: String) -> Result<McpTestResult> {
    with_control(move |session| Box::pin(async move { mcode::mcp::test(session, &name).await }))
        .await
}

/// Every Agent this machine holds, the built-in roles included.
pub async fn agents() -> Result<Vec<PluginAgent>> {
    with_control(|session| Box::pin(mcode::agents::roster(session))).await
}

/// One Agent with its stored prompt, or `None` for one that is gone.
pub async fn agent(name: String) -> Result<Option<AgentDetail>> {
    with_control(move |session| Box::pin(async move { mcode::agents::get(session, &name).await }))
        .await
}

/// Writes a new Agent down, or refuses in the agent's own words.
///
/// **The machine's default model is filled in when the draft names none**, and
/// that is what keeps the Agent editable afterwards: one that inherits the runtime
/// default is resolved through that default's context window, and where the
/// catalog carries no physical limit for it the store refuses every later save.
///
/// Best effort — a config with no `defaultModel` at all leaves the draft as it is,
/// and the store's own refusal is then the answer the reader gets.
pub async fn create_agent(mut draft: AgentDraft) -> Result<AgentDetail> {
    if named(&draft.model).is_none() {
        match mcode::providers::default_model().await {
            Ok(model) => draft.model = model,
            Err(error) => eprintln!("[hz] could not read the agent's default model: {error:#}"),
        }
    }

    with_control(move |session| {
        Box::pin(async move { mcode::agents::create(session, &draft).await })
    })
    .await
}

/// A name that says something, or `None` for one that is blank.
fn named(value: &Option<String>) -> Option<&str> {
    value.as_deref().map(str::trim).filter(|name| !name.is_empty())
}

/// Rewrites an Agent's identity and prompt. Absent fields are left as stored.
pub async fn update_agent(name: String, draft: AgentDraft) -> Result<AgentDetail> {
    with_control(move |session| {
        Box::pin(async move { mcode::agents::update(session, &name, &draft).await })
    })
    .await
}

/// Removes an Agent definition, answering whether the store took it.
pub async fn delete_agent(name: String) -> Result<bool> {
    with_control(move |session| Box::pin(async move { mcode::agents::delete(session, &name).await }))
        .await
}

/// Winds the child down, for the quit path.
///
/// **Synchronous and best-effort, and both are the point.** `RunEvent::Exit` runs
/// without an executor and the process is about to end, so the polite close cannot
/// be awaited and there is nothing to report a failure to. A child already gone is
/// not an error; the alternative is an agent process left behind by a quit, which
/// nobody can see or reach.
///
/// **Taken out of the slot as well as killed**, which is not tidiness: a killed
/// child left in the slot is one the next question is handed, so it answers with a
/// broken pipe — and the only caller that could tell the difference is the one that
/// asks again.
pub fn close_now() {
    if let Ok(mut slot) = CONTROL.try_lock() {
        if let Some(mut control) = slot.take() {
            control.kill_now();
        }
    }
}

/// Runs one question against the control child, opening one if there is none.
async fn with_control<T>(
    question: impl for<'a> FnOnce(&'a mcode::McodeSession) -> Question<'a, T>,
) -> Result<T> {
    let mut slot = CONTROL.lock().await;

    // Reaped on the way in as well as by the sleeper below: a reader who leaves
    // the screen and comes back an hour later would otherwise find a child that
    // has been idle since they left, with nothing left to close it but the next
    // question.
    if slot.as_ref().is_some_and(Control::is_idle) {
        if let Some(stale) = slot.take() {
            stale.close().await;
        }
    }

    if slot.is_none() {
        *slot = Some(
            mcode::open_control()
                .await
                .context("could not start the agent to ask it about the reader's plugins")?,
        );
    }

    // The session is cloned out so the slot is free for the failure arm below: a
    // clone of one is an `Arc` and a string, and the alternative is a borrow that
    // spans the call and cannot be dropped in time.
    let (asked_at, session) = {
        let control = slot.as_mut().expect("a control child was just ensured");
        control.asked_at = Instant::now();
        (control.asked_at, control.session.clone())
    };

    match question(&session).await {
        Ok(answer) => {
            schedule_reap(asked_at);
            Ok(answer)
        }
        // **A failed question takes the child with it.** What can fail here is the
        // transport or the protocol — a Skill the registry does not know is a
        // successful call carrying `applied: false` — so a child that errored is
        // one that stopped answering, and the next press should open a fresh one
        // rather than talk to that one again.
        Err(error) => {
            if let Some(dead) = slot.take() {
                dead.close().await;
            }
            Err(error)
        }
    }
}

/// Winds the child down if nothing asks again before it goes idle.
///
/// **The sleeper only ever looks.** One is spawned per question and each is cheap
/// because it holds nothing: on waking it closes the child only where the slot
/// still carries the `asked_at` it went to sleep with, so a question asked in the
/// meantime makes this one a no-op. Cancelling a previous sleeper instead would be
/// the same answer with a handle to keep in step.
fn schedule_reap(asked_at: Instant) {
    tokio::spawn(async move {
        tokio::time::sleep(CONTROL_IDLE).await;

        let mut slot = CONTROL.lock().await;
        let still_idle = slot
            .as_ref()
            .is_some_and(|control| control.asked_at == asked_at);
        if still_idle {
            if let Some(control) = slot.take() {
                control.close().await;
            }
        }
    });
}

/// Held by every test below, because they share the one thing this module holds
/// process-wide: [`CONTROL`].
///
/// **Two of these at once do not each get their own child.** They take the same
/// slot, so one test's question can arrive on a child the other has just torn down
/// — and the failure that follows names the wrong test, because the assertion that
/// trips belongs to whichever happened to be mid-question. Serialised rather than
/// merged into one test: one child is the resource, and two behaviours failing for
/// two reasons should say so separately.
#[cfg(test)]
static PLUGIN_TESTS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// **The whole plugins path in one assertion.** Open the control child against the
/// agent this app ships, read the roster off it, switch a Skill off, read the
/// roster again, read that Skill's text, and put the switch back.
///
/// **The second read is the assertion that matters.** The agent has two skill
/// lists and only one of them keeps a switched-off Skill as a row — so a build
/// that read the other one would pass every check here except this one, and would
/// be a screen where switching a Skill off makes it unreachable forever.
///
/// Ignored by default: it spawns the shipped agent and pays the cold boot. It is
/// what to run after touching [`open_control`](crate::harness::mcode::open_control)
/// or `harness::mcode::skills`, because it is the only test that exercises the
/// spawn, the handshake and the three extension methods together.
#[tokio::test]
#[ignore = "spawns the shipped agent"]
async fn the_shipped_agent_answers_about_its_skills() {
    let _serialised = PLUGIN_TESTS.lock().await;
    let roster = skills().await.expect("the agent answers with a roster");
    assert!(
        !roster.skills.is_empty(),
        "the agent listed no Skills: {roster:?}"
    );

    let target = roster
        .skills
        .iter()
        .find(|skill| skill.enabled)
        .cloned()
        .expect("some Skill is switched on");

    let off = set_skill_enabled(target.name.clone(), false, target.location_uri.clone())
        .await
        .expect("the agent switches a Skill off");
    assert!(off.applied, "the registry did not take the switch: {off:?}");

    let after = skills().await.expect("the agent answers with a roster");
    let still = after
        .skills
        .iter()
        .find(|skill| skill.name == target.name)
        .unwrap_or_else(|| panic!("the switched-off Skill left the roster: {after:?}"));
    assert!(!still.enabled, "the roster did not move the switch");

    let text = read_skill(target.name.clone(), target.location_uri.clone())
        .await
        .expect("the agent reads a Skill");
    assert!(
        text.is_some_and(|text| !text.trim().is_empty()),
        "the Skill read back empty"
    );

    // Put back what this machine had. A test that left a Skill switched off would
    // be a test that changed the reader's setup.
    let on = set_skill_enabled(target.name.clone(), true, target.location_uri.clone())
        .await
        .expect("the agent switches it back on");
    assert!(on.applied, "the switch back on was not taken: {on:?}");

    // The child is a process and this binary is about to end: without this it
    // would be orphaned rather than reaped, since a `static` is never dropped.
    close_now();
}

/// **The whole MCP path in one assertion.** Write a server down, list it, read its
/// configuration back, switch it off, list it again, test it, rewrite it as a
/// remote one, and delete it.
///
/// **The second listing is the assertion that matters**, for the reason the Skill
/// test gives: the agent keeps two MCP lists and only the configured one keeps a
/// switched-off server as a row. A build reading what a session can reach would
/// pass everything else here and still be a screen where switching a server off
/// makes it unreachable.
///
/// Ignored by default: it spawns the shipped agent and **writes to the reader's own
/// MCP store**. It deletes what it made, and sweeps its own name on the way in, so
/// a run killed part-way leaves one server behind rather than a permanent refusal.
#[tokio::test]
#[ignore = "spawns the shipped agent and writes to its MCP store"]
async fn the_shipped_agent_writes_down_an_mcp_server() {
    let _serialised = PLUGIN_TESTS.lock().await;
    const NAME: &str = "hz-test-server";

    // A previous run killed part-way could have left this behind, and a duplicate
    // name is a refusal — so the floor is swept before anything is asserted.
    let _ = delete_mcp_server(NAME.to_string()).await;

    let stdio = McpConfig {
        transport: "stdio".to_string(),
        command: Some("/bin/echo".to_string()),
        args: Some(vec!["hello".to_string()]),
        env: None,
        url: None,
        headers: None,
        timeout_ms: None,
        description: Some("written by a test".to_string()),
    };

    let created = create_mcp_server(NAME.to_string(), stdio)
        .await
        .expect("the agent writes the server down");
    assert_eq!(created.name, NAME);
    assert!(created.enabled, "a new server should arrive switched on");

    let listed = mcp_servers(None).await.expect("the agent lists its servers");
    assert!(
        listed.iter().any(|server| server.name == NAME),
        "the new server is not in the listing: {listed:?}"
    );

    // The whole configuration comes back — this is what the edit form opens on, and
    // the listing deliberately does not carry it.
    let read = mcp_server(NAME.to_string())
        .await
        .expect("the agent reads the server")
        .expect("the server it just wrote is there");
    assert_eq!(read.config.command.as_deref(), Some("/bin/echo"));
    assert_eq!(read.config.args.as_deref(), Some(&["hello".to_string()][..]));

    set_mcp_server_enabled(NAME.to_string(), false)
        .await
        .expect("the agent moves the switch");

    let after = mcp_servers(None).await.expect("the agent lists its servers");
    let found = after
        .iter()
        .find(|server| server.name == NAME)
        .unwrap_or_else(|| panic!("the switched-off server left the listing: {after:?}"));
    assert!(!found.enabled, "the listing did not move the switch");

    // A switched-off server is refused rather than dialled, and that refusal is an
    // answer: `success: false` with the agent's own code.
    let tested = test_mcp_server(NAME.to_string())
        .await
        .expect("the agent answers a test");
    assert!(!tested.success);
    assert_eq!(tested.error_code.as_deref(), Some("MCP_SERVER_DISABLED"));

    // The other transport, which is where the flat shape earns its keep: nothing of
    // the stdio half may survive into it.
    let remote = update_mcp_server(
        NAME.to_string(),
        McpConfig {
            transport: "http".to_string(),
            command: None,
            args: None,
            env: None,
            url: Some("https://example.test/mcp".to_string()),
            headers: None,
            timeout_ms: None,
            description: None,
        },
    )
    .await
    .expect("the agent rewrites the server");
    assert_eq!(remote.config.url.as_deref(), Some("https://example.test/mcp"));
    assert!(
        remote.config.command.is_none(),
        "the stdio half survived the rewrite: {remote:?}"
    );

    assert!(
        delete_mcp_server(NAME.to_string())
            .await
            .expect("the agent deletes it"),
        "the delete answered that nothing was removed"
    );

    close_now();
}

/// **The whole Agents path in one assertion.** Open the control child, list the
/// roster (the three built-in roles are on it), write a scratch Agent down, read
/// it back with its prompt, rewrite the prompt, and delete it.
///
/// **The built-in check is the assertion that matters.** If the store does not
/// surface the shipped roles through this seam, the screen would open on an
/// empty list on every machine — a feature that looks like a machine with no
/// agents rather than like a broken read.
///
/// Ignored by default: it spawns the shipped agent and **writes to the reader's
/// own Agent store**. It deletes what it made, and sweeps its own name on the way
/// in, so a run killed part-way leaves one Agent behind rather than a permanent
/// refusal.
#[tokio::test]
#[ignore = "spawns the shipped agent and writes to its Agent store"]
async fn the_shipped_agent_writes_down_an_agent() {
    let _serialised = PLUGIN_TESTS.lock().await;
    const NAME: &str = "hz-test-agent";

    // A previous run killed part-way could have left this behind, and a duplicate
    // name is a refusal — so the floor is swept before anything is asserted.
    let _ = delete_agent(NAME.to_string()).await;

    let roster = agents().await.expect("the agent answers with a roster");
    for role in ["explore", "worker", "verifier"] {
        assert!(
            roster.iter().any(|agent| agent.name == role && agent.builtin),
            "the built-in {role} is missing from the roster: {roster:?}"
        );
    }

    let created = create_agent(AgentDraft {
        name: Some(NAME.to_string()),
        display_name: Some("Hz Test Agent".to_string()),
        description: Some("written by a test".to_string()),
        avatar: None,
        system_prompt: Some("You are a test.".to_string()),
        persona: None,
        // Left empty on purpose: the create fills it from the machine's own
        // default, and the rewrite below is what proves it took — a model-less
        // Agent is refused by the store's model gate.
        model: None,
    })
    .await
    .expect("the agent writes the Agent down");
    assert_eq!(created.agent.name, NAME);
    assert!(!created.agent.builtin, "a written Agent is not a built-in");

    // The prompt rides the `get` read and never the listing.
    let read = agent(NAME.to_string())
        .await
        .expect("the agent reads the Agent")
        .expect("the Agent it just wrote is there");
    assert_eq!(read.system_prompt.as_deref(), Some("You are a test."));

    // One field changed, and the one not mentioned survives — which is what an
    // absent-mean-leave-it draft is for.
    let rewritten = update_agent(
        NAME.to_string(),
        AgentDraft {
            system_prompt: Some("You are a rewritten test.".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect("the agent rewrites the Agent");
    assert_eq!(
        rewritten.system_prompt.as_deref(),
        Some("You are a rewritten test.")
    );
    assert_eq!(
        rewritten.agent.display_name, "Hz Test Agent",
        "the field the draft did not mention was blanked"
    );

    assert!(
        delete_agent(NAME.to_string())
            .await
            .expect("the agent deletes it"),
        "the delete answered that nothing was removed"
    );

    close_now();
}

/// **The delegation read is registered, and it refuses a stranger.**
///
/// The panel that draws a subagent's work is only ever as good as this request,
/// and the failure it must never have is the quiet one: a read that answered
/// somebody else's session because the membership check was missing or wrong.
/// The control child has a session of its own and no children, so any id is
/// somebody else's.
///
/// Ignored by default: it spawns the shipped agent.
#[tokio::test]
#[ignore = "spawns the shipped agent"]
async fn the_shipped_agent_refuses_to_read_a_session_that_is_not_its_child() {
    let _serialised = PLUGIN_TESTS.lock().await;

    let refused = with_control(|session| {
        Box::pin(mcode::delegation::transcript(session, "mvs_not_a_child", None))
    })
    .await;

    assert!(
        refused.is_err(),
        "a foreign session was read as if it were a delegated child: {refused:?}"
    );

    close_now();
}
