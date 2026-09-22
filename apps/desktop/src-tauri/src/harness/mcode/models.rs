//! Where mcode's model list comes from — and it is the agent that states it.
//!
//! There is no `mcode models` to ask: the list arrives with a **session**, on
//! `session/new`'s `configOptions`, and every `session/set_config_option` reply
//! restates it. That is the same shape fx reports through, and it is a stronger
//! one than a catalog: every row here is a model the agent will actually accept
//! right now, on the account and providers this machine is configured with.
//!
//! Rejected: `mcode provider list`, which names providers and the models
//! *configured* under them — not what the session will take, and nothing about
//! a managed account's own catalog.
//!
//! **Every session states the list, so a live one is the better probe.**
//! Nothing before a session names a model, so the composer's picker would be
//! empty until the reader had already sent something — and the obvious cure,
//! opening a session of its own to ask, is a second child booted beside the
//! session already up. Measured: that boot is the whole cost and `session/new`
//! is not (1.0s to answer `initialize`, then 0.02s per session on a child that
//! has already done it). So the reply is taken wherever it is read, in
//! [`remember_configs`] — on every `session/new`, `session/resume`,
//! `session/fork` and `set_config_option`, the composer's park included, since
//! that runs the whole handshake while the reader is still typing.
//!
//! [`all`] keeps its own probe for the one case nothing else covers: a picker
//! opened with no session anywhere, which is the settings screen on a cold app
//! with no project attached. It is cached, for the reason
//! [`ProbeCache`](crate::harness::ProbeCache) exists, and **it leaves a session
//! behind in mcode's own store**, which the reader will see in their TUI
//! history — the rare path now, where it used to be the launch path.
//!
//! **Effort is per model and only the active model's ladder is ever stated.**
//! One reading therefore fills `efforts` on the row it is running and leaves
//! the others empty, which the picker reads as "no levels" — the safe
//! direction, since a level offered for a model that refuses it is a button
//! whose press does nothing. Switching model restates the ladder, and
//! [`McodeSession::efforts`](super::mcode::McodeSession::efforts) is what makes
//! the composer's own menu follow it.

use anyhow::{Context, Result};
use serde_json::json;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::harness::ProbeCache;
use crate::models::{Effort, Model, ModelId};

use super::parser::{ConfigOptions, ModelRef, NewSessionResult};
use super::rpc::RpcClient;
use crate::proc::HideConsole as _;

/// How long a reading is trusted. Long, because a model list changes when the
/// reader installs something or picks a different provider in the TUI, and the
/// probe costs a session record in their history.
const FRESH_FOR: Duration = Duration::from_secs(600);

/// The one probe in flight at a time, keyed by nothing: mcode's list is global
/// to the machine's configuration, not per project.
static CACHE: LazyLock<ProbeCache<Vec<Model>>> = LazyLock::new(|| ProbeCache::new(FRESH_FOR));

/// Every model the agent offers, from the last reading or a fresh probe.
pub async fn all() -> Vec<Model> {
    if let Some(cached) = CACHE.peek("models") {
        return cached;
    }

    match probe().await {
        Ok(models) if !models.is_empty() => {
            CACHE.insert("models", models.clone());
            models
        }
        // An unreadable probe is not a reason to draw nothing: the reader still
        // has the model their session recorded, and an empty picker beside it
        // would read as the model having gone away.
        Ok(_) | Err(_) => Vec::new(),
    }
}

/// The row an id names, if the last reading has it.
pub async fn find(id: &ModelId) -> Option<Model> {
    if id.is_unset() {
        return None;
    }
    all().await.into_iter().find(|m| &m.id == id)
}

/// Drops the cached answer, so the next read probes again.
pub fn forget() {
    CACHE.forget();
}

