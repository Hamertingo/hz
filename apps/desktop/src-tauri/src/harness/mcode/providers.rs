//! Where models come from, configured from the app rather than a terminal.
//!
//! A fresh install has an agent and no models at all. So "connect a provider"
//! is the one setup step hz has, and it is one step the app can do itself — the
//! CLI's `provider` subcommand takes every field as a flag, so nothing here
//! needs a TTY.
//!
//! **hz does not use MiniMax's own account, and does not draw it.** The CLI
//! always reports two entries of its own, `minimax_oauth` and `minimax_api`,
//! whether or not anything is signed in to them; [`list`] drops both rather
//! than offering a reader a login this app has no screen for.
//!
//! **The key travels in the environment, never in argv.** `--api-key-env` names
//! a variable and the value is handed to the child's env, because argv is
//! readable by every process on the machine (`ps`) and the env of a process is
//! not. That is the CLI's own interface, chosen deliberately over a shell
//! prompt: it is the only way to hand it a secret without a terminal.
//!
//! Rejected: writing the provider into the CLI's config by hand. That file is
//! the vendor's own, its shape is not this app's to keep, and a subcommand is a
//! contract the vendor publishes where a file layout is an implementation
//! detail. Every provider change goes through the subcommand. **Two keys do
//! not**, and each is a case the subcommand cannot reach:
//!
//! - `defaultModel`, which [`set_default_model`] writes because the flag that
//!   would (`--use`) refuses every time in the shipped version.
//! - a model's `limit`, which [`add`] writes out of what the gateway's own model
//!   list stated, because `--context-limit` is *one number for every model in
//!   the call* and a second `add` for the same provider **replaces** its model
//!   list — measured, not assumed. A per-model window therefore cannot come from
//!   the flag — it is the first of the three steps a model's window is decided
//!   in, and the only one this app can take.
//!
//! Both are **text surgery plus a rename**, never a parse and re-emit: this file
//! is 600 lines of the vendor's own metadata with the reader's key in it, and a
//! round trip would reformat all of it and drop every field this build has never
//! heard of.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::process::Command;

use crate::harness::mcode::models;
use crate::proc::HideConsole as _;

/// One row of `provider list --json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub provider_id: String,
    pub name: String,
    /// `minimax-oauth`, `minimax-api-key` or `custom`.
    #[serde(default)]
    pub kind: String,
    /// The one the agent draws its models from. More than one may be enabled.
    #[serde(default)]
    pub active: bool,
    #[serde(default)]
    pub enabled: bool,
    /// hz may list it and may not edit it — the managed account's own entry.
    #[serde(default)]
    pub read_only: bool,
    /// **A bool, never the key**: the CLI reports whether one is stored, and
    /// the app neither reads nor holds the secret after handing it over.
    #[serde(default)]
    pub has_api_key: bool,
    /// The gateway's URL, as the agent itself reports it. Drawn on the
    /// connected row so a reader can tell two entries apart without opening
    /// anything, and absent on a provider the agent has no URL for.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    /// Which wire it speaks — `openai-completions`, `anthropic-messages` or
    /// `openai-responses`. The same fact the connect row states before the key
    /// is typed, read back off what was actually written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_format: Option<String>,
    /// **Masked by the CLI, and never by this app.** `sk-q****CXTE` is the
    /// agent's own redaction of the key it holds; the secret itself does not
    /// cross back, and this is here for the one thing four characters can
    /// answer — whether the key on this row is the one just pasted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub masked_api_key: Option<String>,
    pub models: Vec<ProviderModel>,
}

impl Provider {
    /// The CLI's own account entries, which hz does not draw.
    fn is_minimax_account(&self) -> bool {
        self.kind == "minimax-oauth" || self.kind == "minimax-api-key"
    }
}

/// One row of a provider's `models` — **an object, not an id.**
///
/// Read as a bare string this parses to nothing on a provider that has any
/// model at all, and takes the whole `provider list` down with it: the list is
/// one JSON value, so one unreadable row is every row the reader loses. The
/// gateway's own list endpoint has the same shape, which is why [`discover`]
/// reads `id` off it the same way.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub model_id: String,
    /// The provider's own label, when it offers one. Usually absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// The default this provider's first model is pinned to, if any.
    #[serde(default)]
    pub selected: bool,
    /// The context window the agent will run this model at, where the provider
    /// entry records one.
    ///
    /// **Absent is the state worth drawing, and it is not zero.** A model's
    /// window is decided in three steps and this is the first: what this entry
    /// records, then what the catalog the agent ships says for that model, then
    /// `BYOK_FALLBACK_MODEL_LIMITS` in `model-resolver-byok.ts` (**200_000**
    /// context, **16_384** output). So a gateway's own statement is written
    /// here, and a gateway that states none is deliberately left absent — an
    /// absent entry lets the catalog answer, where a copy of it taken once
    /// would be believed long after the catalog moved. Only a model neither
    /// names reaches the fallback, and that is the row drawn `200k default`
    /// (`lib/providerLimits.ts` is where this build keeps the copy).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_limit: Option<u64>,
    /// The reply budget this model is pinned to, or absent for the same reason
    /// and with the same fallback (`16k default`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u64>,
}

/// One row of a gateway's own model list, as much of it as this app reads.
///
/// **The window is why this exists.** A gateway's own model list is the one
/// place its ids are described by the party serving them, and some of those
/// lists state a size (`context_length`). A row that carries none is left
/// unwritten rather than guessed at, since the agent's catalog is the next step
/// and this app is not a third source of the same fact.
///
/// Public because [`discover`] is, and that is the whole of the reason: it is a
/// wire shape, not something the frontend ever sees (no `TS` derive, and nothing
/// crosses the bridge with it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredModel {
    id: String,
    context_limit: Option<u64>,
}

/// The CLI's `provider list --json` reply, before the entries hz does not draw
/// are dropped. Not the type the frontend sees.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderList {
    #[serde(default)]
    providers: Vec<Provider>,
}

/// What the composer's add form collects.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct NewProvider {
    pub name: String,
    pub base_url: String,
    /// `anthropic-messages`, `openai-completions` or `openai-responses`.
    pub api_format: String,
    /// One id per row, in the order the reader typed them. **Empty is the
    /// ordinary case**: it means "ask the provider", and [`add`] fills it in
    /// from [`discover`] before the CLI is called.
    pub models: Vec<String>,
    pub api_key: String,
    /// Test the first model, then save and select it as the default.
    pub make_default: bool,
}


/// A gateway the agent already knows how to talk to, ready to be filled in with
/// a key.
///
/// **The CLI's own wiring, not a guess.** OpenCode Go is special-cased inside
/// this agent: `packages/shared/opencode-go-headers.ts` recognises
/// `https://opencode.ai/zen/go`, stamps an `x-opencode-session` header on every
/// request and routes inference **by conversation** — which is why pointing a
/// provider at that URL is all "native support" means, and why the URL and the
/// dialect below are the ones that answer. Read off a working install rather
/// than from documentation.
///
/// A preset only saves typing: what lands on disk is a `custom_provider` like
/// any other, and the manual form can still write every one of its fields. This
/// shape is what the reader sees when they pick a preset, and it is deliberately
/// two lines of text and a key — everything else is a fact the app holds, and
/// fields nobody is meant to touch invite touching.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ProviderPreset {
    /// A stable slug for the gateway, and the only thing the view keys its
    /// mark off. Not the name, because the name is copy and copy moves.
    pub id: String,
    /// What the reader sees, and what the CLI `name`s the provider.
    pub name: String,
    pub base_url: String,
    /// `openai-completions` here, which is the dialect this gateway speaks —
    /// the CLI's own default for `provider add` is `anthropic-messages`, so
    /// this is the field a reader would most often get wrong by hand.
    pub api_format: String,
    /// Left empty on purpose, and empty is not "no models": [`add`] asks the
    /// provider's own list endpoint and registers everything it serves. Naming
    /// two ids would offer a reader a fraction of what they paid for.
    pub models: Vec<String>,
    /// One line about what the reader is signing up for, drawn under the name.
    pub note: String,
}

