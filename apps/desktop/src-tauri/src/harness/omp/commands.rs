//! The slash commands omp offers, asked of omp.
//!
//! Same shape and same reason as [`models`](super::models): the composer's `/`
//! picker has to exist before a session does, so there is no child to ask and a
//! throwaway one is spawned instead.
//!
//! **omp pushes this list as well as answering it.** `available_commands_update`
//! arrives unprompted at startup and again on every change — three times in one
//! captured turn, two of them byte-identical. Asking is what this does, because
//! a probe needs no session and the picker has to work before one exists; the
//! push is modelled in the parser so it is not filed as a coverage gap, and is
//! where a later slice would read the list as a session runs.
//!
//! Where pi publishes nothing but a name, omp publishes an argument hint
//! (`input.hint`) and aliases — so unlike pi's, this picker fills every field it
//! draws.

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::rpc::{Incoming, OmpClient, HANDSHAKE_TIMEOUT};
use crate::harness::{claude_code::commands::SlashCommand, ProbeCache};

/// How long a cached answer stands.
///
/// Expiring, like the model list beside it and unlike Claude Code's — omp
/// discovers commands from extensions, plugins and skills the reader can install
/// while Dray is open, and "restart the app" is a poor answer to a picker that is
/// meant to follow what they have set up.
const FRESH_FOR: Duration = Duration::from_secs(120);

/// Keyed by directory: omp's commands include project-scoped ones, so a list read
/// in one checkout says nothing about another.
static CACHE: LazyLock<ProbeCache<Vec<SlashCommand>>> =
    LazyLock::new(|| ProbeCache::new(FRESH_FOR));

/// One entry of `get_available_commands`.
///
/// `subcommands` is on the wire and deliberately unread: omp ships deep menus
/// (`/mcp add`, `/memory mm list`), and the picker draws one row per command with
/// its hint. Folding them in would be a different picker, not a better parse.
///
/// `source` is read only to keep a command whose kind omp adds later from being
/// dropped — every value is offered, exactly as pi's does.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OmpCommand {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    aliases: Option<Vec<String>>,
    #[serde(default)]
    input: Option<CommandInput>,
    #[serde(default)]
    #[allow(dead_code)]
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CommandInput {
    #[serde(default)]
    hint: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CommandsData {
    #[serde(default)]
    commands: Vec<OmpCommand>,
}

/// Every command omp reports for this directory, newest answer or a cached one.
///
/// Failure answers an empty list rather than an error, the same call the model
/// list makes: the picker is an accelerator for text the reader can always type
/// by hand, so it staying shut is a smaller failure than an error over the
/// composer.
pub async fn list_commands(cwd: &str) -> Vec<SlashCommand> {
    CACHE
        .get_or_probe(cwd, || probe(cwd))
        .await
        .unwrap_or_else(|err| {
            eprintln!("[omp commands] {err:#}");
            Vec::new()
        })
}

/// Drops every cached answer, so the next read asks omp again.
pub fn forget() {
    CACHE.forget();
}

/// Spawns a throwaway omp in `cwd`, asks it, and asks it to leave.
///
/// The directory is load-bearing: omp discovers project-scoped commands relative
/// to where it runs, so a probe spawned anywhere else answers for the wrong
/// project.
async fn probe(cwd: &str) -> Result<Vec<SlashCommand>> {
    let bin = crate::binpath::omp().await;
    let mut child = Command::new(&bin)
        .args([
            "--mode",
            "rpc",
            // Mandatory, not tidiness: without it every probe writes a session
            // file into the reader's own `~/.omp/agent/sessions/`, and their
            // session list fills with empty runs Dray started. It also holds the
            // pushed command list to what this process can see, which is what
            // makes the answer the reader's rather than a stale one.
            "--no-session",
        ])
        .current_dir(cwd)
        .env("PATH", crate::harness::agent_path(&bin))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("couldn't start omp to ask for its commands")?;

    let stdin = child.stdin.take().context("failed to take stdin")?;
    let stdout = child.stdout.take().context("failed to take stdout")?;
    let client = OmpClient::new(stdin);

    tokio::spawn({
        let client = client.clone();
        async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                // Only answers matter here. The probe sends no prompt, so
                // anything else omp says is not about us — and it says more than
                // pi does before the answer lands.
                if let Incoming::Malformed = client.accept(&line).await {
                    continue;
                }
            }
        }
    });

    let listed = client
        .request_within("get_available_commands", Value::Null, HANDSHAKE_TIMEOUT)
        .await;

    let answer = listed.map(|data| read_rows(&data));
    super::shutdown(&mut child, &client).await;

    answer
}

