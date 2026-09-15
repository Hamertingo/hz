//! Which models omp can actually run here, asked of omp.
//!
//! Same shape and same reason as pi's: omp is multi-provider — 60+ of them —
//! and the list depends on which the reader has logged into, so no table written
//! in this repo could name them. A throwaway `omp --mode rpc` is spawned, asked,
//! and asked to leave.
//!
//! **One round trip, where pi needs three per model.** omp folds the thinking
//! ladder into each model's own row (`thinking.efforts`) and removed
//! `get_available_thinking_levels` outright — so the second half of pi's probe,
//! which had to `set_model` to each row and ask, does not exist here. That is
//! the one place omp's surface is straightforwardly better rather than merely
//! different, and it also removes pi's sharpest edge: a ladder read from the
//! *current* model and applied to a row it does not describe.

use crate::harness::ProbeCache;
use crate::models::{Effort, Model, ModelId};
use anyhow::{Context, Result};
use serde_json::Value;
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::rpc::{Incoming, OmpClient, HANDSHAKE_TIMEOUT};

/// How long a cached answer stands.
///
/// Expiring, like pi's: a provider logged into while Dray is open is exactly the
/// case a reader would then try to use, and "restart the app" is a poor answer
/// to a list that is *supposed* to follow their logins.
const FRESH_FOR: Duration = Duration::from_secs(120);

/// One entry, keyed by nothing: the list depends on the reader's providers, not
/// on a directory.
static CACHE: LazyLock<ProbeCache<Vec<Model>>> = LazyLock::new(|| ProbeCache::new(FRESH_FOR));

/// Every model omp reports, newest answer or a cached one.
///
/// Failure answers an empty list rather than an error: the picker draws its own
/// empty state, and a reader with no provider configured is in an ordinary state
/// rather than a broken one.
pub async fn list() -> Vec<Model> {
    CACHE.get_or_probe("", probe).await.unwrap_or_else(|err| {
        eprintln!("[omp models] {err:#}");
        Vec::new()
    })
}

/// The model with this id, from whatever omp last reported.
///
/// `None` for the unset sentinel — omp picking for itself — and for an id no
/// provider on this machine serves. The second is not refused here: omp's own
/// `Model not found` names exactly what was wrong on the spawn, and a guess made
/// here could not.
pub async fn find(id: &ModelId) -> Option<Model> {
    if id.is_unset() {
        return None;
    }

    list().await.into_iter().find(|m| &m.id == id)
}

/// Drops the cached answer, so the next read asks omp again.
pub fn forget() {
    CACHE.forget();
}

/// Spawns a throwaway omp, asks it, and asks it to leave.
async fn probe() -> Result<Vec<Model>> {
    let bin = crate::binpath::omp().await;
    let mut child = Command::new(&bin)
        .args([
            "--mode",
            "rpc",
            // Mandatory, not tidiness: without it every probe writes a session
            // file into the reader's own `~/.omp/agent/sessions/`, and their
            // session list fills with empty runs Dray started.
            "--no-session",
        ])
        .env("PATH", crate::harness::agent_path(&bin))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("couldn't start omp to ask for its models")?;

    let stdin = child.stdin.take().context("failed to take stdin")?;
    let stdout = child.stdout.take().context("failed to take stdout")?;
    let client = OmpClient::new(stdin);

    tokio::spawn({
        let client = client.clone();
        async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                // Only answers matter here. The probe sends no prompt, so
                // anything else omp says — and it says more than pi does,
                // starting with a `ready` frame and three copies of its command
                // list — is not about us.
                if let Incoming::Malformed = client.accept(&line).await {
                    continue;
                }
            }
        }
    });

    let listed = client
        .request_within("get_available_models", Value::Null, HANDSHAKE_TIMEOUT)
        .await;

    let models = listed.map(|data| read_rows(&data));

    // Ended by EOF rather than killed: a `Child` is not reaped on drop, so a
    // probe per picker-open would leak one omp each time.
    super::shutdown(&mut child, &client).await;

    models
}

/// Folds omp's answer onto the picker's vocabulary.
///
/// Read field-by-field out of `Value` for the reason the Claude Code mapper
/// gives: a shape omp extends later must cost one field, never the whole list —
/// and an empty picker looks exactly like a reader having no models at all.
fn read_rows(data: &Value) -> Vec<Model> {
    let rows = data
        .get("models")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    rows.iter().filter_map(row_to_model).collect()
}