/// The gateways this build offers, in the order the view draws them.
///
/// **One row each, and `--api-format` is why.** A gateway serves one wire per
/// provider, and a model sent to the wrong one is a `400` — so a gateway that
/// answers on more than one would need a provider per wire, which is two rows
/// for one key. Command Code is that gateway: Claude answers on `/v1/messages`
/// alone and everything else on `/v1/chat/completions`. This build registers it
/// on the OpenAI wire, the one that serves the most models, so its Claude models
/// are simply not among the ids [`read_models`] lets through.
pub fn presets() -> Vec<ProviderPreset> {
    vec![
        ProviderPreset {
            id: "command-code".to_string(),
            name: "Command Code".to_string(),
            base_url: "https://api.commandcode.ai/provider/v1".to_string(),
            api_format: "openai-completions".to_string(),
            models: Vec::new(),
            note: "One key for GPT, Gemini and the open models. Hyze Code fetches the list it serves.".to_string(),
        },
        ProviderPreset {
            id: "opencode-go".to_string(),
            name: "OpenCode Go".to_string(),
            base_url: "https://opencode.ai/zen/go/v1".to_string(),
            api_format: "openai-completions".to_string(),
            models: Vec::new(),
            note: "Every model the gateway serves — Hyze Code asks it for the list.".to_string(),
        },
    ]
}

/// Every provider hz manages, newest state — **the ones it added, and no
/// others.**
///
/// The CLI's reply always leads with its own two entries, `minimax_oauth` and
/// `minimax_api`, signed in or not. They are dropped here rather than in the
/// view because there is nothing behind them in this app: no login screen, no
/// MiniMax key field, no way to point a session at them. A row a reader can
/// neither use nor remove is worse than no row.
///
/// Dropped by `kind` rather than by `readOnly`: one of the two is editable as
/// far as the CLI is concerned, and it still is nothing this app offers.
pub async fn list() -> Result<Vec<Provider>> {
    let out = run(&["provider", "list", "--json"], None).await?;
    let reply: ProviderList = serde_json::from_str(&out)
        .context("mcode's provider list is not the shape this build reads")?;

    Ok(reply
        .providers
        .into_iter()
        .filter(|provider| !provider.is_minimax_account())
        .collect())
}

/// Adds a custom provider, and — where the reader asked — makes it the one the
/// agent draws models from.
///
/// **An empty model list means "ask the provider", not "no models".** The
/// subcommand refuses an add with no `--model` at all, so a gateway's catalog
/// has to arrive one of two ways: typed by the reader, or fetched here. This
/// fetches, because a gateway like OpenCode Go serves dozens of models and
/// naming two of them would hand the reader a fraction of their subscription.
///
/// The name is *not* an id: the CLI mints `custom_provider:<slug>` from it, and
/// that id is what [`remove`], [`test`] and every later call needs. So this
/// re-lists afterwards and hands back what the CLI actually called it, rather
/// than making the app guess a slug rule the vendor owns.
pub async fn add(provider: &NewProvider) -> Result<Vec<Provider>> {
    if provider.name.trim().is_empty() {
        bail!("a provider needs a name");
    }
    if provider.base_url.trim().is_empty() {
        bail!("a provider needs a base URL");
    }
    if provider.api_key.trim().is_empty() {
        bail!("a provider needs an API key");
    }

    // Typed ids have no window — the reader typed them, so nothing stated one.
    let discovered = if provider.models.iter().all(|model| model.trim().is_empty()) {
        discover(&provider.base_url, &provider.api_format, provider.api_key.trim()).await?
    } else {
        provider
            .models
            .iter()
            .map(|id| DiscoveredModel {
                id: id.trim().to_string(),
                context_limit: None,
            })
            .filter(|model| !model.id.is_empty())
            .collect()
    };

    let mut args: Vec<String> = vec![
        "provider".into(),
        "add".into(),
        "--name".into(),
        provider.name.trim().into(),
        "--base-url".into(),
        provider.base_url.trim().into(),
        "--api-format".into(),
        provider.api_format.clone(),
    ];

    // **No `--context-limit`.** It is one number for every model in the call, and
    // a gateway serves models of several sizes — so the windows go in per model
    // afterwards, out of what the gateway itself stated.
    for model in &discovered {
        args.push("--model".into());
        args.push(model.id.clone());
    }

    // The name the CLI reads the key out of *its* environment, which this
    // process sets to the reader's key for this one child.
    args.push("--api-key-env".into());
    args.push(KEY_VAR.into());

    // **No `--use`.** It is the flag that would activate the provider, and it is
    // the flag that cannot: see [`set_default_model`], which does that half
    // itself. Passing it here would turn every connect into the failure it is
    // known to produce.

    let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
    run(&borrowed, Some(provider.api_key.trim())).await?;

    // The list is the agent's, and a provider just changed it.
    models::forget();
    let after = list().await?;

    // **Every window the gateway stated, written per model.** See
    // [`apply_windows`]: best effort, because the provider is connected and
    // usable whatever this does — and the model rows draw the window each one
    // ended up on, so a write that did not land is visible rather than silent.
    if let Some(added) = after.iter().find(|listed| listed.name == provider.name.trim()) {
        if let Err(err) = apply_windows(&added.provider_id, &discovered).await {
            eprintln!("[hz] could not record the model windows: {err:#}");
        }
    }
    let after = list().await?;

    if provider.make_default {
        set_default_model(&after, provider.name.trim()).await?;
    }

    Ok(after)
}

