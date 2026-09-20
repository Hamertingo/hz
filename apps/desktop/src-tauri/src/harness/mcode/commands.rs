//! The slash commands mcode publishes, and the row the picker draws.
//!
//! **Nothing here is asked for.** mcode pushes its own list as
//! `available_commands_update` — once when a session opens and again whenever
//! it changes — so the picker's contents are the CLI's current answer rather
//! than a table this file keeps true. What this module does is hold the last
//! one a session sent and shape it into the row the composer reads.
//!
//! The list is worth having because it is *actionable*: `compact`, `model`,
//! `skills`, `mcp` and `usage` are all commands the TUI names, and a reader who
//! types one into a prompt instead gets it sent to the model as prose.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::parser::Command;

/// One row of the composer's slash menu.
///
/// Defined here rather than in a shared module because there is one harness
/// left to have one, and the shape is the frontend's: it names what the menu
/// draws and nothing about where it came from.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
    /// What the command does with the rest of the line — `<model>`, `[name]`.
    /// Empty for most; the CLI sends `""` rather than omitting it.
    pub argument_hint: String,
    /// Other names that reach the same command. Absent on most.
    #[serde(default)]
    pub aliases: Vec<String>,
}

/// The CLI's own command list, shaped for the picker.
///
/// Pure, so a capture can pin it without a child.
///
/// **The hint is read and the aliases are not**, and that is the wire's shape
/// rather than a choice: ACP's `AvailableCommand` carries a name, a description
/// and an `input`, and the input's only kind carries a `hint`. `aliases` stays
/// empty because nothing states one — it is here for the harness that does.
pub fn from_commands(commands: &[Command]) -> Vec<SlashCommand> {
    commands
        .iter()
        .filter(|command| !command.name.is_empty())
        .map(|command| SlashCommand {
            name: command.name.clone(),
            description: command.description.clone().unwrap_or_default(),
            argument_hint: command
                .input
                .as_ref()
                .map(|input| input.hint.clone())
                .unwrap_or_default(),
            aliases: Vec::new(),
        })
        .collect()
}

/// Emitted as `slash_commands` when the agent states its list, which it does
/// when a session opens and again whenever the set changes.
///
/// **Not an `AgentEvent`**, for `SessionTitleEvent`'s reason: no line of the
/// log produced it, and a replayed session has no child to have published one —
/// so it must never reach the `.jsonl`. The list belongs to the live connection
/// and crosses as it arrives, which is also why the app asks nobody for it: the
/// agent pushes, and a request made later would have to guess when.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct SlashCommandsEvent {
    pub session_id: String,
    pub commands: Vec<SlashCommand>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::harness::mcode::parser::tests::updates;

    const LIVE_TURN: &str = include_str!("fixtures/live_turn.jsonl");

    fn captured() -> Vec<Command> {
        updates(LIVE_TURN)
            .into_iter()
            .find_map(|update| match update {
                crate::harness::mcode::parser::SessionUpdate::AvailableCommandsUpdate {
                    available_commands,
                } => Some(available_commands),
                _ => None,
            })
            .expect("the capture carries the CLI's command list")
    }

    /// Every command mcode publishes becomes a row, in the order it sent them —
    /// **with the argument hint the agent states**, which is the half this used
    /// to drop: the capture has carried `input.hint` all along, so the picker
    /// drew `/model` as a bare word while the terminal drew
    /// `/model [provider/model[#variant]]`.
    #[test]
    fn the_published_list_becomes_menu_rows() {
        let rows = from_commands(&captured());

        let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "help", "new", "model", "status", "doctor", "context", "skills", "mcp", "usage",
                "compact"
            ]
        );
        assert_eq!(rows[2].argument_hint, "[provider/model[#variant]]");
        assert_eq!(rows[6].argument_hint, "[filter]");
        // A command that takes nothing says nothing, rather than the empty
        // braces the wire omits.
        assert_eq!(rows[0].argument_hint, "");
        assert!(rows.iter().all(|r| r.aliases.is_empty()));
        assert!(!rows[0].description.is_empty(), "help carries its sentence");
    }

    /// A command with no name is dropped rather than drawn as a blank row: the
    /// name is what the reader types.
    #[test]
    fn a_nameless_command_is_dropped() {
        let rows = from_commands(&[
            Command {
                name: "compact".to_string(),
                description: Some("Shrink the conversation".to_string()),
                input: None,
            },
            Command::default(),
        ]);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "compact");
    }
}