/// Takes the list off a session's own `configOptions`.
///
/// **The funnel every session's reply goes through**, and the reason the picker
/// almost never pays for a probe: the agent states this list on `session/new`,
/// on `session/resume`, on `session/fork` and on every `set_config_option`, so a
/// session that is already up has answered the question [`all`] would otherwise
/// open a child to ask. It is the same list on every session — the machine's own
/// provider configuration is what it describes, not the project — so one
/// session's reply stands for all of them.
///
/// A reply that names no model is ignored rather than stored: an empty list
/// would blank a picker that already has a good answer, which is the same
/// direction [`all`] takes when its probe fails.
pub fn remember_configs(configs: &ConfigOptions) {
    let models = from_configs(configs);
    if models.is_empty() {
        return;
    }
    CACHE.insert("models", models);
}

/// The models a session's own `configOptions` state.
///
/// Pure, so a test can hand it a reply and the picker logic is pinned without a
/// child. `efforts` is filled on the active row alone — see the module note.
pub fn from_configs(configs: &ConfigOptions) -> Vec<Model> {
    let Some(option) = configs.option("model") else {
        return Vec::new();
    };

    let active = configs.model();
    let active_efforts = effort_levels(configs).unwrap_or_default();

    option
        .options
        .iter()
        .filter(|choice| !choice.value.is_empty())
        // **The managed account's rows are dropped, and it is not a preference.**
        // The CLI puts its own four models in every option list, signed in or
        // not, and this app never signs in — so drawing one would offer a reader
        // a model whose every turn ends in "Authentication required". See
        // [`ModelRef::is_account_model`].
        .filter(|choice| {
            ModelRef::parse(&choice.value).is_none_or(|r| !r.is_account_model())
        })
        .map(|choice| {
            let running = Some(choice.value.as_str()) == active;
            let reference = ModelRef::parse(&choice.value);
            let provider = reference
                .as_ref()
                .map(|r| r.provider.clone())
                .unwrap_or_default();
            let variant = reference
                .as_ref()
                .map(|r| r.variant.clone())
                .unwrap_or_default();
            // The key two variants of one model share: the reference without
            // its variant, in the decoded spelling `provider` already uses — a
            // BYOK provider's name carries a `:` the wire escapes as `%3A`.
            let base_id = match reference {
                Some(ref r) => format!("m:{}:{}", r.provider, r.model),
                None => String::new(),
            };

            // The agent's own statement of the window, and the only source a
            // model screen has — see `ConfigChoiceMeta`.
            let meta = choice.meta.as_ref();

            let named = if choice.name.is_empty() {
                choice.value.clone()
            } else {
                choice.name.clone()
            };

            Model {
                id: ModelId::new(&choice.value),
                // **The model's own name, with the variant taken off it.** The
                // agent spells a row `minimax-m3 · thinking`, and the suffix is
                // noise in a menu where 37 of 41 rows carry the same one — the
                // variant is a control of its own in the picker, drawn from
                // `variant` beside this.
                label: match named.rsplit_once(" · ") {
                    Some((base, tail)) if tail == variant => base.to_string(),
                    _ => named,
                },
                base_id,
                variant,
                // Stated by the agent, and `None` where it stated nothing —
                // a screen then draws its fallback rather than a fact.
                context_window: meta.and_then(|m| m.context_window),
                max_tokens: meta.and_then(|m| m.max_tokens),
                efforts: if running {
                    active_efforts.clone()
                } else {
                    Vec::new()
                },
                default_effort: None,
                // The value *is* the argument: ACP takes the same
                // `m:<provider>:<model>:v:<variant>` string the option lists.
                arg: choice.value.clone(),
                provider,
                // `accepts_images` is the *agent's* fact, not a model's: mcode
                // answers `image: false` to the prompt capability question, so
                // no row here may be marked as taking one. See
                // [`InitializeResult`](super::parser::InitializeResult).
                accepts_images: false,
                secondary: false,
                // No fast mode on this harness at all — `Capabilities::fast_mode`
                // is `Unsupported` — so no row offers a switch.
                supports_fast: false,
            }
        })
        .collect()
}