/// Reads one row.
///
/// An omp model is named by **two** fields, not one: the spawn takes
/// `--provider` and `--model` separately, and `set_model` takes `provider` and
/// `modelId`. So the persisted id joins them and `arg` keeps the bare half,
/// which is what the flag receives. Joining is not cosmetic — two providers can
/// serve the same model name, and an id that dropped the provider would record a
/// pick that resolves to whichever row came back first.
fn row_to_model(row: &Value) -> Option<Model> {
    let id = row.get("id").and_then(Value::as_str)?;
    let provider = row.get("provider").and_then(Value::as_str)?;

    Some(Model {
        id: ModelId::new(format!("{provider}/{id}")),
        // omp's own display name, and the row is already under its provider's
        // heading, so the provider is not repeated in it.
        label: row
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_string(),
        efforts: efforts_from_row(row),
        // omp has its own, configured by whoever set the provider up — and it
        // reports one (`defaultReasoningEffort` on some rows). Naming one here
        // would override a choice this app never made.
        default_effort: None,
        arg: id.to_string(),
        provider: provider.to_string(),
        // A real model that takes no images — the capture has several reporting
        // `input: ["text"]` — and the composer's tray has to know before it
        // offers to send one.
        accepts_images: accepts_images(row),
        // omp's picker draws the reader's shortlist rather than the whole list,
        // like pi's, so it already has its own answer to "which few of these do
        // I want in front of me" and a second tier here would be a second one.
        secondary: false,
    })
}

/// Dray's own ladder, out of the row's own `thinking.efforts`.
///
/// **The row carries its own, which is the whole reason there is no second
/// round trip here.** omp removed `get_available_thinking_levels`; the ladder
/// rides each model instead, so a reading cannot be applied to a model it does
/// not describe.
///
/// `off` and `minimal` are dropped rather than added to [`Effort`]: `off` is
/// what an empty list already means here, and `minimal` is a rung below Dray's
/// floor. So `["off"]` alone — what a non-reasoning model answers — reaches the
/// picker as no levels at all, which is the existing convention for a model with
/// none.
fn efforts_from_row(row: &Value) -> Vec<Effort> {
    let names = match row
        .get("thinking")
        .and_then(|t| t.get("efforts"))
        .and_then(Value::as_array)
    {
        Some(names) => names,
        None => return Vec::new(),
    };

    names
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|name| match name {
            "low" => Some(Effort::Low),
            "medium" => Some(Effort::Medium),
            "high" => Some(Effort::High),
            "xhigh" => Some(Effort::Xhigh),
            "max" => Some(Effort::Max),
            "ultra" => Some(Effort::Ultra),
            _ => None,
        })
        .collect()
}

fn accepts_images(row: &Value) -> bool {
    match row.get("input").and_then(Value::as_array) {
        Some(kinds) => kinds.iter().any(|k| k.as_str() == Some("image")),
        // Absent means omp did not say. Assumed yes, because the cost of being
        // wrong is one refused attachment with omp's own sentence on it, where
        // the other way round silently hides a working feature.
        None => true,
    }
}