/// Records the context window each model was discovered with, in the agent's own
/// config.
///
/// **This is the whole of "it is right because the gateway said so".** A BYOK
/// model with no limit of its own is answered by the agent's catalog, and by its
/// own 200k fallback only where the catalog has no entry either — so what a
/// gateway states here is the one step ahead of both. Some gateways state the
/// size in their own model list (Command Code serves `context_length`), and this
/// is what turns that statement into the
/// number the agent runs on. A gateway that states nothing keeps the fallback,
/// and the row shows it: the two presets hz ships differ exactly here, which is
/// why this is one code path and not a special case per gateway.
///
/// Only the models that stated one are written, and only if at least one was:
/// nothing to write is not a reason to touch a file that holds the reader's key.
/// The write is the text surgery + rename [`with_model_limits`] describes, and a
/// refusal puts the file back rather than leaving it half-edited.
async fn apply_windows(provider_id: &str, models: &[DiscoveredModel]) -> Result<()> {
    let wanted: Vec<(&str, u64)> = models
        .iter()
        .filter_map(|model| model.context_limit.map(|tokens| (model.id.as_str(), tokens)))
        .collect();
    if wanted.is_empty() {
        return Ok(());
    }

    let path = config_path().await?;
    let text = tokio::fs::read_to_string(&path)
        .await
        .with_context(|| format!("couldn't read {}", path.display()))?;

    let mut edited = text.clone();
    let mut written = 0usize;
    for (model_id, tokens) in &wanted {
        if let Some(next) = with_model_limits(&edited, provider_id, model_id, Some(*tokens), None) {
            edited = next;
            written += 1;
        }
    }
    if written == 0 {
        bail!("none of the {provider_id}'s models are in the agent's config");
    }

    let tmp = path.with_extension("yaml.tmp");
    tokio::fs::write(&tmp, &edited)
        .await
        .with_context(|| format!("couldn't write {}", tmp.display()))?;
    if let Err(err) = tokio::fs::rename(&tmp, &path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(err).with_context(|| format!("couldn't land {}", path.display()));
    }

    // The agent is the only thing that can say whether that was a config. One
    // reading, then one comparison per model — a window that did not take means
    // the file is not the shape this writes, and a half-believed config is worse
    // than the 200k it started on.
    models::forget();
    if let Ok(after) = list().await {
        let recorded = |model_id: &str| {
            after
                .iter()
                .find(|listed| listed.provider_id == provider_id)
                .and_then(|listed| {
                    listed
                        .models
                        .iter()
                        .find(|model| model.model_id == model_id)
                })
                .and_then(|model| model.context_limit)
        };
        if wanted.iter().all(|(id, tokens)| recorded(id) == Some(*tokens)) {
            return Ok(());
        }
    }

    let _ = tokio::fs::write(&path, &text).await;
    models::forget();
    bail!("the agent did not take those windows, so the config was put back")
}

/// Points the agent at a model the provider that was just added serves.
///
/// **The CLI has no surface for this, and that is measured rather than
/// assumed.** `provider add --use` is the one that exists, and in 0.4.12 it
/// refuses every time — "Test the saved provider configuration before
/// activating it" — on the very same provider and model that `provider test`
/// answers "Provider available" for. The check it fails on is its own: it reads
/// `result.success` off a reply that carries `ok`.
///
/// And the key is not optional. A fresh data directory is bootstrapped with
/// `defaultModel: minimax/MiniMax-M3`, an account this app never signs in to, so
/// until something replaces that line `session/new` refuses outright with
/// "Authentication required: Run `mcode login`" — no session, no model list, no
/// first prompt. An install that cannot write this key cannot start.
///
/// Two things make writing it directly safe, and neither is an accident:
///
/// - **The file is hz's own.** `MINIMAX_DATA_DIR` is pinned to `~/.hz/agent`
///   ([`agent_env`](crate::harness::agent_env)) and nothing else writes there,
///   so the usual objection to editing a vendor's config — two writers, one
///   file — does not apply. That is what the private directory bought.
/// - **One line is replaced in place, never round-tripped.** That file is five
///   hundred lines of model metadata the agent maintains; reading it into a
///   parser and writing it back would hand the agent back its own data
///   reformatted, and every field this app has never heard of is a field it
///   would silently drop.
///
/// The landing is write-temp + `rename`, the same as the app's own stores, so a
/// reader never sees a half-written config.
async fn set_default_model(listed: &[Provider], name: &str) -> Result<()> {
    let provider = listed
        .iter()
        .find(|provider| provider.name == name)
        .with_context(|| format!("{name} was added but the agent does not list it back"))?;
    let model = provider
        .models
        .first()
        .context("the provider was added with no models to run")?;

    // The shape the agent's own bootstrap writes, and the shape a session's
    // `configOptions` reads back as `m:<provider>:<model>:v:<variant>`.
    let value = format!("{}/{}", provider.provider_id, model.model_id);

    let path = config_path().await?;
    let text = tokio::fs::read_to_string(&path)
        .await
        .with_context(|| format!("couldn't read {}", path.display()))?;
    let written = with_default_model(&text, &value);

    let tmp = path.with_extension("yaml.tmp");
    tokio::fs::write(&tmp, &written)
        .await
        .with_context(|| format!("couldn't write {}", tmp.display()))?;
    if let Err(err) = tokio::fs::rename(&tmp, &path).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(err).with_context(|| format!("couldn't land {}", path.display()));
    }

    Ok(())
}

/// The model this machine runs by default, as the agent's own config states it.
///
/// **The one model a definition may safely name.** It is the source-qualified key
/// the runtime would fall back to anyway, so an Agent written with it behaves like
/// an Agent with no model — except that it is *stated*, which is what the store's
/// model gate needs. An Agent that inherits the runtime default is resolved
/// through that default's context window, and where the catalog carries no
/// physical limit for it — every BYOK provider's — the store refuses the write
/// outright: "contextWindow from runtime-default requires a catalog physical
/// limit".
///
/// `None` for a config with no top-level line, which is a fresh install with no
/// provider connected yet.
pub async fn default_model() -> Result<Option<String>> {
    let path = config_path().await?;
    let text = tokio::fs::read_to_string(&path)
        .await
        .with_context(|| format!("couldn't read {}", path.display()))?;
    Ok(read_default_model(&text))
}