/// Folds omp's answer onto the picker's own vocabulary.
///
/// Read field-by-field out of `Value` for the reason the model list gives: a
/// shape omp extends later must cost one field, never the whole list — and an
/// empty picker looks exactly like a reader having no commands at all.
///
/// **Nothing is withheld.** Claude Code's picker drops four commands because Dray
/// owns what they do, and this does not, matching pi's. The concern is real for
/// omp too — `/model` and `/switch` move the running child off what the composer
/// shows, `/rename` retitles a session whose title this app owns, and `/wt` moves
/// the session's directory — and it is written down in `CLAUDE.md` as a known
/// issue rather than solved here. Filtering a list is not solving it either: each
/// is still reachable by typing it.
fn read_rows(data: &Value) -> Vec<SlashCommand> {
    let Ok(answer) = serde_json::from_value::<CommandsData>(data.clone()) else {
        return Vec::new();
    };

    answer
        .commands
        .into_iter()
        .map(|command| SlashCommand {
            name: command.name,
            description: command.description.unwrap_or_default(),
            // Both of these are omp's own, where pi's picker leaves them empty.
            argument_hint: command
                .input
                .and_then(|i| i.hint)
                .unwrap_or_default(),
            aliases: command.aliases.unwrap_or_default(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// omp's answer becomes the picker's rows, and unlike pi's it carries the
    /// hint and the aliases too.
    #[test]
    fn commands_carry_their_names_and_everything_omp_publishes() {
        let rows = read_rows(&json!({
            "commands": [
                {"name": "compact",
                 "description": "Compact the conversation",
                 "input": {"hint": "[soft|remote] [focus]"},
                 "subcommands": [{"name": "soft"}],
                 "source": "builtin"},
                {"name": "model", "aliases": ["models"],
                 "description": "Show current model selection",
                 "source": "builtin"},
            ]
        }));

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "compact");
        assert_eq!(rows[0].description, "Compact the conversation");
        assert_eq!(
            rows[0].argument_hint, "[soft|remote] [focus]",
            "omp publishes a hint and the picker draws the ones it is given"
        );
        assert_eq!(rows[1].aliases, vec!["models".to_string()]);
        assert!(
            rows[1].argument_hint.is_empty(),
            "a command with no hint draws none, rather than an invented one"
        );
    }

    /// A shape this build cannot read costs the list, never the connection.
    ///
    /// The picker is an accelerator, so an empty one is a smaller failure than a
    /// probe that errors — but it looks exactly like a reader having no commands,
    /// which is why every field is optional rather than this being the ordinary
    /// path.
    #[test]
    fn an_unreadable_answer_is_an_empty_picker_and_not_a_failure() {
        assert!(read_rows(&json!({"commands": "not a list"})).is_empty());
        assert!(read_rows(&json!(null)).is_empty());
        assert!(
            read_rows(&json!({})).is_empty(),
            "an answer with no commands key is an omp with no commands"
        );
    }

    /// A command omp adds a new `source` kind for is still offered — the field is
    /// read to keep the row rather than to filter on it.
    #[test]
    fn a_command_of_an_unfamiliar_kind_is_still_offered() {
        let rows = read_rows(&json!({
            "commands": [{"name": "novel", "source": "something_new"}]
        }));

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "novel");
    }
}