/// The active model's thinking-effort ladder, off a session's `configOptions`.
///
/// `None` where the reply carries no `thinkingEffort` option: mcode only builds
/// that option for a model with `effortOptions`, so its absence is the agent
/// saying this model does not reason — which is a different answer from an
/// empty ladder, and the one that must not collapse into it.
pub fn effort_levels(configs: &ConfigOptions) -> Option<Vec<Effort>> {
    let levels = configs.model_levels("thinkingEffort")?;
    Some(
        levels
            .into_iter()
            // A rung this app cannot spell is dropped rather than rounded to
            // its neighbour: mcode's own catalog carries `minimal` on some
            // models, and `Effort` has no variant for it. Dropping it costs the
            // reader the lowest rung and never sends a level the agent will
            // refuse, which is the direction that matters.
            .filter_map(Effort::from_arg)
            .collect(),
    )
}

/// Opens one throwaway ACP session and reads its model options.
///
/// Uses a scratch directory rather than the reader's project: the session is
/// bound to the `cwd` it is opened in, and a probe has no business owning a
/// tree it did not choose. The child is closed either way — a probe that leaks
/// one would keep a session alive for the life of the app.
pub async fn probe() -> Result<Vec<Model>> {
    let bin = crate::binpath::mcode().await;
    let scratch = std::env::temp_dir().join("hz-mcode-probe");
    let _ = std::fs::create_dir_all(&scratch);

    let mut command = tokio::process::Command::new(&bin).hide_console();
    crate::harness::agent_env(&mut command, &bin).await;
    let mut child = command
        .arg("acp")
        .current_dir(&scratch)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("could not start mcode acp")?;

    let stdin = child.stdin.take().context("mcode has no stdin")?;
    let stdout = child.stdout.take().context("mcode has no stdout")?;
    let client = RpcClient::new(stdin);

    // **Something has to read the child.** `accept` is what settles the waiters
    // the requests below register, so without this loop every request sits on
    // its own timeout with the reply already written to a pipe nobody drains —
    // which is exactly what a probe with no reader looked like: 30 seconds, no
    // answer, and a model list that was always empty. The real session has the
    // same task for the same reason; this one ends when the probe does.
    let reader = {
        let client = client.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                client.accept(&line).await;
            }
        })
    };

    let init = client
        .request(
            "initialize",
            json!({
                "protocolVersion": 1,
                "clientCapabilities": {
                    "fs": {"readTextFile": false, "writeTextFile": false},
                    "terminal": false,
                },
                "clientInfo": {"name": "hz", "version": env!("CARGO_PKG_VERSION")},
            }),
        )
        .await
        .context("mcode refused to initialize")?;

    let _ = init;

    let started = client
        .request(
            "session/new",
            json!({"cwd": scratch.to_string_lossy(), "mcpServers": []}),
        )
        .await
        .context("mcode refused to open a session")?;

    // Answer nothing and read nothing else: the reply to `session/new` is the
    // whole of what a probe wants, and the session is closed by closing the
    // child.
    let models = from_configs(&NewSessionResult::of(&started).configs());

    client.close();
    let _ = child.start_kill();
    reader.abort();

    Ok(models)
}