/// The top-level `defaultModel` line's value, or `None`.
///
/// **Top level only.** A connected provider carries its own indented
/// `defaultModel:`, and that one is a provider's own setting rather than the
/// machine's choice — reading it would name a model the runtime never falls back
/// to. Same rule [`with_default_model`] writes by.
fn read_default_model(text: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.strip_prefix("defaultModel:"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// The agent's config, inside hz's own data directory for it.
async fn config_path() -> Result<std::path::PathBuf> {
    let dir = crate::store::get_home_app_dir().await?.join("agent");
    let path = dir.join("config.yaml");
    if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
        bail!("the agent has no config at {}", path.display());
    }
    Ok(path)
}

/// Sets one model's `limit` in the agent's config, or clears it.
///
/// **The per-model context window, and it is the only lever there is.** A BYOK
/// model with no `limit.context` of its own is answered by the catalog the agent
/// ships, and only a model that is absent from that too is drawn — and
/// compacted — at the agent's 200k fallback. `provider add --context-limit`
/// sets one number for every model in that call, re-adding the same provider
/// **replaces** its model list, and no ACP config option carries a window — so
/// the config file is the only place a per-model window can be written. That is
/// where the agent's own picker writes it too.
///
/// **Text surgery, not a round trip**, for the reason [`with_default_model`]
/// gives and one worse: this file is 600 lines of the vendor's own model
/// metadata with the reader's API key in it, and a parse-and-re-emit would
/// reformat all of it — and drop any key this build has never heard of.
///
/// Indentation is the whole of the parsing, and it is the vendor's own shape:
/// `provider:` at 0, the slug at 2, `models:` at 4, the model id at 6, its
/// fields at 8, the limit's own fields at 10. `None` where the provider or the
/// model is not in the file — a model the CLI lists but the config never wrote
/// is not something to guess an insertion point for.
///
/// Pure, so the rule is pinned against that shape without a `~/.hz` to write
/// into.
fn with_model_limits(
    text: &str,
    provider_id: &str,
    model_id: &str,
    context: Option<u64>,
    output: Option<u64>,
) -> Option<String> {
    // **`provider list` names the block by its own path.** A BYOK provider is
    // `custom_provider:<slug>`, and the config says exactly that: a top-level
    // `custom_provider:` map with the slug under it. The managed account is
    // `minimax`, under the top-level `provider:` map — so the id is a path and
    // nothing here has to guess which map a provider lives in.
    let (parent, slug) = provider_id.split_once(':')?;
    const SLUG: usize = 2;
    const MODELS: usize = 4;
    const MODEL: usize = 6;
    const FIELD: usize = 8;
    const LIMIT: usize = 10;

    fn indent(line: &str) -> usize {
        line.len() - line.trim_start().len()
    }
    // Whether this line is the map key `want`, with any quoting taken off it.
    //
    // **Two spellings, and the second is not belt-and-braces.** A key whose own
    // text holds a colon — a model id like `vendor/model:free` — is written bare
    // by the agent, and splitting on the *first* colon reads `vendor/model` out
    // of it, which matches nothing. So a line ending in `:` is compared whole,
    // and only a line carrying a value falls back to the first colon — which is
    // what reads `context: 1000000` and `baseURL: https://…` as their keys.
    fn is_key(line: &str, want: &str) -> bool {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_suffix(':') {
            if rest.trim().trim_matches(['"', '\'']) == want {
                return true;
            }
        }
        match trimmed.split_once(':') {
            Some((before, _)) => before.trim().trim_matches(['"', '\'']) == want,
            None => false,
        }
    }

    let lines: Vec<&str> = text.lines().collect();
    let provider_at = lines
        .iter()
        .position(|line| line.trim() == format!("{parent}:"))?;
    let body = &lines[provider_at + 1..];
    // A top-level line ends the map, so a slug below one belongs to a later
    // document rather than to `provider:`.
    let end = body
        .iter()
        .position(|line| {
            indent(line) == 0 && !line.trim().is_empty() && !line.trim().starts_with('#')
        })
        .unwrap_or(body.len());

    let slug_at = (0..end).find(|i| indent(body[*i]) == SLUG && is_key(body[*i], slug))?;
    let models_at = (slug_at + 1..end)
        .find(|i| indent(body[*i]) <= SLUG || (indent(body[*i]) == MODELS && is_key(body[*i], "models")))?;
    if indent(body[models_at]) != MODELS {
        return None;
    }
    let model_at = (models_at + 1..end)
        .find(|i| indent(body[*i]) <= MODELS || (indent(body[*i]) == MODEL && is_key(body[*i], model_id)))?;
    if indent(body[model_at]) != MODEL {
        return None;
    }
    // Where this model's own fields stop: the next line at or above its own
    // indent, which is the next model or the end of the map.
    let fields_end = (model_at + 1..end)
        .find(|i| indent(body[*i]) <= MODEL && !body[*i].trim().is_empty())
        .unwrap_or(end);

    let find_field = |from: usize, to: usize, level: usize, want: &str| {
        (from..to).find(|i| indent(body[*i]) == level && is_key(body[*i], want))
    };

    let limit_at = find_field(model_at + 1, fields_end, FIELD, "limit");
    let limit_end = limit_at
        .map(|at| {
            (at + 1..fields_end)
                .find(|i| indent(body[*i]) <= FIELD && !body[*i].trim().is_empty())
                .unwrap_or(fields_end)
        })
        .unwrap_or(model_at + 1);

    // The limit's children with ours taken out and every key this build does
    // not manage carried through untouched — the entry may hold limits of its
    // own that are none of this app's business.
    let kept: Vec<String> = limit_at
        .map(|at| {
            body[at + 1..limit_end]
                .iter()
                .filter(|line| {
                    !(indent(line) == LIMIT
                        && (is_key(line, "context") || is_key(line, "output")))
                })
                .map(|line| (*line).to_string())
                .collect()
        })
        .unwrap_or_default();

    let mut written: Vec<String> = Vec::new();
    for (want, tokens) in [("context", context), ("output", output)] {
        if let Some(tokens) = tokens {
            written.push(format!("{}{want}: {tokens}", " ".repeat(LIMIT)));
        }
    }

    // Nothing asked for and nothing there: the file is left exactly as it was,
    // which is the honest answer for a model this build has nothing to say
    // about.
    if written.is_empty() && limit_at.is_none() {
        return None;
    }

    // An emptied limit goes entirely, rather than standing over its children.
    let block: Vec<String> = if written.is_empty() && kept.is_empty() {
        Vec::new()
    } else {
        let mut block = vec![format!("{}limit:", " ".repeat(FIELD))];
        block.extend(written);
        block.extend(kept);
        block
    };

    // Where the block goes: over the one it replaces, or before the model's own
    // fields where it never had one. Placing it *there* rather than at the top
    // of the entry keeps an existing block where the reader put it — including
    // ahead of a `contextWindowOptions` list, which the agent's own picker reads.
    let at = limit_at.unwrap_or(model_at + 1);

    // Everything above `provider:` untouched, everything from there out of
    // `body` in order with the old block swapped for the new one.
    let mut out: Vec<String> = Vec::with_capacity(lines.len() + block.len());
    out.extend(lines[..provider_at + 1].iter().map(|line| (*line).to_string()));
    out.extend(body[..at].iter().map(|line| (*line).to_string()));
    out.extend(block);
    out.extend(body[limit_end..].iter().map(|line| (*line).to_string()));

    Some(out.join("\n") + "\n")
}

/// The config with its one top-level `defaultModel` line replaced, or appended
/// where the agent never wrote one.
///
/// Split out from the write so the rule is pinned without a `~/.hz` to write
/// into. Only a line that **starts** with the key counts: the same file carries
/// `defaultModelContextWindow` and `defaultModelVariant` beneath it, and a
/// nested key of the same name would be an agent's to keep, not this app's.
fn with_default_model(text: &str, value: &str) -> String {
    let mut replaced = false;
    let mut out = String::with_capacity(text.len() + value.len() + 16);

    for line in text.lines() {
        if !replaced && line.starts_with("defaultModel:") {
            out.push_str("defaultModel: ");
            out.push_str(value);
            replaced = true;
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }

    if !replaced {
        out.push_str("defaultModel: ");
        out.push_str(value);
        out.push('\n');
    }

    out
}

/// The model ids a provider serves, read off its own list endpoint.
///
/// **hz asks because the subcommand will not.** `provider add` has no discovery
/// of its own — it refuses an empty list with "At least one --model <id> is
/// required" — so without this a reader connecting a gateway is left typing out
/// a catalog cURLed out of the vendor's documentation. Every gateway worth a
/// preset publishes `/models`; that is the whole lookup.
///
/// A failure that is not "this gateway has no list endpoint" stops immediately,
/// since a wrong key and a wrong URL are what the reader needs to be told, and
/// walking a fallback chain past an authentication error reports the last URL
/// tried rather than the real reason.
pub async fn discover(base_url: &str, api_format: &str, api_key: &str) -> Result<Vec<DiscoveredModel>> {
    let mut problem = "the provider serves no models".to_string();

    for url in model_list_urls(base_url, api_format) {
        match ask_for_models(&url, base_url, api_key, api_format).await {
            Answer::Models(ids) if !ids.is_empty() => return Ok(ids),
            Answer::Models(_) => problem = format!("{url} answered with an empty list"),
            Answer::NoEndpoint(why) => problem = format!("{url}: {why}"),
            Answer::Failed(why) => bail!("{url}: {why}"),
        }
    }

    bail!("{problem} — add the model ids by hand")
}

/// Where a provider's model list lives, in the order worth trying.
///
/// One URL for a chat-completions gateway. A Messages-compatible one often
/// implements only `/v1/messages`, so its list is at `/v1/models` when it has
/// one and at the origin's `/models` when it does not — the same escalation the
/// agent itself makes, so a gateway that works there works here. Read off
/// `providerModelsUrls`.
fn model_list_urls(base_url: &str, api_format: &str) -> Vec<String> {
    // A base URL is what the reader pasted, and gateways are configured with
    // every one of these suffixes. The list endpoint hangs off the prefix.
    let trimmed = base_url.trim().trim_end_matches('/');
    let base = ["/chat/completions", "/responses", "/v1/messages", "/messages"]
        .iter()
        .find_map(|suffix| trimmed.strip_suffix(suffix))
        .unwrap_or(trimmed);

    if api_format != "anthropic-messages" {
        return vec![format!("{base}/models")];
    }

    let base = base.strip_suffix("/v1").unwrap_or(base);
    let mut urls = vec![format!("{base}/v1/models"), format!("{base}/models")];
    if let Some(host) = origin(base) {
        urls.push(format!("{host}/models"));
    }
    urls.dedup();
    urls
}

/// Scheme and authority of a base URL, for the origin-level fallback.
fn origin(base: &str) -> Option<String> {
    let url = reqwest::Url::parse(base).ok()?;
    Some(format!("{}://{}", url.scheme(), url.host_str()?))
}

/// What one attempt at a list endpoint came back with.
///
/// "This gateway has no list endpoint" is told apart from every other failure
/// because only it is worth trying the next URL over: a 401 is the answer, and
/// trying three more URLs after it buries it.
enum Answer {
    Models(Vec<DiscoveredModel>),
    /// 404 or 405 — no list endpoint at this URL.
    NoEndpoint(String),
    Failed(String),
}

/// Asks one URL for its model list.
async fn ask_for_models(url: &str, base_url: &str, api_key: &str, api_format: &str) -> Answer {
    let mut request = client()
        .get(url)
        .header("authorization", format!("Bearer {api_key}"))
        .header("x-api-key", api_key);

    // OpenCode Go stamps an identity on every request and routes inference by
    // conversation. A lookup has no conversation, so this is its own — but the
    // header has to be there, because that is the request the agent makes.
    if is_opencode_go(base_url) {
        request = request
            .header("x-opencode-session", uuid::Uuid::new_v4().to_string())
            .header("user-agent", "MiniMaxCode");
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(err) => return Answer::Failed(err.to_string()),
    };

    let status = response.status().as_u16();
    match status {
        404 | 405 => return Answer::NoEndpoint(format!("no model list (HTTP {status})")),
        401 | 403 => return Answer::Failed(format!("authentication failed (HTTP {status})")),
        _ if !response.status().is_success() => return Answer::Failed(format!("HTTP {status}")),
        _ => {}
    }

    match response.json::<serde_json::Value>().await {
        Ok(payload) => Answer::Models(read_models(&payload, api_format)),
        Err(err) => Answer::Failed(format!("the reply is not the JSON this reads: {err}")),
    }
}

/// `{"data": [{"id": "…"}]}` — the OpenAI list shape every gateway here answers
/// with, which is the shape the agent's own discovery reads too.
///
/// **A model the declared wire cannot reach is not registered.** A gateway that
/// serves some models over Messages and the rest over Chat Completions — Command
/// Code's does — answers one list for both, and every id on it would go into
/// `provider add --model` under whichever `--api-format` the reader picked. The
/// ones on the other wire are not refused at the add: they are refused at the
/// end of the first turn that picks one, which is exactly the failure this app
/// refuses to ship (see the MiniMax account's own models, dropped for the same
/// reason). So the list is narrowed to the wire being configured.
fn read_models(payload: &serde_json::Value, api_format: &str) -> Vec<DiscoveredModel> {
    payload
        .get("data")
        .and_then(|data| data.as_array())
        .map(|rows| {
            rows.iter()
                .filter(|row| serves_wire(row, api_format))
                .filter_map(|row| {
                    let id = row.get("id")?.as_str()?.trim();
                    if id.is_empty() {
                        return None;
                    }
                    Some(DiscoveredModel {
                        id: id.to_string(),
                        context_limit: read_context_window(row),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The context window a gateway states for one of its models, or `None`.
///
/// **Every name here is one a real endpoint was seen to use**, and that is the
/// whole of the rule: a field this build has not seen is not guessed at, because
/// the number ends up governing when the agent compacts. Command Code serves
/// `context_length` (a million on its Claude rows); the vLLM-family gateways
/// serve `max_model_len`; OpenRouter nests a `context_length` under
/// `top_provider`; some serve `context_window`.
///
/// **OpenCode Go and Zen serve none of them** — their list carries `id` and
/// nothing else — so those models keep the agent's own fallback, which is what
/// the bundled catalog is for. See the module note on the two halves.
fn read_context_window(row: &serde_json::Value) -> Option<u64> {
    const FIELDS: [&str; 3] = ["context_length", "max_model_len", "context_window"];
    let direct = FIELDS.iter().find_map(|field| {
        row.get(*field).and_then(serde_json::Value::as_u64).filter(|tokens| *tokens > 0)
    });
    direct.or_else(|| {
        row.get("top_provider")
            .and_then(|top| top.get("context_length"))
            .and_then(serde_json::Value::as_u64)
            .filter(|tokens| *tokens > 0)
    })
}

/// Whether a row says it answers on this wire.
///
/// **A list without the field keeps every model.** `supported_endpoints` is
/// Command Code's own addition, and it is the only list seen here that carries
/// it — so absent means "this gateway does not say", not "this model has none",
/// and the safe reading of a silence is the one that registers nothing less than
/// the gateway serves.
fn serves_wire(row: &serde_json::Value, api_format: &str) -> bool {
    let Some(endpoints) = row.get("supported_endpoints").and_then(|value| value.as_array()) else {
        return true;
    };

    let wanted = match api_format {
        "anthropic-messages" => "/messages",
        "openai-responses" => "/responses",
        _ => "/chat/completions",
    };

    endpoints
        .iter()
        .any(|endpoint| endpoint.as_str() == Some(wanted))
}

/// Whether a base URL is OpenCode Go's own gateway — the vendor's own test,
/// because it is the vendor's routing that depends on the header.
fn is_opencode_go(base_url: &str) -> bool {
    reqwest::Url::parse(base_url.trim()).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == Some("opencode.ai")
            && (url.path() == "/zen/go" || url.path().starts_with("/zen/go/"))
    })
}

/// **Bounded, because this runs on a click.** A gateway that accepts the
/// connection and never answers would otherwise hold the form's spinner for as
/// long as the OS keeps the socket, which reads as the button being broken.
/// The agent holds its own discovery to the same ten seconds.
/// The HTTP client discovery goes through.
///
/// **Named, and the identity is not a nicety.** Command Code's model list answers
/// **403** to a request with no `User-Agent` — measured on the shipped host: no
/// header 403, `curl/8.7.1` and `MiniMaxCode` both 200. A client that sends
/// none, as this one did, could not discover anything there, and the refusal
/// arrived as "authentication failed (HTTP 403)" — a sentence about the reader's
/// key, which was fine. The same identity `analytics` and `linear` already send;
/// the OpenCode header below overrides it per gateway where that identity is part
/// of the request.
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("hz/", env!("CARGO_PKG_VERSION")))
        .build()
        .unwrap_or_default()
});

fn client() -> &'static reqwest::Client {
    &CLIENT
}

/// Removes a provider hz added.
pub async fn remove(provider_id: &str) -> Result<Vec<Provider>> {
    run(&["provider", "remove", provider_id, "--yes"], None).await?;
    models::forget();
    list().await
}

/// Tests a provider — or one model under it — and hands back the CLI's own
/// sentence about what happened.
///
/// **The output, not just the status**: a test that failed for a reason the
/// reader can act on (a wrong base URL, a key without credit) is the whole
/// point of offering one, and `false` with no words would be a button that
/// says nothing.
pub async fn test(provider_id: &str, model: Option<&str>) -> Result<String> {
    let mut args: Vec<&str> = vec!["provider", "test", provider_id];
    if let Some(model) = model {
        args.push("--model");
        args.push(model);
    }

    let bin = crate::binpath::mcode().await;
    let mut command = Command::new(&bin).hide_console();
    command.args(&args);
    crate::harness::agent_env(&mut command, &bin).await;
    let output = command
        .output()
        .await
        .with_context(|| format!("couldn't run {}", bin.display()))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        return Ok(if stdout.is_empty() { "ok".into() } else { stdout });
    }

    // The CLI's own words are the useful half, and a failure usually writes
    // them to stderr — but not always, so both are carried rather than one
    // being assumed.
    let detail = if stderr.is_empty() { stdout } else { stderr };
    bail!("{detail}")
}

/// The variable the key is handed over in. A constant rather than the reader's
/// chosen name: nothing outside this one child ever reads it.
const KEY_VAR: &str = "HZ_PROVIDER_API_KEY";

/// Runs the bundled CLI and hands back its stdout, or its own sentence about
/// why it refused.
///
/// **Nothing here inherits stdin.** Every one of these subcommands can prompt
/// when an argument is missing, and with a null stdin a prompt is an immediate
/// EOF rather than a hang — so a bug in the arguments above costs an error
/// instead of a child that never returns.
async fn run(args: &[&str], api_key: Option<&str>) -> Result<String> {
    let bin = crate::binpath::mcode().await;
    let mut command = Command::new(&bin).hide_console();
    command.args(args);
    crate::harness::agent_env(&mut command, &bin).await;
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(key) = api_key {
        command.env(KEY_VAR, key);
    }

    let output = command
        .output()
        .await
        .with_context(|| format!("couldn't run {}", bin.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        bail!("{detail}")
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ids a list reply yields, which is what most of these assert on: the
    /// window beside them has its own test.
    fn ids(payload: &serde_json::Value, api_format: &str) -> Vec<String> {
        read_models(payload, api_format)
            .into_iter()
            .map(|model| model.id)
            .collect()
    }

    /// A slice of the agent's real config, indentation and all: a provider map
    /// whose models are `name:`/`kind:` and then an indented `models:` map, one
    /// of which already carries a hand-written `limit:` (as the machine this was
    /// written on does) and one of which does not.
    const CONFIG: &str = r#"version: 1
defaultModel: custom_provider:example/alpha
provider:
  minimax:
    name: MiniMax
    models:
      beta:
        reasoning: true
custom_provider:
  example:
    name: Example
    kind: custom
    enabled: true
    options:
      baseURL: https://example.test/v1
    models:
      alpha:
        reasoning: true
        thinking_config:
          mode: switchable
          default_value: 'true'
        limit:
          context: 1000000
          output: 128000
        contextWindowOptions:
          - 256000
          - 1000000
      beta:
        reasoning: true
      gamma:
        reasoning: false
  other:
    name: Other
    kind: custom
    models:
      beta:
        reasoning: true
permissionMode: auto
"#;

    fn lines_of(text: &str) -> Vec<&str> {
        text.lines().collect()
    }

    /// Sets a window where the model has none, and leaves every other line of
    /// the file exactly where it was.
    #[test]
    fn a_window_is_written_before_the_models_own_fields() {
        let out = with_model_limits(CONFIG, "custom_provider:example", "beta", Some(262_144), Some(32_768)).unwrap();

        assert!(
            out.contains("      beta:\n        limit:\n          context: 262144\n          output: 32768\n        reasoning: true\n"),
            "wrote {out}"
        );
        // Every other line survives, in order — the whole point of doing this as
        // text rather than a round trip.
        let before: Vec<&str> = lines_of(CONFIG)
            .into_iter()
            .filter(|line| !line.contains("limit:") && !line.contains("context:") && !line.contains("output:") && !line.contains("contextWindowOptions") && !line.contains("- 256000") && !line.contains("- 1000000"))
            .collect();
        let after: Vec<&str> = lines_of(&out)
            .into_iter()
            .filter(|line| !line.contains("limit:") && !line.contains("context:") && !line.contains("output:") && !line.contains("contextWindowOptions") && !line.contains("- 256000") && !line.contains("- 1000000"))
            .collect();
        assert_eq!(before, after);
    }

    /// An existing window is replaced in place, and the keys beside it that this
    /// build knows nothing about are carried through.
    #[test]
    fn an_existing_window_is_replaced_where_it_stands() {
        let out = with_model_limits(CONFIG, "custom_provider:example", "alpha", Some(400_000), None).unwrap();

        // Where the reader put it: after `thinking_config:` and before the
        // `contextWindowOptions` list, not at the top of the entry.
        assert!(
            out.contains(
                "          default_value: 'true'\n        limit:\n          context: 400000\n        contextWindowOptions:\n          - 256000\n"
            ),
            "wrote {out}"
        );
        // The old output line went with the limit it belonged to, so a cleared
        // budget falls back rather than keeping the stale number.
        assert!(!out.contains("output: 128000"));
        // And no second limit block for the same model.
        assert_eq!(out.matches("limit:").count(), 1);
    }

    /// A model id is matched inside its own provider, so two providers may list
    /// the same one without the write landing on the wrong entry.
    #[test]
    fn a_model_is_matched_inside_its_own_provider() {
        let out = with_model_limits(CONFIG, "custom_provider:other", "beta", Some(64_000), None).unwrap();

        let other = out.split("  other:").nth(1).unwrap();
        assert!(other.contains("        limit:\n          context: 64000\n"), "wrote {out}");
        // The first provider's `beta` is untouched.
        let example = out.split("  other:").next().unwrap();
        assert!(!example.contains("        limit:\n          context: 64000\n"));
    }

    /// Nothing to write and nothing there is not a reason to touch the file.
    #[test]
    fn an_unknown_model_is_refused_rather_than_invented() {
        assert!(with_model_limits(CONFIG, "custom_provider:example", "delta", None, None).is_none());
        assert!(with_model_limits(CONFIG, "custom_provider:nope", "alpha", Some(1), None).is_none());
        // The managed map carries a `beta` too, and it is not this one.
        assert!(with_model_limits(CONFIG, "provider:minimax", "alpha", Some(1), None).is_none());
        assert!(with_model_limits(CONFIG, "custom_provider:example", "gamma", None, None).is_none());
    }

    /// Clearing both limits takes the block with them, rather than leaving a
    /// `limit:` standing over nothing.
    #[test]
    fn clearing_both_limits_removes_the_block() {
        let out = with_model_limits(CONFIG, "custom_provider:example", "alpha", None, None).unwrap();
        assert!(!out.contains("        limit:"), "wrote {out}");
        // The list that followed it is still there.
        assert!(out.contains("        contextWindowOptions:\n          - 256000\n"));
    }

    /// The form's own refusals, before any child is spawned. Each is a field
    /// the CLI would prompt for — and a prompt with no stdin is an EOF, which
    /// reads to the reader as the button doing nothing.
    #[tokio::test]
    async fn an_incomplete_provider_is_refused_with_the_field() {
        let empty = NewProvider {
            name: "  ".into(),
            base_url: "https://x".into(),
            api_format: "openai-completions".into(),
            models: vec!["m".into()],
            api_key: "k".into(),
            make_default: false,
        };
        assert!(add(&empty).await.unwrap_err().to_string().contains("name"));

        // An empty model list is *not* one of those refusals: it is how a
        // gateway's catalog gets fetched, so the form has to be able to send
        // one, and the field left to refuse is the key.
        let no_key = NewProvider {
            name: "OpenCode Go".into(),
            models: vec![],
            api_key: " ".into(),
            ..empty
        };
        assert!(add(&no_key).await.unwrap_err().to_string().contains("key"));
    }

    /// The URL a gateway's list hangs off, for the shapes a reader actually
    /// pastes. A base carrying the completion path, or a version segment a
    /// Messages gateway does not repeat, must not turn into `/v1/v1/models`.
    #[test]
    fn a_base_url_leads_to_one_list_url_per_dialect() {
        assert_eq!(
            model_list_urls("https://opencode.ai/zen/go/v1", "openai-completions"),
            vec!["https://opencode.ai/zen/go/v1/models"]
        );
        assert_eq!(
            model_list_urls("https://opencode.ai/zen/go/v1/", "openai-completions"),
            vec!["https://opencode.ai/zen/go/v1/models"]
        );
        assert_eq!(
            model_list_urls("https://api.example.com/v1/chat/completions", "openai-completions"),
            vec!["https://api.example.com/v1/models"]
        );
        assert_eq!(
            model_list_urls("https://api.deepseek.com/v1", "anthropic-messages"),
            vec![
                "https://api.deepseek.com/v1/models",
                "https://api.deepseek.com/models"
            ]
        );
    }

    /// Only the OpenAI list shape is read, and a row without an id is dropped
    /// rather than registered as a model named "".
    #[test]
    fn a_list_reply_names_every_model_it_carries() {
        let payload = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "minimax-m3", "object": "model" },
                { "id": "  kimi-k3  " },
                { "name": "no id here" },
                { "id": "" }
            ]
        });
        assert_eq!(
            ids(&payload, "openai-completions"),
            vec!["minimax-m3", "kimi-k3"]
        );

        // A provider that answered with prose, or an error envelope, is not a
        // list of models — an empty answer rather than a panic.
        assert!(ids(&serde_json::json!({ "error": "nope" }), "openai-completions").is_empty());
    }

    /// A gateway serving two wires answers one list for both, so the list is
    /// narrowed to the wire being configured — a model registered under the
    /// wrong one is refused at the end of its first turn, not at the add.
    #[test]
    fn a_two_wire_gateway_registers_only_the_models_its_wire_serves() {
        let payload = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "claude-sonnet-5", "supported_endpoints": ["/messages"] },
                { "id": "gpt-6-astra", "supported_endpoints": ["/chat/completions", "/responses"] },
                { "id": "laguna-s-2.1-free", "supported_endpoints": ["/chat/completions"] }
            ]
        });

        assert_eq!(
            ids(&payload, "openai-completions"),
            vec!["gpt-6-astra", "laguna-s-2.1-free"]
        );
        assert_eq!(
            ids(&payload, "openai-responses"),
            vec!["gpt-6-astra"]
        );
        assert_eq!(
            ids(&payload, "anthropic-messages"),
            vec!["claude-sonnet-5"]
        );

        // A gateway that answers in the OpenAI shape *and* says nothing about
        // routes keeps every model it serves, which is every other list here.
        let quiet = serde_json::json!({
            "data": [{ "id": "minimax-m3" }, { "id": "kimi-k3" }]
        });
        assert_eq!(
            ids(&quiet, "anthropic-messages"),
            vec!["minimax-m3", "kimi-k3"]
        );
    }

    /// The window a gateway states is read off its own row, under whichever of
    /// the names a real endpoint was seen to use — and a row that states none
    /// keeps `None` rather than a neighbour's number.
    #[test]
    fn a_row_states_its_window_or_it_does_not() {
        let payload = serde_json::json!({
            "data": [
                { "id": "command-code-style", "context_length": 1000000 },
                { "id": "vllm-style", "max_model_len": 262144 },
                { "id": "other-style", "context_window": 131072 },
                { "id": "openrouter-style", "top_provider": { "context_length": 200000 } },
                { "id": "silent" },
                { "id": "nonsense", "context_length": "not a number" },
                { "id": "zero", "context_length": 0 }
            ]
        });

        let rows = read_models(&payload, "openai-completions");
        let windows: Vec<(&str, Option<u64>)> = rows
            .iter()
            .map(|model| (model.id.as_str(), model.context_limit))
            .collect();

        assert_eq!(
            windows,
            vec![
                ("command-code-style", Some(1_000_000)),
                ("vllm-style", Some(262_144)),
                ("other-style", Some(131_072)),
                ("openrouter-style", Some(200_000)),
                ("silent", None),
                ("nonsense", None),
                ("zero", None),
            ]
        );
    }

    /// The list Command Code answers with, as it stood when this was written.
    ///
    /// **The endpoint is public**, so the narrow rule is pinned against the real
    /// thing rather than against a hand-written guess: the preset registers this
    /// gateway on the OpenAI wire, and its Claude models — which answer on
    /// `/messages` alone — must not be among the ids that discovery keeps.
    #[test]
    fn a_two_wire_gateway_keeps_its_claude_models_off_the_openai_wire() {
        let payload = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "claude-sonnet-5", "supported_endpoints": ["/messages"] },
                { "id": "claude-fable-5-1", "supported_endpoints": ["/messages"] },
                { "id": "gpt-6-astra", "supported_endpoints": ["/chat/completions", "/responses"] },
                { "id": "deepseek-v4.1-flash", "supported_endpoints": ["/chat/completions"] }
            ]
        });

        let openai = ids(&payload, "openai-completions");
        let claude = ids(&payload, "anthropic-messages");

        assert!(!openai.iter().any(|id| id.starts_with("claude")));
        assert!(openai.contains(&"gpt-6-astra".to_string()));
        assert_eq!(claude, vec!["claude-sonnet-5", "claude-fable-5-1"]);
    }

    /// The header decision, which is the vendor's own: this app does not get to
    /// decide which URLs its gateway treats specially.
    #[test]
    fn the_gateways_own_routing_is_matched_exactly() {
        assert!(is_opencode_go("https://opencode.ai/zen/go/v1"));
        assert!(is_opencode_go("https://opencode.ai/zen/go"));
        assert!(!is_opencode_go("https://opencode.ai/zen/v1"));
        assert!(!is_opencode_go("http://opencode.ai/zen/go/v1"));
        assert!(!is_opencode_go("https://opencode.ai/zen"));
    }

    /// The live lookup, against the gateway the preset names.
    ///
    /// Ignored because it needs the network; run by hand when the discovery
    /// moves. `cargo test --lib -- --ignored a_gateway_lists_every_model_it_serves`
    ///
    /// **It runs with a key that means nothing, on purpose.** This gateway's
    /// list endpoint is public — it answers 200 unauthenticated — so the URL,
    /// the header set and the reply's shape are all provable without a secret
    /// in the repo. Whether the *add* that follows works needs a real key, and
    /// nothing here pretends otherwise.
    #[tokio::test]
    #[ignore]
    async fn a_gateway_lists_every_model_it_serves() {
        let ids = discover("https://opencode.ai/zen/go/v1", "openai-completions", "unused")
            .await
            .expect("the gateway lists its models");

        let listed: Vec<&str> = ids.iter().map(|model| model.id.as_str()).collect();
        assert!(listed.len() > 10, "only got {} models: {listed:?}", listed.len());
        assert!(listed.contains(&"minimax-m3"), "{listed:?}");
    }

    /// The same lookup against Command Code, where the **two wires** are the
    /// thing being pinned.
    ///
    /// Ignored, needs the network, and public for the same reason the one above
    /// is: `cargo test --lib -- --ignored a_command_code_key_lists_its_two_wires_apart`
    ///
    /// What this proves is the split the two presets are built on. If the
    /// vendor ever serves Claude on `/chat/completions` too, the second preset
    /// stops being needed and this is where that shows up.
    #[tokio::test]
    #[ignore]
    async fn a_command_code_key_lists_its_two_wires_apart() {
        const BASE: &str = "https://api.commandcode.ai/provider/v1";

        let openai = discover(BASE, "openai-completions", "unused")
            .await
            .expect("the OpenAI wire lists its models");
        let claude = discover(BASE, "anthropic-messages", "unused")
            .await
            .expect("the Anthropic wire lists its models");

        assert!(openai.len() > 10, "only got {} models", openai.len());
        assert!(claude.len() > 1, "only got {} models", claude.len());
        // **The window comes back with the ids**, which is the whole point of
        // reading rows rather than ids: Command Code states one per model.
        assert!(
            openai.iter().all(|model| model.context_limit.is_some()),
            "a row came back with no window: {openai:?}"
        );
        assert!(
            openai.iter().all(|model| !model.id.starts_with("claude")),
            "a Claude model reached the OpenAI wire: {openai:?}"
        );
        assert!(
            claude.iter().all(|model| model.id.starts_with("claude")),
            "a non-Claude model reached the Anthropic wire: {claude:?}"
        );
    }

    /// The whole connect, end to end: it must leave a session openable.
    ///
    /// Ignored, needs the network, **and writes to `~/.hz/agent`** — the
    /// directory hz keeps for its agent, which is the only place this can be
    /// exercised because [`agent_env`](crate::harness::agent_env) pins every
    /// child to it:
    ///
    /// ```text
    /// HZ_PROVIDER_TEST_KEY=sk-… cargo test --lib -- --ignored connecting_a_provider_opens_a_session
    /// ```
    ///
    /// **This is the test that pins the trap this module fell into.** The
    /// obvious way to activate a provider is `provider add --use`, and in
    /// 0.4.12 it fails every time without saying so — so an add that only reads
    /// back its own list looks successful while `session/new` still refuses with
    /// "Authentication required". Nothing but opening a session catches it.
    ///
    /// It puts the config back and removes the provider it added, so a run
    /// leaves the machine where it found it. A run that panics mid-way does
    /// not, which is the price of exercising the real directory.
    #[tokio::test]
    #[ignore = "needs HZ_PROVIDER_TEST_KEY, the network, and writes to ~/.hz/agent"]
    async fn connecting_a_provider_opens_a_session() {
        let Ok(key) = std::env::var("HZ_PROVIDER_TEST_KEY") else {
            eprintln!("HZ_PROVIDER_TEST_KEY is unset — nothing to test with");
            return;
        };

        let path = config_path().await.expect("hz has an agent config");
        let before = tokio::fs::read_to_string(&path).await.expect("readable config");

        let added = add(&NewProvider {
            name: "OpenCode Go".into(),
            base_url: "https://opencode.ai/zen/go/v1".into(),
            api_format: "openai-completions".into(),
            models: Vec::new(),
            api_key: key,
            make_default: true,
        })
        .await
        .expect("the gateway takes the connection");

        let connected = added
            .iter()
            .find(|provider| provider.name == "OpenCode Go")
            .expect("the provider is listed back");
        assert!(connected.models.len() > 10, "{connected:?}");

        // The half `--use` would have done, and the half that has to have
        // happened: a session can only open on a default that resolves.
        let written = tokio::fs::read_to_string(&path).await.expect("readable config");
        assert!(
            written.contains(&format!("defaultModel: {}/", connected.provider_id)),
            "the default was not pointed at the provider:\n{written}"
        );

        let models = crate::harness::mcode::models::probe()
            .await
            .expect("a session opens on the provider that was just connected");
        assert!(models.len() > 10, "only got {} models", models.len());

        let _ = remove(&connected.provider_id).await;
        tokio::fs::write(&path, before).await.expect("config restored");
    }

    /// The two entries the CLI reports for its own account are dropped, and
    /// nothing else is.
    #[test]
    fn only_the_agents_own_account_entries_are_dropped() {
        let row = |kind: &str| Provider {
            provider_id: "id".into(),
            name: "name".into(),
            kind: kind.into(),
            active: false,
            enabled: true,
            read_only: false,
            has_api_key: false,
            base_url: None,
            api_format: None,
            masked_api_key: None,
            models: Vec::new(),
        };

        assert!(row("minimax-oauth").is_minimax_account());
        assert!(row("minimax-api-key").is_minimax_account());

        // An unknown kind is drawn rather than hidden: this build drops the two
        // entries it knows have no screen behind them, and leaves everything
        // else to the CLI, which is the side that refuses what it will not
        // remove.
        assert!(!row("custom").is_minimax_account());
        assert!(!row("something-new").is_minimax_account());
    }

    /// One line changes, and everything around it survives byte for byte —
    /// including the two keys that start with the same word, which a looser
    /// match would take for the one being written.
    #[test]
    fn the_default_model_line_is_replaced_in_place() {
        let before = "logLevel: info\ndefaultModel: minimax/MiniMax-M3\ndefaultModelVariant: thinking\ncustom_provider:\n  go:\n    defaultModel: hands off\n";

        let after = with_default_model(before, "custom_provider:go/minimax-m3");

        assert!(after.starts_with(
            "logLevel: info\ndefaultModel: custom_provider:go/minimax-m3\ndefaultModelVariant: thinking\n"
        ));
        assert!(after.ends_with("    defaultModel: hands off\n"), "{after}");

        // A file the agent never wrote the key into gets one, rather than the
        // write silently doing nothing.
        assert_eq!(with_default_model("logLevel: info\n", "p/m"), "logLevel: info\ndefaultModel: p/m\n");
    }

    /// **The read is top level only**, and it is the same rule the write follows:
    /// a connected provider carries its own indented `defaultModel:`, which is
    /// that provider's setting and not the model the runtime falls back to.
    ///
    /// This matters because the value is written onto a new Agent's definition,
    /// where naming the wrong one is a model the harness never resolves.
    #[test]
    fn the_machines_default_model_is_read_off_the_top_level_line() {
        let text = "logLevel: info\ndefaultModel: custom_provider:go/minimax-m3\n\ncustom_provider:\n  go:\n    defaultModel: hands off\n";
        assert_eq!(
            read_default_model(text).as_deref(),
            Some("custom_provider:go/minimax-m3")
        );

        assert_eq!(read_default_model("logLevel: info\n"), None);
        assert_eq!(read_default_model("defaultModel:   \n"), None);
    }
}