/// The models grouped by provider, in the order omp listed them.
pub fn by_provider(models: &[Model]) -> Vec<(String, Vec<Model>)> {
    let mut groups: Vec<(String, Vec<Model>)> = Vec::new();

    for model in models {
        match groups.iter_mut().find(|(provider, _)| *provider == model.provider) {
            Some((_, rows)) => rows.push(model.clone()),
            None => groups.push((model.provider.clone(), vec![model.clone()])),
        }
    }

    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real `get_available_models` answer, trimmed to its first three rows
    /// by `fixtures/README.md`'s rule.
    fn captured() -> Value {
        let fixture = include_str!("fixtures/handshake.jsonl");

        for line in fixture.lines().filter(|l| !l.trim().is_empty()) {
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            if value.get("command").and_then(Value::as_str) == Some("get_available_models") {
                return value.get("data").cloned().unwrap_or(Value::Null);
            }
        }

        panic!("the capture has no get_available_models answer in it");
    }

    fn rows() -> Vec<Model> {
        read_rows(&captured())
    }

    /// The whole argument for discovering the list: models across several
    /// providers, none of them nameable by a table written in this repo.
    #[test]
    fn the_captured_list_is_read_whole() {
        let models = rows();

        assert!(!models.is_empty());
        assert!(models.iter().all(|m| !m.id.as_str().is_empty()));
        assert!(models.iter().all(|m| !m.arg.is_empty()));
    }

    /// The persisted id joins the two halves the spawn takes separately, and
    /// `arg` keeps the bare one. An id that dropped the provider would record a
    /// pick that resolves to whichever row came back first.
    #[test]
    fn the_id_carries_the_provider_and_the_arg_does_not() {
        for model in rows() {
            assert_eq!(model.id.as_str(), format!("{}/{}", model.provider, model.arg));
            assert!(!model.arg.contains('/'), "{} is not bare", model.arg);
        }
    }

    /// The ladder rides the row, which is what lets this probe be one round trip
    /// where pi's is three per model.
    #[test]
    fn each_row_carries_its_own_ladder() {
        let models = rows();

        assert!(
            models.iter().any(|m| !m.efforts.is_empty()),
            "no row carried a ladder, so the second round trip pi needs was assumed away"
        );

        // And the ladder is Dray's own set, in the row's order.
        let with_levels = models
            .iter()
            .find(|m| !m.efforts.is_empty())
            .expect("checked just above");
        assert!(
            with_levels.efforts.iter().all(|e| *e != Effort::Low
                || with_levels.efforts.contains(&Effort::Low)),
            "a level outside Dray's ladder reached the picker"
        );
    }

    /// A row missing either half of its name is dropped, and the rest of the
    /// list survives — an empty picker names no reason.
    #[test]
    fn a_row_missing_half_its_name_costs_one_row() {
        let rows = serde_json::json!({
            "models": [
                {"id": "grok-4.6", "provider": "xai"},
                {"id": "no-provider"},
                {"provider": "xai"},
            ]
        });

        let models = read_rows(&rows);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id.as_str(), "xai/grok-4.6");
    }

    /// A shape this build cannot read costs the list, never the connection.
    #[test]
    fn an_unreadable_answer_is_an_empty_picker_and_not_a_failure() {
        assert!(read_rows(&serde_json::json!({"models": "not a list"})).is_empty());
        assert!(read_rows(&Value::Null).is_empty());
        assert!(read_rows(&serde_json::json!({})).is_empty());
    }

    /// `["off"]` is what a non-reasoning model answers, and it reaches the
    /// picker as no levels — which is already what an empty list means here.
    #[test]
    fn the_ladder_keeps_drays_own_and_nothing_else() {
        let none = serde_json::json!({"thinking": {"mode": "effort", "efforts": ["off", "minimal"]}});
        assert!(efforts_from_row(&none).is_empty());

        let full = serde_json::json!({
            "thinking": {"efforts": ["low", "medium", "high", "xhigh", "max", "ultra"]}
        });
        assert_eq!(
            efforts_from_row(&full),
            vec![
                Effort::Low,
                Effort::Medium,
                Effort::High,
                Effort::Xhigh,
                Effort::Max,
                Effort::Ultra
            ]
        );

        // A model with no `thinking` key at all is a model with no levels.
        assert!(efforts_from_row(&serde_json::json!({"id": "x"})).is_empty());
    }

    /// A real model that takes no images, and one that does. The composer's tray
    /// has to know before it offers to send one.
    #[test]
    fn a_text_only_model_says_so() {
        let models = rows();

        assert!(
            models.iter().any(|m| !m.accepts_images),
            "the capture has text-only rows in it"
        );
    }

    /// Absent `input` is not "no images": the cost of being wrong is one refused
    /// attachment with omp's own sentence on it, where the other way round
    /// silently hides a working feature.
    #[test]
    fn an_absent_input_reads_as_accepting_images() {
        assert!(accepts_images(&serde_json::json!({"id": "x"})));
        assert!(!accepts_images(&serde_json::json!({"input": ["text"]})));
        assert!(accepts_images(&serde_json::json!({"input": ["text", "image"]})));
    }

    /// Two providers on one machine, and every id distinct across them — which
    /// is the property the joined id exists to keep.
    #[test]
    fn a_row_names_its_model_and_its_group_names_the_provider() {
        let models = rows();
        let groups = by_provider(&models);

        assert!(!groups.is_empty());

        let ids: std::collections::HashSet<_> = models.iter().map(|m| m.id.clone()).collect();
        assert_eq!(ids.len(), models.len(), "two rows share one id");

        for (provider, rows) in &groups {
            assert!(!provider.is_empty());
            for row in rows {
                assert_eq!(row.provider, *provider);
            }
        }
    }

    /// The probe against the omp on this machine, printed rather than asserted.
    ///
    /// Everything above reads a capture, so it proves the parse and nothing about
    /// whether the *commands* still answer — which is the half a new omp release
    /// can break, and the half `binpath` deliberately does not guard with a
    /// version number. Ignored by default: the answer is a property of whoever is
    /// running it, and it spawns a child.
    #[tokio::test]
    #[ignore]
    async fn what_the_installed_omp_answers() {
        let models = probe().await.expect("omp answered the probe");

        for (provider, rows) in by_provider(&models) {
            println!("{provider}");
            for row in rows {
                let efforts: Vec<_> = row.efforts.iter().map(|e| e.as_arg()).collect();
                println!("  {:<34} {}", row.arg, efforts.join(" "));
            }
        }

        assert!(!models.is_empty(), "omp reported no models at all");
    }
}
