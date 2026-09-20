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
//! detail. Every provider change goes through the subcommand. **One key does
//! not, and [`set_default_model`] is where that is argued** — the subcommand
//! that would write it is broken.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use std::time::Duration;
use tokio::process::Command;

use crate::harness::mcode::models;

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

/// The presets this build offers, in the order the form draws them.
///
/// **Command Code is two entries, and that is the API's shape rather than a
/// choice.** Its provider API answers one model list for all of them, and each
/// row names the routes that serve it: Claude is `/v1/messages` only, everything
/// else is `/v1/chat/completions` and mostly `/v1/responses` too, and a model
/// sent to the wrong one is a `400`. `mcode` takes one `--api-format` for the
/// whole provider — its `provider add` has no per-model route — so the split has
/// to be two providers, one wire each. [`read_model_ids`] then keeps discovery
/// from registering the other wire's models under the one being configured.
pub fn presets() -> Vec<ProviderPreset> {
    vec![
        ProviderPreset {
            name: "Command Code".to_string(),
            base_url: "https://api.commandcode.ai/provider/v1".to_string(),
            api_format: "openai-completions".to_string(),
            models: Vec::new(),
            note: "GPT, Gemini and the open models. Claude is the entry below — this API serves those on the Anthropic wire alone.".to_string(),
        },
        ProviderPreset {
            name: "Command Code Claude".to_string(),
            base_url: "https://api.commandcode.ai/provider/v1".to_string(),
            api_format: "anthropic-messages".to_string(),
            models: Vec::new(),
            note: "The same key's Claude models, on the wire they answer — /chat/completions refuses them.".to_string(),
        },
        ProviderPreset {
            name: "OpenCode Go".to_string(),
            base_url: "https://opencode.ai/zen/go/v1".to_string(),
            api_format: "openai-completions".to_string(),
            models: Vec::new(),
            note: "Every model the gateway serves — hz asks it for the list.".to_string(),
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

    let models = if provider.models.iter().all(|model| model.trim().is_empty()) {
        discover(&provider.base_url, &provider.api_format, provider.api_key.trim()).await?
    } else {
        provider.models.clone()
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

    for model in &models {
        let model = model.trim();
        if !model.is_empty() {
            args.push("--model".into());
            args.push(model.to_string());
        }
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

    if provider.make_default {
        set_default_model(&after, provider.name.trim()).await?;
    }

    Ok(after)
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

/// The agent's config, inside hz's own data directory for it.
async fn config_path() -> Result<std::path::PathBuf> {
    let dir = crate::store::get_home_app_dir().await?.join("agent");
    let path = dir.join("config.yaml");
    if !tokio::fs::try_exists(&path).await.unwrap_or(false) {
        bail!("the agent has no config at {}", path.display());
    }
    Ok(path)
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
pub async fn discover(base_url: &str, api_format: &str, api_key: &str) -> Result<Vec<String>> {
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
    Models(Vec<String>),
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
        Ok(payload) => Answer::Models(read_model_ids(&payload, api_format)),
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
fn read_model_ids(payload: &serde_json::Value, api_format: &str) -> Vec<String> {
    payload
        .get("data")
        .and_then(|data| data.as_array())
        .map(|rows| {
            rows.iter()
                .filter(|row| serves_wire(row, api_format))
                .filter_map(|row| row.get("id").and_then(|id| id.as_str()))
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
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
fn client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default()
    })
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
    let mut command = Command::new(&bin);
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
    let mut command = Command::new(&bin);
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
            read_model_ids(&payload, "openai-completions"),
            vec!["minimax-m3", "kimi-k3"]
        );

        // A provider that answered with prose, or an error envelope, is not a
        // list of models — an empty answer rather than a panic.
        assert!(read_model_ids(&serde_json::json!({ "error": "nope" }), "openai-completions").is_empty());
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
            read_model_ids(&payload, "openai-completions"),
            vec!["gpt-6-astra", "laguna-s-2.1-free"]
        );
        assert_eq!(
            read_model_ids(&payload, "openai-responses"),
            vec!["gpt-6-astra"]
        );
        assert_eq!(
            read_model_ids(&payload, "anthropic-messages"),
            vec!["claude-sonnet-5"]
        );

        // A gateway that answers in the OpenAI shape *and* says nothing about
        // routes keeps every model it serves, which is every other list here.
        let quiet = serde_json::json!({
            "data": [{ "id": "minimax-m3" }, { "id": "kimi-k3" }]
        });
        assert_eq!(
            read_model_ids(&quiet, "anthropic-messages"),
            vec!["minimax-m3", "kimi-k3"]
        );
    }

    /// The list Command Code answers with, as it stood when this was written.
    ///
    /// **The endpoint is public**, so the two preset wires are pinned against
    /// the real thing rather than against a hand-written guess: what must not
    /// drift is that Claude stays off the OpenAI entry and everything else stays
    /// off the Anthropic one.
    #[test]
    fn the_command_code_list_splits_the_way_the_two_presets_say() {
        let payload = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "claude-sonnet-5", "supported_endpoints": ["/messages"] },
                { "id": "claude-fable-5-1", "supported_endpoints": ["/messages"] },
                { "id": "gpt-6-astra", "supported_endpoints": ["/chat/completions", "/responses"] },
                { "id": "deepseek-v4.1-flash", "supported_endpoints": ["/chat/completions"] }
            ]
        });

        let openai = read_model_ids(&payload, "openai-completions");
        let claude = read_model_ids(&payload, "anthropic-messages");

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

        assert!(ids.len() > 10, "only got {} models: {ids:?}", ids.len());
        assert!(ids.contains(&"minimax-m3".to_string()), "{ids:?}");
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
        assert!(
            openai.iter().all(|id| !id.starts_with("claude")),
            "a Claude model reached the OpenAI wire: {openai:?}"
        );
        assert!(
            claude.iter().all(|id| id.starts_with("claude")),
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
    fn only_the_agents_own_account_entries_are_dropped() {        let row = |kind: &str| Provider {
            provider_id: "id".into(),
            name: "name".into(),
            kind: kind.into(),
            active: false,
            enabled: true,
            read_only: false,
            has_api_key: false,
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
}