/// **The whole setup path in one assertion.** Resolve the agent this app
/// ships, handshake it over ACP, and read the model list out of the session's
/// own reply — which is what a reader sees the moment the app is working, and
/// what "hz isn't installed" is the absence of.
///
/// Ignored by default: it spawns a child against the machine's real provider
/// configuration and takes a second or two. It is what to run after touching
/// `binpath` or `scripts/vendor-agent.sh`, because it is the only test that
/// exercises resolution and the wire together.
#[tokio::test]
#[ignore = "spawns the shipped agent"]
async fn the_shipped_agent_opens_a_session() {
    let bin = crate::binpath::mcode().await;
    assert!(bin.is_absolute(), "the agent resolved to {bin:?}");

    let models = probe().await.expect("the shipped agent answers");
    assert!(!models.is_empty(), "the agent listed no models: {models:?}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    const LIVE_TURN: &str = include_str!("fixtures/live_turn.jsonl");

    fn configs() -> ConfigOptions {
        let reply: Value = LIVE_TURN
            .lines()
            .filter_map(|line| line.strip_prefix("<< "))
            .map(|line| serde_json::from_str::<Value>(line).expect("fixture line is JSON"))
            .find(|value| value.get("id").and_then(Value::as_u64) == Some(2))
            .and_then(|value| value.get("result").cloned())
            .expect("the capture holds the session/new reply");

        NewSessionResult::of(&reply).configs()
    }

    /// Every row is a model the agent listed, labelled the way the agent labels
    /// it, and the argument is the wire value itself — **and the managed
    /// account's four are not among them.**
    #[test]
    fn the_model_option_becomes_the_pickers_rows() {
        let models = from_configs(&configs());

        // The capture is a real session's list: 41 models, four of which are
        // the agent's own account. Those four are what this drops, so the count
        // is what pins the split — a filter taking the wrong rows lands
        // somewhere else.
        assert_eq!(models.len(), 37);
        assert!(models.iter().all(|m| m.provider != "minimax"));

        let byok = models
            .iter()
            .find(|m| m.id == ModelId::new("m:custom_provider%3Aopencode-go:minimax-m3:v:thinking"))
            .expect("the BYOK provider's models are listed");
        // **The model's own name, not the agent's row label.** mcode spells it
        // `minimax-m3 · thinking`; the suffix comes off, because 37 of the 41
        // rows carry the same one and the variant is a control of its own —
        // `variant` below — wherever a model actually has a choice of them.
        assert_eq!(byok.label, "minimax-m3");
        assert_eq!(byok.variant, "thinking");
        // Two variants of one model share this, which is what the picker groups
        // by; it is the wire id without its `:v:` tail.
        assert_eq!(byok.base_id, "m:custom_provider:opencode-go:minimax-m3");
        // The group the picker draws under is the provider, decoded — a BYOK
        // provider's name carries a `:` that the wire escapes.
        assert_eq!(byok.provider, "custom_provider:opencode-go");
        assert_eq!(byok.arg, "m:custom_provider%3Aopencode-go:minimax-m3:v:thinking");
    }

    /// A model the agent lists in **two variants** is two rows that share a
    /// `base_id` — the shape the picker draws as one row with the variant beside
    /// it. The suffix only comes off the label when it *is* the parsed variant:
    /// a name that happens to hold ` · ` for another reason is left whole.
    #[test]
    fn two_variants_of_one_model_share_a_base() {
        let reply = serde_json::json!({
            "configOptions": [{
                "type": "select",
                "id": "model",
                "currentValue": "m:custom_provider%3Aopencode-go:glm-5.3:v:",
                "options": [
                    {"value": "m:custom_provider%3Aopencode-go:glm-5.3:v:", "name": "glm-5.3"},
                    {"value": "m:custom_provider%3Aopencode-go:glm-5.3:v:thinking", "name": "glm-5.3 · thinking"},
                    // A name holding the separator for its own reasons, where
                    // the tail is *not* the variant.
                    {"value": "m:custom_provider%3Aopencode-go:odd:v:thinking", "name": "odd · named · fast"}
                ]
            }]
        });

        let models = from_configs(&ConfigOptions::of(&reply));

        assert_eq!(models[0].base_id, models[1].base_id);
        assert_eq!(models[0].variant, "");
        assert_eq!(models[1].variant, "thinking");
        assert_eq!(models[0].label, "glm-5.3");
        assert_eq!(models[1].label, "glm-5.3");
        // The tail has to *be* the variant, so this one keeps its whole name —
        // which is the only thing standing between a label and a rewrite of a
        // name this app did not compose.
        assert_eq!(models[2].label, "odd · named · fast");
    }

    /// A list holding nothing but the account's models comes back as **no
    /// models**, which is what the composer draws its "connect a provider" state
    /// off. A row kept here would be a model whose every turn ends in a login
    /// prompt this app has no screen for.
    #[test]
    fn the_accounts_models_alone_are_no_models() {
        let reply = serde_json::json!({
            "configOptions": [{
                "type": "select",
                "id": "model",
                "currentValue": "m:minimax:MiniMax-M3:v:thinking",
                "options": [{"value": "m:minimax:MiniMax-M3:v:thinking", "name": "MiniMax-M3"}]
            }]
        });

        assert!(from_configs(&ConfigOptions::of(&reply)).is_empty());
    }

    /// mcode takes no images at all, so no row may claim it does — an image
    /// tray that offers to attach a screenshot to a model that cannot read one
    /// fails at the send with a sentence the reader cannot act on.
    #[test]
    fn no_row_claims_to_take_an_image() {        assert!(from_configs(&configs()).iter().all(|m| !m.accepts_images));
        assert!(from_configs(&configs()).iter().all(|m| !m.supports_fast));
    }

    /// The ladder stated is the active model's, and no other row may borrow it —
    /// one reading cannot know what a model it is not running takes.
    #[test]
    fn only_the_active_row_carries_a_ladder() {
        // The capture's model is a BYOK one with no `effortOptions`, so mcode
        // sent no `thinkingEffort` option at all.
        assert_eq!(effort_levels(&configs()), None);
        assert!(from_configs(&configs()).iter().all(|m| m.efforts.is_empty()));
    }

    /// A ladder is read off the option when there is one, and a rung this app
    /// cannot spell is dropped rather than rounded to a neighbour.
    #[test]
    fn a_ladder_is_read_and_unspellable_rungs_are_dropped() {
        let reply = serde_json::json!({
            "configOptions": [
                {
                    "type": "select",
                    "id": "model",
                    "currentValue": "m:custom_provider%3Aopencode-go:minimax-m3:v:thinking",
                    "options": [
                        {"value": "m:custom_provider%3Aopencode-go:minimax-m3:v:thinking", "name": "minimax-m3 · thinking"}
                    ]
                },
                {
                    "type": "select",
                    "id": "thinkingEffort",
                    "currentValue": "medium",
                    "options": [
                        {"value": "minimal", "name": "Minimal"},
                        {"value": "low", "name": "Low"},
                        {"value": "medium", "name": "Medium"},
                        {"value": "high", "name": "High"}
                    ]
                }
            ]
        });

        let configs = ConfigOptions::of(&reply);

        // `minimal` is dropped — `Effort` has no variant for it — and `medium`
        // is dropped as the level in use, since that entry may be the
        // *session's* rather than the model's and offering it back would let
        // the picker choose a level the model does not have.
        assert_eq!(effort_levels(&configs), Some(vec![Effort::Low, Effort::High]));

        // The active row carries the same ladder; no other row carries one at
        // all, since one reading cannot know what a model it is not running
        // takes.
        let models = from_configs(&configs);
        assert_eq!(models[0].efforts, vec![Effort::Low, Effort::High]);
    }

    /// What the picker draws after a session has opened is that session's own
    /// reply — not a second reading taken from a child of the picker's own.
    ///
    /// **Deterministic, which is why the list is hand-built rather than the
    /// capture's.** A probe fetches the machine's whole catalog, so a session's
    /// reply holding exactly one row is an answer nothing else can be mistaken
    /// for: without the seed this fails on every machine, by booting a child and
    /// getting either nothing or somebody else's list.
    #[tokio::test]
    async fn a_session_reply_is_what_the_picker_draws_from() {
        // The cache is process-wide, so a neighbour's reading would go on to
        // make the assertion below pass for the wrong reason.
        forget();

        let reply = serde_json::json!({
            "configOptions": [
                {
                    "type": "select",
                    "id": "model",
                    "currentValue": "m:custom_provider%3Aopencode-go:minimax-m3:v:thinking",
                    "options": [
                        {"value": "m:custom_provider%3Aopencode-go:minimax-m3:v:thinking", "name": "minimax-m3 · thinking"}
                    ]
                }
            ]
        });
        remember_configs(&ConfigOptions::of(&reply));

        let listed = all().await;

        assert_eq!(listed.len(), 1);
        assert_eq!(
            listed[0].id,
            ModelId::new("m:custom_provider%3Aopencode-go:minimax-m3:v:thinking")
        );
    }
}
