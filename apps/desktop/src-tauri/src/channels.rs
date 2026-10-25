//! Channels: a room where you and a few agents work on one thing together.
//!
//! A channel is a record in `~/.hz/channels.json` and a transcript of its own,
//! `~/.hz/channels/<id>/messages.jsonl`, beside the tasks agents took on in it
//! (`tasks.json`) and the thread each member answers in (`threads.json`).
//!
//! **An agent answers a channel in a conversation of its own.** One ACP session
//! per channel-agent pair, made lazily on the first turn the agent is asked to
//! take there. The agent's own chat is a different session, so a busy channel
//! never fills it and the agent's chat never has to carry the channel's
//! backlog. The answer of each turn is copied into the channel's transcript, and
//! only that.
//!
//! **A message starts a round.** Who answers is decided by [`plan_user`]: the
//! agents `@mentioned`, else the author of the message replied to, else the
//! owner of the task replied to, else by the channel's mode. An answer that
//! `@mentions` a member starts the next round, up to the channel's `rounds`, an
//! agent answering at most once per round and a whole chain at most
//! [`MAX_REPLIES`] times. The loop itself ([`run_chain`]) knows nothing about
//! Tauri: it talks to a [`Host`], which the app implements over real sessions and
//! the tests implement with a script.

use std::{
    collections::{HashMap, HashSet},
    future::Future,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, LazyLock, Mutex, OnceLock,
    },
    time::Duration,
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;
use ts_rs::TS;

use crate::{
    agents,
    events::TurnStatus,
    store::{get_home_app_dir, read_json, write_atomic},
};

/// Messages of context an agent is handed with each turn.
const HISTORY: usize = 20;
/// Answers one user message may cause across all its rounds, whoever asks for
/// them. Codync's cap; the round count alone would let ten members answer three
/// times each.
pub const MAX_REPLIES: usize = 10;
/// How long a turn is waited for, approvals included.
const TURN_TIMEOUT: Duration = Duration::from_secs(20 * 60);

/// Who answers a message nobody was named on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// The lead answers, or whoever was `@mentioned`.
    #[default]
    Mention,
    /// Every member, once, in the order they joined.
    Turns,
    /// The lead reads the message and hands it on.
    Lead,
}

/// One channel as stored.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub name: String,
    pub purpose: String,
    /// Roster agent ids, in the order they joined.
    pub members: Vec<String>,
    pub lead: String,
    #[serde(default)]
    pub mode: Mode,
    /// Rounds one message may run, 1 to 3.
    pub rounds: u8,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub created: u64,
    /// The newest message's `seq`, which is also how the next one is numbered.
    #[serde(default)]
    pub last_seq: u64,
    #[serde(default)]
    pub last_ts: u64,
    /// The newest message that is an agent's, so "unread" is a comparison.
    #[serde(default)]
    pub last_agent_seq: u64,
    /// How far the reader has read.
    #[serde(default)]
    pub read_seq: u64,
}

/// An emoji on a message and the people who put it there (`me` or agent ids).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct Reaction {
    pub emoji: String,
    pub by: Vec<String>,
}

/// A file named on a message.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct ChannelAttachment {
    pub path: String,
    pub name: String,
}

/// What a transcript line is.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "lowercase")]
pub enum MessageKind {
    #[default]
    Message,
    /// A line from hz itself: an agent that could not answer, a stop.
    Note,
}

/// One line of a channel's transcript.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessage {
    pub seq: u64,
    /// Unix milliseconds.
    pub ts: u64,
    /// `me`, or the roster id of the agent that said it.
    pub from: String,
    pub text: String,
    #[serde(default)]
    pub reply_to: Option<u64>,
    #[serde(default)]
    pub reactions: Vec<Reaction>,
    /// The round this answer belongs to; 0 for what the reader wrote.
    #[serde(default)]
    pub round: u8,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub kind: MessageKind,
    #[serde(default)]
    pub attachments: Vec<ChannelAttachment>,
}

/// Where a task stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Waiting,
    Writing,
    Done,
    WaitingForYou,
}

impl TaskStatus {
    fn parse(word: &str) -> Option<Self> {
        match word.trim().to_lowercase().replace([' ', '-'], "_").as_str() {
            "waiting" => Some(Self::Waiting),
            "writing" | "working" | "in_progress" => Some(Self::Writing),
            "done" => Some(Self::Done),
            "waiting_for_you" => Some(Self::WaitingForYou),
            _ => None,
        }
    }

    fn sentence(self) -> &'static str {
        match self {
            Self::Waiting => "Waiting",
            Self::Writing => "Writing",
            Self::Done => "Done",
            Self::WaitingForYou => "Waiting for you",
        }
    }
}

/// A step in a task's thread.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
pub struct TaskStep {
    pub at: u64,
    pub text: String,
}

/// Work one agent took on in a channel.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub channel_id: String,
    pub title: String,
    /// The agent that owns it.
    pub owner: String,
    pub status: TaskStatus,
    pub created: u64,
    pub updated: u64,
    /// The message the task was announced in.
    #[serde(default)]
    pub message_seq: Option<u64>,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub steps: Vec<TaskStep>,
}

/// The thread an agent answers a channel in.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub agent_id: String,
    pub session_id: String,
}

/// Who is answering now, for the typing line and the round label.
#[derive(Clone, Debug, Default, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Working {
    pub agents: Vec<String>,
    pub round: u8,
}

/// Everything the page draws for one channel.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ChannelDetail {
    pub channel: Channel,
    pub messages: Vec<ChannelMessage>,
    pub tasks: Vec<Task>,
    pub threads: Vec<Thread>,
    pub working: Working,
}

/// What a new channel is made from.
#[derive(Clone, Debug, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct NewChannel {
    #[serde(default)]
    #[ts(optional)]
    pub workspace_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub purpose: String,
    pub members: Vec<String>,
    #[serde(default)]
    #[ts(optional)]
    pub lead: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub mode: Option<Mode>,
    #[serde(default)]
    #[ts(optional)]
    pub rounds: Option<u8>,
}

/// The fields an edit may change. A field left out is left alone.
#[derive(Clone, Debug, Default, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ChannelPatch {
    #[serde(default)]
    #[ts(optional)]
    pub name: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub purpose: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub members: Option<Vec<String>>,
    #[serde(default)]
    #[ts(optional)]
    pub lead: Option<String>,
    #[serde(default)]
    #[ts(optional)]
    pub mode: Option<Mode>,
    #[serde(default)]
    #[ts(optional)]
    pub rounds: Option<u8>,
    #[serde(default)]
    #[ts(optional)]
    pub muted: Option<bool>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A channel name as it is kept: lower case, letters, digits and dashes.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').chars().take(40).collect::<String>().trim_end_matches('-').to_string()
}

// ───────────────────────── routing (pure) ─────────────────────────

/// An agent as the routing sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Person {
    pub id: String,
    pub name: String,
    pub role: String,
}

/// One agent asked to answer, and by whom.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Turn {
    pub agent: String,
    /// The name of whoever addressed it.
    pub from: String,
    /// What they said, cut short.
    pub text: String,
    /// The lead is reading this to decide who answers.
    pub routing: bool,
}

/// The first round of a message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Plan {
    pub turns: Vec<Turn>,
    /// One after the other, each seeing the one before. Otherwise together.
    pub sequential: bool,
}

/// What the reader posted, with the facts about what it answers.
pub struct Incoming<'a> {
    pub text: &'a str,
    pub from_name: &'a str,
    /// The author of the message replied to, when it was an agent's.
    pub reply_author: Option<&'a str>,
    /// The owner of the task the replied-to message announced.
    pub reply_task_owner: Option<&'a str>,
}

fn clip(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let cut: String = flat.chars().take(max.saturating_sub(1)).collect();
    format!("{}\u{2026}", cut.trim_end())
}

/// `text` with code stripped, so `@name` inside a snippet calls nobody.
fn without_code(text: &str) -> String {
    let mut out = String::new();
    let mut fenced = false;
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        let mut inline = false;
        for c in line.chars() {
            if c == '`' {
                inline = !inline;
            } else if !inline {
                out.push(c);
            }
        }
        out.push('\n');
    }
    out
}

/// Whether `@name` stands in `text` as a word: not part of an address or a
/// longer name.
fn has_handle(text: &str, name: &str) -> bool {
    !handle_hits(text, &[name.to_string()]).is_empty()
}

/// Which of `names` each `@handle` in `text` is, in order of appearance. The
/// first name that fits wins, so the caller lists longer names first.
fn handle_hits(text: &str, names: &[String]) -> Vec<usize> {
    let chars: Vec<char> = text.to_lowercase().chars().collect();
    let wanted: Vec<Vec<char>> = names.iter().map(|n| n.trim().to_lowercase().chars().collect()).collect();
    let mut hits = Vec::new();
    for (i, c) in chars.iter().enumerate() {
        if *c != '@' {
            continue;
        }
        // `me@host.com` is an address, not a call.
        if i > 0 && (chars[i - 1].is_alphanumeric() || chars[i - 1] == '.') {
            continue;
        }
        let fits = |want: &Vec<char>| {
            !want.is_empty()
                && chars.len() > i + want.len()
                && chars[i + 1..=i + want.len()] == want[..]
                && !chars.get(i + 1 + want.len()).is_some_and(|c| c.is_alphanumeric() || *c == '_')
        };
        if let Some(n) = wanted.iter().position(fits) {
            hits.push(n);
        }
    }
    hits
}

/// The members `text` addresses with `@name`, in order of appearance, each once.
/// `@all`, `@everyone` and `@channel` address every member.
pub fn mentions(text: &str, roster: &[Person]) -> Vec<String> {
    let text = without_code(text);
    // Longest first, so "Mila Costa" is not read as "Mila".
    let mut order: Vec<&Person> = roster.iter().collect();
    order.sort_by_key(|p| std::cmp::Reverse(p.name.chars().count()));
    let mut names: Vec<String> = order.iter().map(|p| p.name.clone()).collect();
    let people = names.len();
    names.extend(["all", "everyone", "channel"].map(String::from));

    let mut out: Vec<String> = Vec::new();
    for n in handle_hits(&text, &names) {
        let ids: Vec<&str> = if n < people {
            vec![order[n].id.as_str()]
        } else {
            roster.iter().map(|p| p.id.as_str()).collect()
        };
        for id in ids {
            if !out.iter().any(|o| o == id) {
                out.push(id.to_string());
            }
        }
    }
    out
}

/// Whether `text` calls the reader by `@their name`.
pub fn mentions_me(text: &str, me: &str) -> bool {
    me.trim().chars().count() > 1 && has_handle(&without_code(text), me)
}

fn turn_for(person: &Person, incoming: &Incoming<'_>, routing: bool) -> Turn {
    Turn {
        agent: person.id.clone(),
        from: incoming.from_name.to_string(),
        text: clip(incoming.text, 240),
        routing,
    }
}

/// Who answers what the reader wrote, and how.
///
/// The order is OpenBot's rule for ownership: a named recipient first, then the
/// owner of the task replied to, then the author of the message replied to, and
/// only then the channel's mode — where, when the mode would send it to the lead,
/// the owner of the channel's one open task answers instead.
pub fn plan_user(channel: &Channel, roster: &[Person], incoming: &Incoming<'_>, open_owners: &[String]) -> Plan {
    let by_id = |id: &str| roster.iter().find(|p| p.id == id);
    let one = |person: &Person| Plan { turns: vec![turn_for(person, incoming, false)], sequential: false };

    let named = mentions(incoming.text, roster);
    if !named.is_empty() {
        return Plan {
            turns: named.iter().filter_map(|id| by_id(id)).map(|p| turn_for(p, incoming, false)).collect(),
            sequential: false,
        };
    }
    if let Some(person) = incoming.reply_task_owner.and_then(by_id) {
        return one(person);
    }
    if let Some(person) = incoming.reply_author.and_then(by_id) {
        return one(person);
    }

    let lead = by_id(&channel.lead).or_else(|| roster.first());
    match channel.mode {
        Mode::Turns => Plan {
            turns: channel
                .members
                .iter()
                .filter_map(|id| by_id(id))
                .map(|p| turn_for(p, incoming, false))
                .collect(),
            sequential: true,
        },
        Mode::Lead => match lead {
            Some(lead) => Plan { turns: vec![turn_for(lead, incoming, true)], sequential: false },
            None => Plan { turns: Vec::new(), sequential: false },
        },
        Mode::Mention => {
            let owners: HashSet<&String> = open_owners.iter().collect();
            if owners.len() == 1 {
                if let Some(person) = open_owners.first().and_then(|id| by_id(id)) {
                    return one(person);
                }
            }
            match lead {
                Some(lead) => one(lead),
                None => Plan { turns: Vec::new(), sequential: false },
            }
        }
    }
}

/// An answer that says there is nothing to add.
pub fn is_pass(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    t.is_empty() || t.starts_with("(pass)")
}

/// What an agent's answer holds beyond its words.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Answer {
    pub text: String,
    /// A task the answer announces with a first line of `[task] Title`.
    pub task: Option<String>,
}

/// Reads the task marker off the front of an answer.
pub fn parse_answer(text: &str) -> Answer {
    let trimmed = text.trim();
    let first = trimmed.lines().next().unwrap_or_default().trim();
    let marker = first.get(..6).map(str::to_lowercase);
    if marker.as_deref() == Some("[task]") {
        let title = first[6..].trim().trim_matches(['*', ':']).trim().to_string();
        if !title.is_empty() {
            let rest = trimmed[trimmed.find('\n').map_or(trimmed.len(), |i| i + 1)..].trim();
            let body = if rest.is_empty() { title.clone() } else { rest.to_string() };
            return Answer { text: body, task: Some(title) };
        }
    }
    Answer { text: trimmed.to_string(), task: None }
}

/// The reading an agent is handed for one turn.
pub struct PromptCtx<'a> {
    pub channel: &'a Channel,
    pub me: &'a str,
    pub roster: &'a [Person],
    pub agent: &'a Person,
    pub recent: &'a [ChannelMessage],
    pub turn: &'a Turn,
    pub round: u8,
}

fn clock(ms: u64) -> String {
    use chrono::{Local, TimeZone};
    Local
        .timestamp_millis_opt(ms as i64)
        .single()
        .map(|t| t.format("%H:%M").to_string())
        .unwrap_or_default()
}

/// The prompt for one channel turn: the room, the rules, the last messages and
/// who is asking.
pub fn context_prompt(ctx: &PromptCtx<'_>) -> String {
    let PromptCtx { channel, me, roster, agent, recent, turn, round } = ctx;
    let name_of = |id: &str| -> String {
        if id == "me" {
            (*me).to_string()
        } else {
            roster.iter().find(|p| p.id == id).map_or_else(|| "Someone".to_string(), |p| p.name.clone())
        }
    };
    let members = roster
        .iter()
        .map(|p| {
            let mut s = p.name.clone();
            if !p.role.is_empty() {
                s.push_str(&format!(" ({})", p.role));
            }
            if p.id == channel.lead {
                s.push_str(" [lead]");
            }
            s
        })
        .collect::<Vec<_>>()
        .join(", ");

    let mut out = format!("[channel #{} \u{2014} a turn for you, {}]\n\n", channel.name, agent.name);
    out.push_str(&format!(
        "You are in the channel #{}, a room shared by {me} (the person you work for) and these agents: {members}.\n",
        channel.name
    ));
    if !channel.purpose.trim().is_empty() {
        out.push_str(&format!("What it is for: {}\n", channel.purpose.trim()));
    }
    out.push_str(&format!(
        "\nHow it works:\n\
         - This is round {round} of at most {}. Each agent answers once per round.\n\
         - Your final answer is posted in the channel for you. Do not use team_message to reply here.\n\
         - Write @Name to hand something to a member; they answer in the next round. Only do it when you need them.\n\
         - If you have nothing to add, answer exactly (pass) and nothing is posted.\n\
         - Keep it short, like a message in a team chat.\n\
         - To take work on, begin your answer with a line `[task] Title`, or call task_create. Update it with task_update when its state changes (waiting, writing, done, waiting_for_you).\n\
         - Anything that publishes, merges or spends money still asks {me} first.\n",
        channel.rounds
    ));
    if turn.routing {
        out.push_str(&format!(
            "\nYou are the lead, and this channel runs on \"the lead decides\". Read the newest message. Either answer it yourself, \
             or hand it to the members best placed to take it by writing @Name for each; they answer next. Members: {members}.\n"
        ));
    }

    out.push_str("\nRecent messages, oldest first:\n");
    let start = recent.len().saturating_sub(HISTORY);
    let mut any = false;
    for m in &recent[start..] {
        if m.kind == MessageKind::Note {
            continue;
        }
        any = true;
        let who = if m.from == agent.id { format!("{} (you)", name_of(&m.from)) } else { name_of(&m.from) };
        out.push_str(&format!("[{}] {who}: {}\n", clock(m.ts), m.text.trim()));
        for a in &m.attachments {
            out.push_str(&format!("    attached: {} ({})\n", a.name, a.path));
        }
    }
    if !any {
        out.push_str("(nothing yet)\n");
    }
    out.push_str(&format!("\n{} addressed you: \u{201c}{}\u{201d}\nAnswer for the channel.", turn.from, turn.text));
    out
}

/// Where the engine reads and writes. The app implements it over real agent
/// sessions; the tests implement it with a script.
pub trait Host: Sync {
    fn recent(&self, channel_id: &str) -> impl Future<Output = Vec<ChannelMessage>> + Send;
    /// Hands the prompt to the agent's thread for this channel and waits for
    /// what it says.
    fn ask(&self, channel: &Channel, agent: &Person, prompt: String) -> impl Future<Output = Result<String, String>> + Send;
    fn post(&self, channel: &Channel, agent: &Person, answer: Answer, round: u8) -> impl Future<Output = ()> + Send;
    fn note(&self, channel: &Channel, text: String, round: u8) -> impl Future<Output = ()> + Send;
    fn working(&self, channel_id: &str, agents: &[String], round: u8);
    fn stopped(&self, channel_id: &str) -> impl Future<Output = bool> + Send;
}

/// What a chain did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Report {
    pub rounds: u8,
    pub replies: usize,
}

async fn one_turn<H: Host>(host: &H, channel: &Channel, roster: &[Person], me: &str, turn: &Turn, round: u8) -> Option<(Person, String)> {
    let agent = roster.iter().find(|p| p.id == turn.agent)?;
    let recent = host.recent(&channel.id).await;
    let prompt = context_prompt(&PromptCtx { channel, me, roster, agent, recent: &recent, turn, round });
    match host.ask(channel, agent, prompt).await {
        Ok(text) if is_pass(&text) => None,
        Ok(text) => {
            let answer = parse_answer(&text);
            let body = answer.text.clone();
            host.post(channel, agent, answer, round).await;
            Some((agent.clone(), body))
        }
        Err(why) => {
            // A Stop interrupts the turn, which ends as an error; the reader did
            // that on purpose, so it is not a failure to write down.
            if !host.stopped(&channel.id).await {
                host.note(channel, format!("{} could not answer: {why}", agent.name), round).await;
            }
            None
        }
    }
}

/// Runs a message's rounds to the end: ask the round's agents, post what they
/// say, and take the members they `@mention` as the next round.
pub async fn run_chain<H: Host>(host: &H, channel: &Channel, roster: &[Person], me: &str, first: Plan) -> Report {
    let mut report = Report::default();
    let mut turns = first.turns;
    let mut sequential = first.sequential;
    let cap = channel.rounds.clamp(1, 3);

    for round in 1..=cap {
        if turns.is_empty() || report.replies >= MAX_REPLIES || host.stopped(&channel.id).await {
            break;
        }
        let mut seen = HashSet::new();
        turns.retain(|t| seen.insert(t.agent.clone()));
        turns.truncate(MAX_REPLIES - report.replies);

        report.rounds = round;
        host.working(&channel.id, &turns.iter().map(|t| t.agent.clone()).collect::<Vec<_>>(), round);

        let results: Vec<Option<(Person, String)>> = if sequential {
            let mut out = Vec::new();
            for turn in &turns {
                if host.stopped(&channel.id).await {
                    break;
                }
                out.push(one_turn(host, channel, roster, me, turn, round).await);
            }
            out
        } else {
            futures_util::future::join_all(turns.iter().map(|t| one_turn(host, channel, roster, me, t, round))).await
        };

        let mut next: Vec<Turn> = Vec::new();
        for (speaker, body) in results.into_iter().flatten() {
            report.replies += 1;
            for id in mentions(&body, roster) {
                if id != speaker.id && !next.iter().any(|t| t.agent == id) {
                    next.push(Turn { agent: id, from: speaker.name.clone(), text: clip(&body, 240), routing: false });
                }
            }
        }
        turns = next;
        sequential = false;
    }
    host.working(&channel.id, &[], 0);
    report
}

/// `channel:<id>:<seq>`, the reference a mention in the Inbox carries back.
pub fn mention_ref(channel_id: &str, seq: u64) -> String {
    format!("channel:{channel_id}:{seq}")
}

/// The channel and message a mention's reference names.
pub fn parse_mention_ref(reference: &str) -> Option<(String, u64)> {
    let rest = reference.strip_prefix("channel:")?;
    let (id, seq) = rest.rsplit_once(':')?;
    Some((id.to_string(), seq.parse().ok()?))
}

/// Files the Inbox mention for an agent's message that calls the reader, or
/// nothing when it does not.
pub fn file_my_mention(channel: &Channel, msg: &ChannelMessage, me: &str, session: Option<&str>) -> Option<crate::inbox::InboxItem> {
    if msg.from == "me" || msg.kind == MessageKind::Note || !mentions_me(&msg.text, me) {
        return None;
    }
    Some(crate::inbox::file_mention(&msg.from, Some(&channel.name), &msg.text, session, Some(mention_ref(&channel.id, msg.seq))))
}

// ───────────────────────── storage ─────────────────────────

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Session → (channel, agent) for every thread, kept in memory because the turn
/// hooks that read it run for every turn of every session.
static THREADS: LazyLock<Mutex<HashMap<String, (String, String)>>> = LazyLock::new(Default::default);
static APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Default, Serialize, Deserialize)]
struct ChannelsFile {
    #[serde(default)]
    channels: Vec<Channel>,
}

#[derive(Default, Serialize, Deserialize)]
struct TasksFile {
    #[serde(default)]
    tasks: Vec<Task>,
}

#[derive(Default, Serialize, Deserialize)]
struct ThreadsFile {
    #[serde(default)]
    threads: Vec<Thread>,
}

/// The channels' files and the events that follow a change. Cheap to clone.
#[derive(Clone)]
pub struct Core {
    home: Arc<PathBuf>,
    app: Option<AppHandle>,
}

impl Core {
    /// A core over `home`. With an app it emits events; without, it only stores.
    pub fn at(home: PathBuf, app: Option<AppHandle>) -> Self {
        Self { home: Arc::new(home), app }
    }

    async fn live(app: &AppHandle) -> Result<Self, String> {
        let home = get_home_app_dir().await.map_err(|e| format!("{e:#}"))?;
        Ok(Self::at(home, Some(app.clone())))
    }

    fn channels_path(&self) -> PathBuf {
        self.home.join("channels.json")
    }

    fn dir(&self, id: &str) -> PathBuf {
        self.home.join("channels").join(id)
    }

    fn emit(&self, event: &str, payload: serde_json::Value) {
        if let Some(app) = &self.app {
            app.emit(event, payload).ok();
        }
    }

    fn changed(&self, id: &str) {
        self.emit("channel_changed", json!({"channelId": id}));
    }

    async fn read_channels(&self) -> Result<Vec<Channel>> {
        Ok(read_json::<ChannelsFile>(&self.channels_path()).await?.channels)
    }

    async fn write_channels(&self, channels: &[Channel]) -> Result<()> {
        let file = ChannelsFile { channels: channels.to_vec() };
        write_atomic(&self.channels_path(), serde_json::to_string_pretty(&file)?).await
    }

    async fn read_tasks(&self, id: &str) -> Result<Vec<Task>> {
        Ok(read_json::<TasksFile>(&self.dir(id).join("tasks.json")).await?.tasks)
    }

    async fn write_tasks(&self, id: &str, tasks: &[Task]) -> Result<()> {
        tokio::fs::create_dir_all(self.dir(id)).await?;
        let file = TasksFile { tasks: tasks.to_vec() };
        write_atomic(&self.dir(id).join("tasks.json"), serde_json::to_string_pretty(&file)?).await
    }

    async fn read_threads(&self, id: &str) -> Result<Vec<Thread>> {
        Ok(read_json::<ThreadsFile>(&self.dir(id).join("threads.json")).await?.threads)
    }

    async fn write_threads(&self, id: &str, threads: &[Thread]) -> Result<()> {
        tokio::fs::create_dir_all(self.dir(id)).await?;
        let file = ThreadsFile { threads: threads.to_vec() };
        write_atomic(&self.dir(id).join("threads.json"), serde_json::to_string_pretty(&file)?).await
    }

    /// The transcript. A line that does not parse is skipped, not fatal: one bad
    /// line must not blank a room.
    pub async fn messages(&self, id: &str) -> Result<Vec<ChannelMessage>> {
        let raw = match tokio::fs::read_to_string(self.dir(id).join("messages.jsonl")).await {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        Ok(raw.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
    }

    async fn write_messages(&self, id: &str, messages: &[ChannelMessage]) -> Result<()> {
        let path = self.dir(id).join("messages.jsonl");
        let tmp = path.with_extension("jsonl.tmp");
        let mut body = String::new();
        for m in messages {
            body.push_str(&serde_json::to_string(m)?);
            body.push('\n');
        }
        tokio::fs::write(&tmp, body).await?;
        tokio::fs::rename(&tmp, &path).await?;
        Ok(())
    }

    /// Every channel, archived ones included; the page filters.
    pub async fn list(&self, workspace_id: Option<&str>) -> Result<Vec<Channel>, String> {
        let all = self.read_channels().await.map_err(|e| format!("{e:#}"))?;
        Ok(all
            .into_iter()
            .filter(|c| workspace_id.is_none() || c.workspace_id.as_deref() == workspace_id)
            .collect())
    }

    /// One channel by id.
    pub async fn channel(&self, id: &str) -> Result<Channel, String> {
        self.read_channels()
            .await
            .map_err(|e| format!("{e:#}"))?
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| "no such channel".to_string())
    }

    /// Makes a channel. Refused with a sentence the form can show: an empty or
    /// taken name, or no agent.
    pub async fn create(&self, new: NewChannel) -> Result<Channel, String> {
        let name = slug(&new.name);
        if name.is_empty() {
            return Err("A channel needs a name.".into());
        }
        let mut members: Vec<String> = Vec::new();
        for m in new.members {
            if !members.contains(&m) {
                members.push(m);
            }
        }
        if members.is_empty() {
            return Err("Pick at least one agent.".into());
        }

        let _guard = LOCK.lock().await;
        let mut all = self.read_channels().await.map_err(|e| format!("{e:#}"))?;
        if all.iter().any(|c| !c.archived && c.workspace_id == new.workspace_id && c.name == name) {
            return Err(format!("#{name} already exists."));
        }
        let lead = new.lead.filter(|l| members.contains(l)).unwrap_or_else(|| members[0].clone());
        let channel = Channel {
            id: uuid::Uuid::now_v7().to_string(),
            workspace_id: new.workspace_id,
            name,
            purpose: new.purpose.trim().to_string(),
            members,
            lead,
            mode: new.mode.unwrap_or_default(),
            rounds: new.rounds.unwrap_or(3).clamp(1, 3),
            muted: false,
            archived: false,
            created: now_ms(),
            last_seq: 0,
            last_ts: 0,
            last_agent_seq: 0,
            read_seq: 0,
        };
        all.push(channel.clone());
        self.write_channels(&all).await.map_err(|e| format!("{e:#}"))?;
        self.changed(&channel.id);
        Ok(channel)
    }

    /// Applies an edit. A lead who left the members is replaced by the first one,
    /// and the last member cannot leave.
    pub async fn update(&self, id: &str, patch: ChannelPatch) -> Result<Channel, String> {
        let _guard = LOCK.lock().await;
        let mut all = self.read_channels().await.map_err(|e| format!("{e:#}"))?;
        let at = all.iter().position(|c| c.id == id).ok_or("no such channel")?;

        if let Some(name) = &patch.name {
            let name = slug(name);
            if name.is_empty() {
                return Err("A channel needs a name.".into());
            }
            let ws = all[at].workspace_id.clone();
            if all.iter().any(|c| c.id != id && !c.archived && c.workspace_id == ws && c.name == name) {
                return Err(format!("#{name} already exists."));
            }
        }
        if let Some(members) = &patch.members {
            if members.is_empty() {
                return Err("A channel needs at least one agent.".into());
            }
        }

        let c = &mut all[at];
        if let Some(name) = patch.name {
            c.name = slug(&name);
        }
        if let Some(purpose) = patch.purpose {
            c.purpose = purpose.trim().to_string();
        }
        if let Some(members) = patch.members {
            let mut kept: Vec<String> = Vec::new();
            for m in members {
                if !kept.contains(&m) {
                    kept.push(m);
                }
            }
            c.members = kept;
        }
        if let Some(lead) = patch.lead {
            if c.members.contains(&lead) {
                c.lead = lead;
            }
        }
        if !c.members.contains(&c.lead) {
            c.lead = c.members[0].clone();
        }
        if let Some(mode) = patch.mode {
            c.mode = mode;
        }
        if let Some(rounds) = patch.rounds {
            c.rounds = rounds.clamp(1, 3);
        }
        if let Some(muted) = patch.muted {
            c.muted = muted;
        }
        let out = c.clone();
        self.write_channels(&all).await.map_err(|e| format!("{e:#}"))?;
        self.changed(id);
        Ok(out)
    }

    /// Adds or removes one member.
    pub async fn member(&self, id: &str, agent: &str, on: bool) -> Result<Channel, String> {
        let current = self.channel(id).await?;
        let mut members = current.members.clone();
        if on {
            if !members.iter().any(|m| m == agent) {
                members.push(agent.to_string());
            }
        } else {
            members.retain(|m| m != agent);
        }
        self.update(id, ChannelPatch { members: Some(members), ..Default::default() }).await
    }

    /// Archives a channel, or brings it back. An archived channel answers nothing.
    pub async fn set_archived(&self, id: &str, archived: bool) -> Result<Channel, String> {
        let _guard = LOCK.lock().await;
        let mut all = self.read_channels().await.map_err(|e| format!("{e:#}"))?;
        let at = all.iter().position(|c| c.id == id).ok_or("no such channel")?;
        if !archived {
            let (name, ws) = (all[at].name.clone(), all[at].workspace_id.clone());
            if all.iter().any(|c| c.id != id && !c.archived && c.workspace_id == ws && c.name == name) {
                return Err(format!("#{name} is taken by another channel now."));
            }
        }
        all[at].archived = archived;
        let out = all[at].clone();
        self.write_channels(&all).await.map_err(|e| format!("{e:#}"))?;
        self.changed(id);
        Ok(out)
    }

    /// Marks everything up to now as read.
    pub async fn mark_read(&self, id: &str) -> Result<(), String> {
        let _guard = LOCK.lock().await;
        let mut all = self.read_channels().await.map_err(|e| format!("{e:#}"))?;
        let Some(c) = all.iter_mut().find(|c| c.id == id) else { return Ok(()) };
        if c.read_seq == c.last_seq {
            return Ok(());
        }
        c.read_seq = c.last_seq;
        self.write_channels(&all).await.map_err(|e| format!("{e:#}"))?;
        self.changed(id);
        Ok(())
    }

    /// Removes channels and their files, for a workspace that is going.
    pub async fn drop_workspace(&self, workspace_id: &str) -> Result<()> {
        let _guard = LOCK.lock().await;
        let all = self.read_channels().await?;
        let (gone, keep): (Vec<_>, Vec<_>) =
            all.into_iter().partition(|c| c.workspace_id.as_deref() == Some(workspace_id));
        if gone.is_empty() {
            return Ok(());
        }
        self.write_channels(&keep).await?;
        for c in gone {
            let _ = tokio::fs::remove_dir_all(self.dir(&c.id)).await;
            THREADS.lock().expect("channel threads poisoned").retain(|_, (ch, _)| *ch != c.id);
        }
        Ok(())
    }

    /// Appends a line to the transcript, numbering it, and tells the page.
    pub async fn append(&self, id: &str, mut msg: ChannelMessage) -> Result<ChannelMessage, String> {
        let _guard = LOCK.lock().await;
        let mut all = self.read_channels().await.map_err(|e| format!("{e:#}"))?;
        let c = all.iter_mut().find(|c| c.id == id).ok_or("no such channel")?;
        c.last_seq += 1;
        msg.seq = c.last_seq;
        if msg.ts == 0 {
            msg.ts = now_ms();
        }
        c.last_ts = msg.ts;
        if msg.from != "me" && msg.kind == MessageKind::Message {
            c.last_agent_seq = msg.seq;
        }
        self.write_channels(&all).await.map_err(|e| format!("{e:#}"))?;

        tokio::fs::create_dir_all(self.dir(id)).await.map_err(|e| e.to_string())?;
        let mut line = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir(id).join("messages.jsonl"))
            .await
            .map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, line.as_bytes()).await.map_err(|e| e.to_string())?;
        drop(_guard);

        self.emit("channel_message", json!({"channelId": id, "message": msg}));
        Ok(msg)
    }

    /// Toggles `by`'s `emoji` on a message.
    pub async fn react(&self, id: &str, seq: u64, emoji: &str, by: &str) -> Result<(), String> {
        let _guard = LOCK.lock().await;
        let mut messages = self.messages(id).await.map_err(|e| format!("{e:#}"))?;
        let m = messages.iter_mut().find(|m| m.seq == seq).ok_or("no such message")?;
        match m.reactions.iter().position(|r| r.emoji == emoji) {
            Some(i) => {
                if m.reactions[i].by.iter().any(|b| b == by) {
                    m.reactions[i].by.retain(|b| b != by);
                } else {
                    m.reactions[i].by.push(by.to_string());
                }
                if m.reactions[i].by.is_empty() {
                    m.reactions.remove(i);
                }
            }
            None => m.reactions.push(Reaction { emoji: emoji.to_string(), by: vec![by.to_string()] }),
        }
        self.write_messages(id, &messages).await.map_err(|e| format!("{e:#}"))?;
        drop(_guard);
        self.changed(id);
        Ok(())
    }

    /// The tasks of one channel, newest last.
    pub async fn tasks(&self, id: &str) -> Result<Vec<Task>, String> {
        self.read_tasks(id).await.map_err(|e| format!("{e:#}"))
    }

    /// Records a task an agent took on. The same owner and title while it is
    /// still open is the same task.
    pub async fn create_task(&self, id: &str, owner: &str, title: &str, message_seq: Option<u64>) -> Result<Task, String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("A task needs a title.".into());
        }
        let _guard = LOCK.lock().await;
        let mut tasks = self.read_tasks(id).await.map_err(|e| format!("{e:#}"))?;
        if let Some(t) = tasks
            .iter()
            .find(|t| t.owner == owner && t.status != TaskStatus::Done && t.title.eq_ignore_ascii_case(title))
        {
            return Ok(t.clone());
        }
        let who = agents::name_of(owner).unwrap_or_else(|| "The agent".into());
        let now = now_ms();
        let task = Task {
            id: uuid::Uuid::now_v7().to_string(),
            channel_id: id.to_string(),
            title: title.to_string(),
            owner: owner.to_string(),
            status: TaskStatus::Writing,
            created: now,
            updated: now,
            message_seq,
            result: None,
            steps: vec![TaskStep { at: now, text: format!("{who} took it") }],
        };
        tasks.push(task.clone());
        self.write_tasks(id, &tasks).await.map_err(|e| format!("{e:#}"))?;
        drop(_guard);
        self.changed(id);
        Ok(task)
    }

    /// Changes a task its owner holds. `task` is its id or its title.
    pub async fn update_task(
        &self,
        id: &str,
        owner: &str,
        task: &str,
        status: Option<TaskStatus>,
        result: Option<String>,
    ) -> Result<Task, String> {
        let _guard = LOCK.lock().await;
        let mut tasks = self.read_tasks(id).await.map_err(|e| format!("{e:#}"))?;
        let want = task.trim();
        let at = tasks
            .iter()
            .position(|t| t.id == want)
            .or_else(|| tasks.iter().position(|t| t.owner == owner && t.title.eq_ignore_ascii_case(want)))
            .ok_or("no such task in this channel")?;
        if tasks[at].owner != owner {
            return Err("That task belongs to someone else.".into());
        }
        let now = now_ms();
        let t = &mut tasks[at];
        if let Some(status) = status {
            if t.status != status {
                t.status = status;
                t.steps.push(TaskStep { at: now, text: status.sentence().to_string() });
            }
        }
        if let Some(result) = result.filter(|r| !r.trim().is_empty()) {
            t.result = Some(result.trim().to_string());
        }
        t.updated = now;
        let out = t.clone();
        self.write_tasks(id, &tasks).await.map_err(|e| format!("{e:#}"))?;
        drop(_guard);
        self.changed(id);
        Ok(out)
    }

    /// Moves an agent's running tasks between *writing* and *waiting for you*
    /// while one of its approvals sits in the Inbox.
    pub async fn hold_tasks(&self, id: &str, owner: &str, waiting: bool) -> Result<(), String> {
        let (from, to) = if waiting {
            (TaskStatus::Writing, TaskStatus::WaitingForYou)
        } else {
            (TaskStatus::WaitingForYou, TaskStatus::Writing)
        };
        let _guard = LOCK.lock().await;
        let mut tasks = self.read_tasks(id).await.map_err(|e| format!("{e:#}"))?;
        let now = now_ms();
        let mut moved = false;
        for t in tasks.iter_mut().filter(|t| t.owner == owner && t.status == from) {
            t.status = to;
            t.updated = now;
            t.steps.push(TaskStep { at: now, text: to.sentence().to_string() });
            moved = true;
        }
        if moved {
            self.write_tasks(id, &tasks).await.map_err(|e| format!("{e:#}"))?;
            drop(_guard);
            self.changed(id);
        }
        Ok(())
    }

    /// The thread this agent answers this channel in, made on first ask. The
    /// second answer says whether it existed before.
    pub async fn thread_session(&self, id: &str, agent: &str) -> Result<(String, bool), String> {
        let _guard = LOCK.lock().await;
        let mut threads = self.read_threads(id).await.map_err(|e| format!("{e:#}"))?;
        if let Some(t) = threads.iter().find(|t| t.agent_id == agent) {
            THREADS
                .lock()
                .expect("channel threads poisoned")
                .insert(t.session_id.clone(), (id.to_string(), agent.to_string()));
            return Ok((t.session_id.clone(), true));
        }
        let session_id = uuid::Uuid::now_v7().to_string();
        threads.push(Thread { agent_id: agent.to_string(), session_id: session_id.clone() });
        self.write_threads(id, &threads).await.map_err(|e| format!("{e:#}"))?;
        THREADS
            .lock()
            .expect("channel threads poisoned")
            .insert(session_id.clone(), (id.to_string(), agent.to_string()));
        Ok((session_id, false))
    }

    /// Everything the page draws for one channel.
    pub async fn detail(&self, id: &str) -> Result<ChannelDetail, String> {
        let channel = self.channel(id).await?;
        let messages = self.messages(id).await.map_err(|e| format!("{e:#}"))?;
        let tasks = self.tasks(id).await?;
        let threads = self.read_threads(id).await.map_err(|e| format!("{e:#}"))?;
        let working = WORKING.lock().expect("channel working poisoned").get(id).cloned().unwrap_or_default();
        Ok(ChannelDetail { channel, messages, tasks, threads, working })
    }

    /// The transcript as Markdown, for Export.
    pub async fn export(&self, id: &str, me: &str) -> Result<String, String> {
        let detail = self.detail(id).await?;
        let name = |from: &str| -> String {
            if from == "me" {
                me.to_string()
            } else {
                agents::name_of(from).unwrap_or_else(|| "Agent".into())
            }
        };
        let mut out = format!("# #{}\n\n", detail.channel.name);
        if !detail.channel.purpose.is_empty() {
            out.push_str(&format!("{}\n\n", detail.channel.purpose));
        }
        let members: Vec<String> = detail.channel.members.iter().map(|m| name(m)).collect();
        out.push_str(&format!("Members: {me}, {}\n\n", members.join(", ")));
        let mut round = 0;
        for m in &detail.messages {
            if m.round != 0 && m.round != round {
                out.push_str(&format!("---\n\n_Round {} of {}_\n\n", m.round, detail.channel.rounds));
            }
            round = m.round;
            let who = if m.kind == MessageKind::Note { "hz".to_string() } else { name(&m.from) };
            out.push_str(&format!("**{who}** \u{00b7} {}\n\n{}\n\n", clock(m.ts), m.text.trim()));
        }
        if !detail.tasks.is_empty() {
            out.push_str("## Tasks\n\n");
            for t in &detail.tasks {
                out.push_str(&format!("- {} \u{2014} {} ({})\n", t.title, name(&t.owner), t.status.sentence()));
            }
        }
        Ok(out)
    }
}

// ───────────────────────── the app host ─────────────────────────

static WORKING: LazyLock<Mutex<HashMap<String, Working>>> = LazyLock::new(Default::default);
/// Who each running chain is waiting on, per channel. Chains are kept apart
/// because two messages in one room run two at once, and the first to finish
/// used to clear the typing line out from under the other.
static CHAINS: LazyLock<Mutex<HashMap<String, HashMap<u64, Working>>>> = LazyLock::new(Default::default);
static NEXT_CHAIN: AtomicU64 = AtomicU64::new(1);
static STOPPED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
type Gate = Arc<tokio::sync::Mutex<()>>;
static GATES: LazyLock<Mutex<HashMap<(String, String), Gate>>> = LazyLock::new(Default::default);

struct Pending {
    prompt: String,
    started: bool,
    tx: Option<oneshot::Sender<Result<String, String>>>,
}

static PENDING: LazyLock<Mutex<HashMap<String, Pending>>> = LazyLock::new(Default::default);

/// Called with every message a session logs: an ask queued behind a turn learns
/// when its own prompt becomes the next one.
pub fn observe_user(session_id: &str, text: &str) {
    if let Some(p) = PENDING.lock().expect("channel pending poisoned").get_mut(session_id) {
        if !p.started && text.contains(&p.prompt) {
            p.started = true;
        }
    }
}

/// Called when a session's turn closes. Answers the ask the turn carried, and
/// says whether this session is a channel thread at all — its turns are the
/// channel's errands, not news for the Inbox.
pub fn observe_completed(session_id: &str, status: &TurnStatus, final_text: Option<&str>) -> bool {
    let is_thread = THREADS.lock().expect("channel threads poisoned").contains_key(session_id);
    let mut pending = PENDING.lock().expect("channel pending poisoned");
    if pending.get(session_id).is_some_and(|p| p.started) {
        if let Some(mut p) = pending.remove(session_id) {
            if let Some(tx) = p.tx.take() {
                let _ = tx.send(match status {
                    TurnStatus::Success => Ok(final_text.unwrap_or_default().trim().to_string()),
                    TurnStatus::Error => Err("it stopped before answering".to_string()),
                });
            }
        }
    }
    is_thread
}

/// An approval for a channel thread's agent was raised (`waiting`) or settled:
/// the agent's running tasks there say who the work waits on.
pub fn note_waiting(app: &AppHandle, session_id: &str, waiting: bool) {
    let Some((channel, agent)) = THREADS.lock().expect("channel threads poisoned").get(session_id).cloned() else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(core) = Core::live(&app).await {
            let _ = core.hold_tasks(&channel, &agent, waiting).await;
        }
    });
}

/// Notes what chain `chain` is waiting on in `channel` and returns what the room
/// as a whole is waiting on: every chain's agents, each once, at the furthest
/// round. An empty `agents` retires the chain.
fn record_working(
    by_chain: &mut HashMap<String, HashMap<u64, Working>>,
    channel: &str,
    chain: u64,
    agents: &[String],
    round: u8,
) -> Working {
    let chains = by_chain.entry(channel.to_string()).or_default();
    if agents.is_empty() {
        chains.remove(&chain);
    } else {
        chains.insert(chain, Working { agents: agents.to_vec(), round });
    }
    let mut ids: Vec<&u64> = chains.keys().collect();
    ids.sort();
    let mut merged = Working::default();
    for id in ids {
        let w = &chains[id];
        for a in &w.agents {
            if !merged.agents.contains(a) {
                merged.agents.push(a.clone());
            }
        }
        merged.round = merged.round.max(w.round);
    }
    if chains.is_empty() {
        by_chain.remove(channel);
    }
    merged
}

/// Fails the ask waiting on `session_id`, so a Stop frees the room at once
/// instead of after the turn's timeout when the interrupted turn never closes.
fn settle_stopped(session_id: &str) {
    let pending = PENDING.lock().expect("channel pending poisoned").remove(session_id);
    if let Some(tx) = pending.and_then(|mut p| p.tx.take()) {
        let _ = tx.send(Err("stopped".to_string()));
    }
}

/// The agent's identity, for the first prompt of a thread: a CLI with no system
/// prompt reads the channel brief and nothing else of who it is.
fn identity(agent: &agents::AgentRecord) -> String {
    let mut out = format!("You are {}", agent.name);
    if !agent.role.is_empty() {
        out.push_str(&format!(", {}", agent.role.trim_end_matches('.')));
    }
    out.push_str(". ");
    if !agent.instructions.trim().is_empty() && !agent.harness.starts_with("claude") {
        out.push_str(&format!("\n\n{}\n\n", agent.instructions.trim()));
    }
    out
}

struct AppHost {
    core: Core,
    app: AppHandle,
    me: String,
    /// This host runs one chain; see [`CHAINS`].
    chain: u64,
}

impl AppHost {
    /// A second handle on the same chain: the state it touches is all in statics.
    fn clone_handle(&self) -> Self {
        Self { core: self.core.clone(), app: self.app.clone(), me: self.me.clone(), chain: self.chain }
    }

    async fn new(app: &AppHandle) -> Result<Self, String> {
        let me = crate::settings::read().await.me.name;
        Ok(Self { core: Core::live(app).await?, app: app.clone(), me, chain: NEXT_CHAIN.fetch_add(1, Ordering::Relaxed) })
    }

    fn gate(channel: &str, agent: &str) -> Gate {
        GATES
            .lock()
            .expect("channel gates poisoned")
            .entry((channel.to_string(), agent.to_string()))
            .or_default()
            .clone()
    }

    async fn thread_ask(&self, channel: &Channel, agent: &Person, prompt: String) -> Result<String, String> {
        // One turn at a time per thread, so a queued prompt is never merged into
        // the one in flight and an answer is never matched to the wrong ask.
        let gate = Self::gate(&channel.id, &agent.id);
        let _turn = gate.lock().await;

        let record = agents::by_id(&agent.id).ok_or("it is no longer on the roster")?;
        let (session_id, existed) = self.core.thread_session(&channel.id, &agent.id).await?;
        let existing = if existed { crate::orchestration::resolved_session(Some(&session_id)).await } else { None };

        let (tx, rx) = oneshot::channel();
        let register = |prompt: &str, started: bool| {
            PENDING
                .lock()
                .expect("channel pending poisoned")
                .insert(session_id.clone(), Pending { prompt: prompt.to_string(), started, tx: Some(tx) });
        };

        match existing {
            Some(item) => {
                agents::bind(&session_id, &agent.id);
                register(&prompt, false);
                if let Err(e) = crate::orchestration::deliver(&item, None, &prompt, &self.app).await {
                    PENDING.lock().expect("channel pending poisoned").remove(&session_id);
                    return Err(format!("{e:#}"));
                }
            }
            None => {
                let first = format!("{}{prompt}", identity(&record));
                // Its first turn is the answer, so it is started already.
                register(&first, true);
                if let Err(e) = crate::orchestration::start_thread_session(&record, &session_id, &first, &self.app).await {
                    PENDING.lock().expect("channel pending poisoned").remove(&session_id);
                    return Err(format!("{e:#}"));
                }
            }
        }

        match tokio::time::timeout(TURN_TIMEOUT, rx).await {
            Ok(Ok(answer)) => answer,
            Ok(Err(_)) => Err("the answer was lost".into()),
            Err(_) => {
                PENDING.lock().expect("channel pending poisoned").remove(&session_id);
                Err(format!("no answer in {} minutes", TURN_TIMEOUT.as_secs() / 60))
            }
        }
    }
}

impl Host for AppHost {
    async fn recent(&self, channel_id: &str) -> Vec<ChannelMessage> {
        self.core.messages(channel_id).await.unwrap_or_default()
    }

    async fn ask(&self, channel: &Channel, agent: &Person, prompt: String) -> Result<String, String> {
        self.thread_ask(channel, agent, prompt).await
    }

    async fn post(&self, channel: &Channel, agent: &Person, answer: Answer, round: u8) {
        let mut task_id = None;
        if let Some(title) = &answer.task {
            if let Ok(task) = self.core.create_task(&channel.id, &agent.id, title, None).await {
                task_id = Some(task.id);
            }
        }
        let msg = ChannelMessage {
            seq: 0,
            ts: 0,
            from: agent.id.clone(),
            text: answer.text,
            reply_to: None,
            reactions: Vec::new(),
            round,
            task_id: task_id.clone(),
            kind: MessageKind::Message,
            attachments: Vec::new(),
        };
        let Ok(msg) = self.core.append(&channel.id, msg).await else { return };

        if let (Some(task), Ok(tasks)) = (task_id, self.core.read_tasks(&channel.id).await) {
            let mut tasks = tasks;
            if let Some(t) = tasks.iter_mut().find(|t| t.id == task && t.message_seq.is_none()) {
                t.message_seq = Some(msg.seq);
                let _ = self.core.write_tasks(&channel.id, &tasks).await;
            }
        }

        let session = self.core.read_threads(&channel.id).await.ok().and_then(|t| {
            t.into_iter().find(|t| t.agent_id == agent.id).map(|t| t.session_id)
        });
        if let Some(item) = file_my_mention(channel, &msg, &self.me, session.as_deref()) {
            crate::inbox::announce_mention(&self.app, &item);
        }
    }

    async fn note(&self, channel: &Channel, text: String, round: u8) {
        let msg = ChannelMessage {
            seq: 0,
            ts: 0,
            from: "hz".into(),
            text,
            reply_to: None,
            reactions: Vec::new(),
            round,
            task_id: None,
            kind: MessageKind::Note,
            attachments: Vec::new(),
        };
        let _ = self.core.append(&channel.id, msg).await;
    }

    fn working(&self, channel_id: &str, agents: &[String], round: u8) {
        let state = record_working(&mut CHAINS.lock().expect("channel chains poisoned"), channel_id, self.chain, agents, round);
        {
            let mut map = WORKING.lock().expect("channel working poisoned");
            if state.agents.is_empty() {
                map.remove(channel_id);
            } else {
                map.insert(channel_id.to_string(), state.clone());
            }
        }
        self.core.emit("channel_working", json!({"channelId": channel_id, "agents": state.agents, "round": state.round}));
    }

    async fn stopped(&self, channel_id: &str) -> bool {
        if STOPPED.lock().expect("channel stops poisoned").contains(channel_id) {
            return true;
        }
        self.core.channel(channel_id).await.map(|c| c.archived).unwrap_or(true)
    }
}

/// The members of a channel as people, skipping any the roster no longer holds.
/// Members sharing a name are numbered, as the sidebar does, so `@Atlas (2)`
/// reaches the second one and the lead's `@Atlas` is never read as itself.
fn roster_of(channel: &Channel) -> Vec<Person> {
    let mut people: Vec<Person> = channel
        .members
        .iter()
        .filter_map(|id| agents::by_id(id))
        .map(|a| Person { id: a.id, name: a.name, role: a.role })
        .collect();
    number_twins(&mut people);
    people
}

/// Gives people who share a name ` (1)`, ` (2)`… in the order given.
fn number_twins(people: &mut [Person]) {
    let counts: HashMap<String, usize> = people.iter().fold(HashMap::new(), |mut m, p| {
        *m.entry(p.name.clone()).or_default() += 1;
        m
    });
    let mut seen: HashMap<String, usize> = HashMap::new();
    for p in people.iter_mut().filter(|p| counts[&p.name] > 1) {
        let n = seen.entry(p.name.clone()).or_default();
        *n += 1;
        p.name = format!("{} ({n})", p.name);
    }
}

/// Posts the reader's words and starts the round they call for.
///
/// Public because the Inbox answers a channel mention through it: a reply there
/// is a message in the channel like any other.
pub async fn post_as_me(
    app: &AppHandle,
    channel_id: &str,
    text: &str,
    reply_to: Option<u64>,
    attachments: Vec<String>,
) -> Result<ChannelMessage, String> {
    let text = text.trim();
    if text.is_empty() && attachments.is_empty() {
        return Err("A message needs some words.".into());
    }
    let core = Core::live(app).await?;
    let channel = core.channel(channel_id).await?;
    if channel.archived {
        return Err("This channel is archived. Bring it back to write in it.".into());
    }
    let msg = core
        .append(
            channel_id,
            ChannelMessage {
                seq: 0,
                ts: 0,
                from: "me".into(),
                text: text.to_string(),
                reply_to,
                reactions: Vec::new(),
                round: 0,
                task_id: None,
                kind: MessageKind::Message,
                attachments: attachments
                    .iter()
                    .map(|p| ChannelAttachment {
                        path: p.clone(),
                        name: Path::new(p).file_name().map_or_else(|| p.clone(), |n| n.to_string_lossy().into_owned()),
                    })
                    .collect(),
            },
        )
        .await?;
    core.mark_read(channel_id).await.ok();
    begin_round(app, &core, channel, &msg).await?;
    Ok(msg)
}

/// Starts the round the reader's message `msg` calls for, off the message as it
/// stands in the transcript so a retry and a first post plan identically.
async fn begin_round(app: &AppHandle, core: &Core, channel: Channel, msg: &ChannelMessage) -> Result<(), String> {
    let existing = core.messages(&channel.id).await.map_err(|e| format!("{e:#}"))?;
    let quoted = msg.reply_to.and_then(|seq| existing.iter().find(|m| m.seq == seq));
    let tasks = core.tasks(&channel.id).await?;

    let reply_task_owner = quoted
        .and_then(|m| m.task_id.as_ref())
        .and_then(|tid| tasks.iter().find(|t| &t.id == tid))
        .map(|t| t.owner.clone());
    let reply_author = quoted.filter(|m| m.from != "me" && m.kind == MessageKind::Message).map(|m| m.from.clone());
    let open_owners: Vec<String> = tasks
        .iter()
        .filter(|t| t.status != TaskStatus::Done && channel.members.contains(&t.owner))
        .map(|t| t.owner.clone())
        .collect();

    STOPPED.lock().expect("channel stops poisoned").remove(&channel.id);
    let host = AppHost::new(app).await?;
    let roster = roster_of(&channel);
    let plan = plan_user(
        &channel,
        &roster,
        &Incoming {
            text: &msg.text,
            from_name: &host.me,
            reply_author: reply_author.as_deref(),
            reply_task_owner: reply_task_owner.as_deref(),
        },
        &open_owners,
    );
    if plan.turns.is_empty() {
        return Ok(());
    }
    spawn_chain(host, channel, roster, plan);
    Ok(())
}

/// Runs a chain on its own task and clears the room's "answering" line even if
/// that task dies, so a panic never leaves the indicator on for good.
fn spawn_chain(host: AppHost, channel: Channel, roster: Vec<Person>, plan: Plan) {
    tauri::async_runtime::spawn(async move {
        let me = host.me.clone();
        let (chain_host, chain_channel, chain_roster) = (host.clone_handle(), channel.clone(), roster.clone());
        let run = tauri::async_runtime::spawn(async move {
            run_chain(&chain_host, &chain_channel, &chain_roster, &me, plan).await;
        });
        if run.await.is_err() {
            host.working(&channel.id, &[], 0);
            host.note(&channel, "The agents stopped unexpectedly. Try again.".into(), 0).await;
        }
    });
}

/// Runs the reader's last message again, for the Retry on an agent's failure.
/// Posts nothing: the message is already in the transcript.
pub async fn retry_last(app: &AppHandle, channel_id: &str) -> Result<(), String> {
    let core = Core::live(app).await?;
    let channel = core.channel(channel_id).await?;
    if channel.archived {
        return Err("This channel is archived. Bring it back to write in it.".into());
    }
    let last = core
        .messages(channel_id)
        .await
        .map_err(|e| format!("{e:#}"))?
        .into_iter()
        .rev()
        .find(|m| m.from == "me" && m.kind == MessageKind::Message)
        .ok_or("There is nothing to retry.")?;
    begin_round(app, &core, channel, &last).await
}

/// Posts a finished routine's result into a channel as the agent that made it.
/// An `@member` in it starts a round, like anything an agent says there.
pub async fn post_as_agent(app: &AppHandle, channel_id: &str, agent_id: &str, text: &str) -> Result<(), String> {
    let core = Core::live(app).await?;
    let channel = core.channel(channel_id).await?;
    if channel.archived {
        return Err("The channel is archived.".into());
    }
    let agent = agents::by_id(agent_id).ok_or("The agent is gone.")?;
    let me = crate::settings::read().await.me.name;
    let msg = core
        .append(
            channel_id,
            ChannelMessage {
                seq: 0,
                ts: 0,
                from: agent.id.clone(),
                text: text.trim().to_string(),
                reply_to: None,
                reactions: Vec::new(),
                round: 0,
                task_id: None,
                kind: MessageKind::Message,
                attachments: Vec::new(),
            },
        )
        .await?;
    if let Some(item) = file_my_mention(&channel, &msg, &me, None) {
        crate::inbox::announce_mention(app, &item);
    }

    let roster = roster_of(&channel);
    let turns: Vec<Turn> = mentions(&msg.text, &roster)
        .into_iter()
        .filter(|id| *id != agent.id)
        .map(|id| Turn { agent: id, from: agent.name.clone(), text: clip(&msg.text, 240), routing: false })
        .collect();
    if !turns.is_empty() {
        let host = AppHost::new(app).await?;
        tauri::async_runtime::spawn(async move {
            run_chain(&host, &channel, &roster, &me, Plan { turns, sequential: false }).await;
        });
    }
    Ok(())
}

/// Reads every channel's threads into memory, so the turn hooks know which
/// sessions are channel threads from the first turn after a restart.
pub async fn load(app: AppHandle) {
    let _ = APP.set(app.clone());
    let Ok(core) = Core::live(&app).await else { return };
    let Ok(all) = core.read_channels().await else { return };
    for c in all {
        for t in core.read_threads(&c.id).await.unwrap_or_default() {
            THREADS
                .lock()
                .expect("channel threads poisoned")
                .insert(t.session_id, (c.id.clone(), t.agent_id));
        }
    }
}

/// Removes the channels of a workspace being deleted.
pub async fn drop_workspace(app: &AppHandle, workspace_id: &str) {
    if let Ok(core) = Core::live(app).await {
        let _ = core.drop_workspace(workspace_id).await;
    }
}

// ───────────────────────── commands ─────────────────────────

/// The channels of a workspace (archived ones included), or all of them.
#[tauri::command]
pub async fn channels_list(app: AppHandle, workspace_id: Option<String>) -> Result<Vec<Channel>, String> {
    Core::live(&app).await?.list(workspace_id.as_deref()).await
}

/// Makes a channel in the workspace. Its members must be on the roster.
#[tauri::command]
pub async fn channel_create(app: AppHandle, new: NewChannel) -> Result<Channel, String> {
    if let Some(missing) = new.members.iter().find(|m| agents::by_id(m).is_none()) {
        return Err(format!("{missing} is not on the roster."));
    }
    Core::live(&app).await?.create(new).await
}

/// Edits a channel: name, purpose, members, lead, mode, rounds, mute.
#[tauri::command]
pub async fn channel_update(app: AppHandle, id: String, patch: ChannelPatch) -> Result<Channel, String> {
    Core::live(&app).await?.update(&id, patch).await
}

/// Archives a channel, or restores it.
#[tauri::command]
pub async fn channel_archive(app: AppHandle, id: String, archived: bool) -> Result<Channel, String> {
    let core = Core::live(&app).await?;
    let out = core.set_archived(&id, archived).await?;
    if archived {
        STOPPED.lock().expect("channel stops poisoned").insert(id);
    }
    Ok(out)
}

/// Adds an agent to a channel or takes it out.
#[tauri::command]
pub async fn channel_member(app: AppHandle, id: String, agent_id: String, member: bool) -> Result<Channel, String> {
    if member && agents::by_id(&agent_id).is_none() {
        return Err("That agent is not on the roster.".into());
    }
    Core::live(&app).await?.member(&id, &agent_id, member).await
}

/// One channel with its transcript, tasks, threads and who is answering.
#[tauri::command]
pub async fn channel_get(app: AppHandle, id: String) -> Result<ChannelDetail, String> {
    Core::live(&app).await?.detail(&id).await
}

/// Posts the reader's message and starts the round it calls for.
#[tauri::command]
pub async fn channel_post(
    app: AppHandle,
    id: String,
    text: String,
    reply_to: Option<u64>,
    attachments: Option<Vec<String>>,
) -> Result<ChannelMessage, String> {
    post_as_me(&app, &id, &text, reply_to, attachments.unwrap_or_default()).await
}

/// Toggles the reader's reaction on a message.
#[tauri::command]
pub async fn channel_react(app: AppHandle, id: String, seq: u64, emoji: String) -> Result<(), String> {
    Core::live(&app).await?.react(&id, seq, &emoji, "me").await
}

/// Marks the channel read up to its newest message.
#[tauri::command]
pub async fn channel_read(app: AppHandle, id: String) -> Result<(), String> {
    Core::live(&app).await?.mark_read(&id).await
}

/// The tasks of a channel.
#[tauri::command]
pub async fn channel_tasks(app: AppHandle, id: String) -> Result<Vec<Task>, String> {
    Core::live(&app).await?.tasks(&id).await
}

/// One task of a channel.
#[tauri::command]
pub async fn channel_task(app: AppHandle, id: String, task_id: String) -> Result<Task, String> {
    Core::live(&app)
        .await?
        .tasks(&id)
        .await?
        .into_iter()
        .find(|t| t.id == task_id)
        .ok_or_else(|| "no such task".to_string())
}

/// Runs the reader's last message again after an agent failed to answer it.
#[tauri::command]
pub async fn channel_retry(app: AppHandle, id: String) -> Result<(), String> {
    retry_last(&app, &id).await
}

/// Stops the rounds running in a channel and interrupts the turns in flight.
#[tauri::command]
pub async fn channel_stop(app: AppHandle, id: String) -> Result<(), String> {
    STOPPED.lock().expect("channel stops poisoned").insert(id.clone());
    let core = Core::live(&app).await?;
    let working = WORKING.lock().expect("channel working poisoned").get(&id).cloned().unwrap_or_default();
    let threads = core.read_threads(&id).await.map_err(|e| format!("{e:#}"))?;
    let manager = app.state::<crate::session::SessionManager>();
    for t in threads.iter().filter(|t| working.agents.contains(&t.agent_id)) {
        settle_stopped(&t.session_id);
        let _ = manager.interrupt(&t.session_id, &app).await;
    }
    Ok(())
}

/// The transcript as Markdown.
#[tauri::command]
pub async fn channel_export(app: AppHandle, id: String) -> Result<String, String> {
    let me = crate::settings::read().await.me.name;
    Core::live(&app).await?.export(&id, &me).await
}

// ───────────────────────── team tools ─────────────────────────

/// `task_create`: the caller takes on a task in a channel it belongs to.
pub async fn tool_task_create(app: &AppHandle, agent_id: &str, channel: &str, title: &str) -> Result<String> {
    let (core, channel) = member_channel(app, agent_id, channel).await?;
    let task = core.create_task(&channel.id, agent_id, title, None).await.map_err(anyhow::Error::msg)?;
    Ok(format!("Task \"{}\" is yours in #{} ({}).", task.title, channel.name, task.status.sentence().to_lowercase()))
}

/// `task_update`: the caller changes a task of its own.
pub async fn tool_task_update(
    app: &AppHandle,
    agent_id: &str,
    channel: &str,
    task: &str,
    status: Option<&str>,
    result: Option<&str>,
) -> Result<String> {
    let (core, channel) = member_channel(app, agent_id, channel).await?;
    let status = match status.filter(|s| !s.trim().is_empty()) {
        Some(word) => Some(TaskStatus::parse(word).context("status is one of waiting, writing, done, waiting_for_you")?),
        None => None,
    };
    let t = core
        .update_task(&channel.id, agent_id, task, status, result.map(str::to_string))
        .await
        .map_err(anyhow::Error::msg)?;
    Ok(format!("Task \"{}\" is {} in #{}.", t.title, t.status.sentence().to_lowercase(), channel.name))
}

async fn member_channel(app: &AppHandle, agent_id: &str, name: &str) -> Result<(Core, Channel)> {
    let core = Core::live(app).await.map_err(anyhow::Error::msg)?;
    let me = agents::by_id(agent_id).context("you are not a known agent")?;
    let want = slug(name.trim_start_matches('#'));
    let channel = core
        .list(None)
        .await
        .map_err(anyhow::Error::msg)?
        .into_iter()
        .find(|c| !c.archived && c.name == want && c.workspace_id == me.workspace_id && c.members.iter().any(|m| m == agent_id))
        .with_context(|| format!("you are in no channel called #{want}"))?;
    Ok((core, channel))
}


#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;

    fn person(id: &str, name: &str) -> Person {
        Person { id: id.into(), name: name.into(), role: "Role".into() }
    }

    fn roster() -> Vec<Person> {
        vec![person("a", "Atlas"), person("m", "Mila"), person("l", "Leo")]
    }

    fn channel(mode: Mode, rounds: u8) -> Channel {
        Channel {
            id: "c1".into(),
            workspace_id: Some("w".into()),
            name: "launch".into(),
            purpose: "Ship the Pro plan.".into(),
            members: vec!["a".into(), "m".into(), "l".into()],
            lead: "a".into(),
            mode,
            rounds,
            muted: false,
            archived: false,
            created: 0,
            last_seq: 0,
            last_ts: 0,
            last_agent_seq: 0,
            read_seq: 0,
        }
    }

    fn incoming(text: &str) -> Incoming<'_> {
        Incoming { text, from_name: "Gabriel", reply_author: None, reply_task_owner: None }
    }

    fn ids(plan: &Plan) -> Vec<&str> {
        plan.turns.iter().map(|t| t.agent.as_str()).collect()
    }

    #[test]
    fn at_names_pick_members_in_order_and_ignore_code_and_addresses() {
        let r = roster();
        assert_eq!(mentions("@mila and @LEO please", &r), ["m", "l"]);
        assert_eq!(mentions("@Leo @leo @Leo", &r), ["l"], "once each");
        assert_eq!(mentions("@Milan is not Mila", &r), Vec::<String>::new(), "a longer word is not the name");
        assert_eq!(mentions("write to mila@example.com", &r), Vec::<String>::new());
        assert_eq!(mentions("run `echo @Leo` now\n```\n@Atlas\n```\n", &r), Vec::<String>::new());
        assert_eq!(mentions("@all check this", &r), ["a", "m", "l"]);
        assert_eq!(mentions("hey @Mila, @Leo.", &r), ["m", "l"], "punctuation ends a name");
    }

    #[test]
    fn a_longer_name_beats_its_prefix() {
        let r = vec![person("1", "Mila"), person("2", "Mila Costa")];
        assert_eq!(mentions("@Mila Costa knows", &r), ["2"]);
        assert_eq!(mentions("@Mila knows", &r), ["1"]);
    }

    #[test]
    fn the_reader_is_called_by_at_their_name() {
        assert!(mentions_me("@Gabriel o título ficou bom?", "Gabriel"));
        assert!(mentions_me("olá @gabriel!", "Gabriel"));
        assert!(!mentions_me("@Gabrielle", "Gabriel"));
        assert!(!mentions_me("`@Gabriel`", "Gabriel"));
        assert!(!mentions_me("@x", "x"), "a one-letter name is not a handle");
    }

    #[test]
    fn a_named_recipient_wins_over_everything() {
        let mut inc = incoming("@Leo write the post");
        inc.reply_author = Some("m");
        inc.reply_task_owner = Some("m");
        let plan = plan_user(&channel(Mode::Turns, 3), &roster(), &inc, &["m".into()]);
        assert_eq!(ids(&plan), ["l"]);
        assert!(!plan.sequential);
    }

    #[test]
    fn a_name_outside_the_channel_names_nobody() {
        let r = vec![person("a", "Atlas")];
        let mut ch = channel(Mode::Mention, 3);
        ch.members = vec!["a".into()];
        let plan = plan_user(&ch, &r, &incoming("@Leo hello"), &[]);
        assert_eq!(ids(&plan), ["a"], "the lead answers instead");
    }

    #[test]
    fn a_reply_goes_to_the_task_owner_then_to_the_author() {
        let mut inc = incoming("and the numbers?");
        inc.reply_author = Some("l");
        inc.reply_task_owner = Some("m");
        let ch = channel(Mode::Turns, 3);
        assert_eq!(ids(&plan_user(&ch, &roster(), &inc, &[])), ["m"]);

        inc.reply_task_owner = None;
        assert_eq!(ids(&plan_user(&ch, &roster(), &inc, &[])), ["l"]);
    }

    #[test]
    fn modes_decide_the_rest() {
        let r = roster();
        let mention = plan_user(&channel(Mode::Mention, 3), &r, &incoming("status?"), &[]);
        assert_eq!(ids(&mention), ["a"], "the lead answers");

        let sole = plan_user(&channel(Mode::Mention, 3), &r, &incoming("status?"), &["m".into(), "m".into()]);
        assert_eq!(ids(&sole), ["m"], "the owner of the one open task answers");

        let two = plan_user(&channel(Mode::Mention, 3), &r, &incoming("status?"), &["m".into(), "l".into()]);
        assert_eq!(ids(&two), ["a"], "two open tasks have no one owner");

        let turns = plan_user(&channel(Mode::Turns, 3), &r, &incoming("status?"), &["m".into()]);
        assert_eq!(ids(&turns), ["a", "m", "l"]);
        assert!(turns.sequential);

        let lead = plan_user(&channel(Mode::Lead, 3), &r, &incoming("status?"), &[]);
        assert_eq!(ids(&lead), ["a"]);
        assert!(lead.turns[0].routing, "the lead is told it is the router");
    }

    #[test]
    fn a_lead_who_left_is_replaced_by_the_first_member() {
        let mut ch = channel(Mode::Mention, 3);
        ch.lead = "gone".into();
        assert_eq!(ids(&plan_user(&ch, &roster(), &incoming("hi"), &[])), ["a"]);
    }

    #[test]
    fn a_task_marker_on_the_first_line_makes_a_task() {
        let a = parse_answer("[task] Launch thread for X\nDraft in 20 minutes.");
        assert_eq!(a.task.as_deref(), Some("Launch thread for X"));
        assert_eq!(a.text, "Draft in 20 minutes.");

        let only = parse_answer("[Task] Blog post");
        assert_eq!(only.text, "Blog post");

        let plain = parse_answer("  nothing special [task] here ");
        assert_eq!(plain, Answer { text: "nothing special [task] here".into(), task: None });
        assert!(is_pass(" (pass) "));
        assert!(is_pass(""));
        assert!(!is_pass("pass the salt"));
    }

    #[test]
    fn the_prompt_carries_the_room_the_rules_and_who_asked() {
        let ch = channel(Mode::Lead, 3);
        let r = roster();
        let recent = vec![ChannelMessage {
            seq: 1,
            ts: 0,
            from: "me".into(),
            text: "ship it".into(),
            reply_to: None,
            reactions: vec![],
            round: 0,
            task_id: None,
            kind: MessageKind::Message,
            attachments: vec![ChannelAttachment { path: "/tmp/plan.md".into(), name: "plan.md".into() }],
        }];
        let turn = Turn { agent: "a".into(), from: "Gabriel".into(), text: "ship it".into(), routing: true };
        let text = context_prompt(&PromptCtx { channel: &ch, me: "Gabriel", roster: &r, agent: &r[0], recent: &recent, turn: &turn, round: 1 });
        for needle in ["#launch", "Ship the Pro plan.", "Atlas (Role) [lead]", "round 1 of at most 3", "(pass)", "[task] Title", "Gabriel: ship it", "/tmp/plan.md", "the lead decides", "Gabriel addressed you"] {
            assert!(text.contains(needle), "missing {needle:?} in\n{text}");
        }
        let plain = Turn { routing: false, ..turn };
        let text = context_prompt(&PromptCtx { channel: &ch, me: "Gabriel", roster: &r, agent: &r[1], recent: &[], turn: &plain, round: 2 });
        assert!(!text.contains("the lead decides") && text.contains("(nothing yet)"));
    }

    #[derive(Default)]
    struct Script {
        answers: Mutex<HashMap<String, VecDeque<Result<String, String>>>>,
        asked: Mutex<Vec<(String, String)>>,
        posted: Mutex<Vec<(String, String, u8)>>,
        notes: Mutex<Vec<String>>,
        /// Set when the reader stops the room: any failure after it is theirs.
        halt_on_err: std::sync::atomic::AtomicBool,
        halted: std::sync::atomic::AtomicBool,
    }

    impl Script {
        fn halting(self) -> Self {
            self.halt_on_err.store(true, std::sync::atomic::Ordering::SeqCst);
            self
        }
        fn says(self, agent: &str, text: &str) -> Self {
            self.answers.lock().unwrap().entry(agent.into()).or_default().push_back(Ok(text.into()));
            self
        }
        fn fails(self, agent: &str, why: &str) -> Self {
            self.answers.lock().unwrap().entry(agent.into()).or_default().push_back(Err(why.into()));
            self
        }
        fn asked(&self) -> Vec<String> {
            self.asked.lock().unwrap().iter().map(|(a, _)| a.clone()).collect()
        }
        fn posted(&self) -> Vec<(String, u8)> {
            self.posted.lock().unwrap().iter().map(|(a, _, r)| (a.clone(), *r)).collect()
        }
    }

    impl Host for Script {
        async fn recent(&self, _: &str) -> Vec<ChannelMessage> {
            Vec::new()
        }
        async fn ask(&self, _: &Channel, agent: &Person, prompt: String) -> Result<String, String> {
            self.asked.lock().unwrap().push((agent.id.clone(), prompt));
            let out = self.answers.lock().unwrap().get_mut(&agent.id).and_then(VecDeque::pop_front).unwrap_or(Ok("(pass)".into()));
            if out.is_err() && self.halt_on_err.load(std::sync::atomic::Ordering::SeqCst) {
                self.halted.store(true, std::sync::atomic::Ordering::SeqCst);
            }
            out
        }
        async fn post(&self, _: &Channel, agent: &Person, answer: Answer, round: u8) {
            self.posted.lock().unwrap().push((agent.id.clone(), answer.text, round));
        }
        async fn note(&self, _: &Channel, text: String, _: u8) {
            self.notes.lock().unwrap().push(text);
        }
        fn working(&self, _: &str, _: &[String], _: u8) {}
        async fn stopped(&self, _: &str) -> bool {
            self.halted.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    async fn chain(script: &Script, ch: &Channel, text: &str) -> Report {
        let r = roster();
        let plan = plan_user(ch, &r, &incoming(text), &[]);
        run_chain(script, ch, &r, "Gabriel", plan).await
    }

    #[tokio::test]
    async fn an_answer_that_names_a_member_starts_the_next_round_up_to_the_cap() {
        let script = Script::default()
            .says("m", "On it. @Leo needs the title.")
            .says("l", "Title ready. @Mila check it.")
            .says("m", "Looks good. @Leo ship it.");
        let report = chain(&script, &channel(Mode::Mention, 3), "@Mila start").await;
        assert_eq!(script.asked(), ["m", "l", "m"]);
        assert_eq!(script.posted(), [("m".into(), 1), ("l".into(), 2), ("m".into(), 3)]);
        assert_eq!(report, Report { rounds: 3, replies: 3 });

        // Two rounds: Mila's second answer is never asked for.
        let script = Script::default().says("m", "@Leo go").says("l", "@Mila back to you").says("m", "late");
        let report = chain(&script, &channel(Mode::Mention, 2), "@Mila start").await;
        assert_eq!(script.asked(), ["m", "l"]);
        assert_eq!(report.rounds, 2);
    }

    #[tokio::test]
    async fn one_round_means_only_the_first_asks() {
        let script = Script::default().says("m", "@Leo go");
        let report = chain(&script, &channel(Mode::Mention, 1), "@Mila start").await;
        assert_eq!(script.asked(), ["m"]);
        assert_eq!(report.replies, 1);
    }

    #[tokio::test]
    async fn an_agent_answers_once_per_round_and_never_to_itself() {
        let script = Script::default()
            .says("a", "@Leo and @Atlas")
            .says("m", "@Leo too")
            .says("l", "done");
        let r = roster();
        let ch = channel(Mode::Mention, 3);
        let plan = plan_user(&ch, &r, &incoming("@Atlas @Mila go"), &[]);
        let report = run_chain(&script, &ch, &r, "Gabriel", plan).await;
        let mut asked = script.asked();
        asked.sort();
        assert_eq!(asked, ["a", "l", "m"], "Leo was named twice in round 1 and asked once in round 2");
        assert_eq!(report.replies, 3);
    }

    #[tokio::test]
    async fn pass_posts_nothing_and_ends_the_chain() {
        let script = Script::default().says("m", "(pass)");
        let report = chain(&script, &channel(Mode::Mention, 3), "@Mila anything?").await;
        assert!(script.posted().is_empty());
        assert_eq!(report.replies, 0);
        assert_eq!(report.rounds, 1);
    }

    #[tokio::test]
    async fn a_turn_that_fails_leaves_a_note_and_the_rest_goes_on() {
        let script = Script::default().fails("m", "it stopped before answering").says("l", "here");
        let report = chain(&script, &channel(Mode::Mention, 3), "@Mila @Leo go").await;
        assert_eq!(script.posted(), [("l".into(), 1)]);
        assert_eq!(script.notes.lock().unwrap().as_slice(), ["Mila could not answer: it stopped before answering"]);
        assert_eq!(report.replies, 1);
    }

    #[tokio::test]
    async fn a_turn_the_reader_stopped_leaves_no_could_not_answer_note() {
        let script = Script::default().halting().fails("m", "it stopped before answering");
        let report = chain(&script, &channel(Mode::Mention, 3), "@Mila go").await;
        assert!(script.notes.lock().unwrap().is_empty(), "a Stop is not a failure to report");
        assert_eq!(report.replies, 0);
    }

    #[test]
    fn two_chains_in_one_room_do_not_clear_each_other() {
        let mut by_chain = HashMap::new();
        let first = record_working(&mut by_chain, "c1", 1, &["m".into()], 1);
        assert_eq!(first.agents, ["m"]);
        let both = record_working(&mut by_chain, "c1", 2, &["l".into(), "m".into()], 2);
        assert_eq!(both.agents, ["m", "l"], "the union, each once");
        assert_eq!(both.round, 2);
        let after_one = record_working(&mut by_chain, "c1", 1, &[], 0);
        assert_eq!(after_one.agents, ["l", "m"], "the second chain is still answering");
        let none = record_working(&mut by_chain, "c1", 2, &[], 0);
        assert!(none.agents.is_empty() && none.round == 0);
        assert!(by_chain.is_empty(), "nothing is kept for a quiet room");
    }

    #[tokio::test]
    async fn stopping_settles_the_ask_in_flight() {
        let (tx, rx) = oneshot::channel();
        PENDING
            .lock()
            .unwrap()
            .insert("s-stop".into(), Pending { prompt: "p".into(), started: true, tx: Some(tx) });
        settle_stopped("s-stop");
        assert_eq!(rx.await.unwrap(), Err("stopped".to_string()));
        assert!(!PENDING.lock().unwrap().contains_key("s-stop"));
        settle_stopped("s-stop");
    }

    #[tokio::test]
    async fn turns_mode_asks_everyone_in_order_and_replies_are_capped() {
        let script = Script::default().says("a", "one").says("m", "two").says("l", "three");
        let report = chain(&script, &channel(Mode::Turns, 3), "status?").await;
        assert_eq!(script.asked(), ["a", "m", "l"]);
        assert_eq!(report.replies, 3);

        let many: Vec<Person> = (0..14).map(|i| person(&format!("p{i}"), &format!("P{i}"))).collect();
        let mut ch = channel(Mode::Turns, 3);
        ch.members = many.iter().map(|p| p.id.clone()).collect();
        ch.lead = "p0".into();
        let mut script = Script::default();
        for p in &many {
            script = script.says(&p.id, "hello");
        }
        let plan = plan_user(&ch, &many, &incoming("status?"), &[]);
        let report = run_chain(&script, &ch, &many, "Gabriel", plan).await;
        assert_eq!(report.replies, MAX_REPLIES);
        assert_eq!(script.asked().len(), MAX_REPLIES);
    }

    #[tokio::test]
    async fn the_lead_hands_a_message_on_by_naming_members() {
        let script = Script::default().says("a", "Mila, this is yours. @Mila").says("m", "Taking it.");
        let report = chain(&script, &channel(Mode::Lead, 3), "launch the thread").await;
        assert_eq!(script.asked(), ["a", "m"]);
        assert!(script.asked.lock().unwrap()[0].1.contains("the lead decides"));
        assert_eq!(report.replies, 2);
    }

    fn scratch() -> Core {
        let dir = std::env::temp_dir().join(format!("hz-channels-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Core::at(dir, None)
    }

    fn new_channel(name: &str) -> NewChannel {
        NewChannel {
            workspace_id: Some("w".into()),
            name: name.into(),
            purpose: "  why  ".into(),
            members: vec!["a".into(), "m".into()],
            lead: None,
            mode: None,
            rounds: None,
        }
    }

    fn line(from: &str, text: &str) -> ChannelMessage {
        ChannelMessage {
            seq: 0,
            ts: 0,
            from: from.into(),
            text: text.into(),
            reply_to: None,
            reactions: vec![],
            round: 0,
            task_id: None,
            kind: MessageKind::Message,
            attachments: vec![],
        }
    }

    #[tokio::test]
    async fn names_are_slugs_unique_per_workspace_and_a_channel_needs_an_agent() {
        let core = scratch();
        let c = core.create(new_channel("  Launch Plan! ")).await.unwrap();
        assert_eq!(c.name, "launch-plan");
        assert_eq!(c.purpose, "why");
        assert_eq!(c.lead, "a", "the first member leads when none is named");
        assert_eq!((c.mode, c.rounds), (Mode::Mention, 3));

        assert_eq!(core.create(new_channel("launch-plan")).await.unwrap_err(), "#launch-plan already exists.");
        let mut other = new_channel("launch-plan");
        other.workspace_id = Some("w2".into());
        assert!(core.create(other).await.is_ok(), "another workspace may reuse the name");
        assert_eq!(core.create(new_channel("   ")).await.unwrap_err(), "A channel needs a name.");
        let mut none = new_channel("x");
        none.members.clear();
        assert_eq!(core.create(none).await.unwrap_err(), "Pick at least one agent.");

        let mut wild = new_channel("wild");
        wild.rounds = Some(9);
        wild.lead = Some("zzz".into());
        let wild = core.create(wild).await.unwrap();
        assert_eq!((wild.rounds, wild.lead.as_str()), (3, "a"));

        assert_eq!(core.list(Some("w")).await.unwrap().len(), 2);
        assert_eq!(core.list(None).await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn members_lead_rounds_and_mode_edit_in_place() {
        let core = scratch();
        let c = core.create(new_channel("pool")).await.unwrap();
        let c = core.member(&c.id, "l", true).await.unwrap();
        assert_eq!(c.members, ["a", "m", "l"]);

        let c = core.update(&c.id, ChannelPatch { lead: Some("m".into()), rounds: Some(2), mode: Some(Mode::Turns), ..Default::default() }).await.unwrap();
        assert_eq!((c.lead.as_str(), c.rounds, c.mode), ("m", 2, Mode::Turns));

        let c = core.member(&c.id, "m", false).await.unwrap();
        assert_eq!(c.lead, "a", "a lead who left is replaced");

        core.member(&c.id, "a", false).await.unwrap();
        let err = core.member(&c.id, "l", false).await.unwrap_err();
        assert_eq!(err, "A channel needs at least one agent.");
        assert_eq!(core.channel(&c.id).await.unwrap().members, ["l"]);

        let c = core.update(&c.id, ChannelPatch { rounds: Some(0), muted: Some(true), purpose: Some("new".into()), ..Default::default() }).await.unwrap();
        assert!(c.muted && c.rounds == 1 && c.purpose == "new");
    }

    #[tokio::test]
    async fn archive_hides_and_restore_refuses_a_name_taken_meanwhile() {
        let core = scratch();
        let c = core.create(new_channel("old")).await.unwrap();
        assert!(core.set_archived(&c.id, true).await.unwrap().archived);
        let again = core.create(new_channel("old")).await.unwrap();
        assert_ne!(again.id, c.id, "an archived name is free");
        assert_eq!(core.set_archived(&c.id, false).await.unwrap_err(), "#old is taken by another channel now.");
        core.set_archived(&again.id, true).await.unwrap();
        assert!(!core.set_archived(&c.id, false).await.unwrap().archived);
    }

    #[tokio::test]
    async fn the_transcript_numbers_survives_a_reload_and_tracks_unread() {
        let core = scratch();
        let c = core.create(new_channel("talk")).await.unwrap();
        let first = core.append(&c.id, line("me", "hello")).await.unwrap();
        let second = core.append(&c.id, line("m", "hi")).await.unwrap();
        let mut note = line("hz", "Leo could not answer");
        note.kind = MessageKind::Note;
        core.append(&c.id, note).await.unwrap();
        assert_eq!((first.seq, second.seq), (1, 2));

        let reread = Core::at((*core.home).clone(), None);
        let all = reread.messages(&c.id).await.unwrap();
        assert_eq!(all.iter().map(|m| m.seq).collect::<Vec<_>>(), [1, 2, 3]);
        let ch = reread.channel(&c.id).await.unwrap();
        assert_eq!((ch.last_seq, ch.last_agent_seq, ch.read_seq), (3, 2, 0), "a note is not news");

        reread.mark_read(&c.id).await.unwrap();
        assert_eq!(reread.channel(&c.id).await.unwrap().read_seq, 3);

        let path = core.dir(&c.id).join("messages.jsonl");
        let mut raw = std::fs::read_to_string(&path).unwrap();
        raw.push_str("{ this is not json\n");
        std::fs::write(&path, raw).unwrap();
        assert_eq!(core.messages(&c.id).await.unwrap().len(), 3, "a bad line is skipped");
    }

    #[tokio::test]
    async fn reactions_toggle_per_person() {
        let core = scratch();
        let c = core.create(new_channel("rx")).await.unwrap();
        core.append(&c.id, line("m", "done")).await.unwrap();
        core.react(&c.id, 1, "✅", "me").await.unwrap();
        core.react(&c.id, 1, "✅", "a").await.unwrap();
        let r = &core.messages(&c.id).await.unwrap()[0].reactions;
        assert_eq!(r, &[Reaction { emoji: "✅".into(), by: vec!["me".into(), "a".into()] }]);
        core.react(&c.id, 1, "✅", "me").await.unwrap();
        core.react(&c.id, 1, "✅", "a").await.unwrap();
        assert!(core.messages(&c.id).await.unwrap()[0].reactions.is_empty());
        assert!(core.react(&c.id, 9, "✅", "me").await.is_err());
    }

    #[tokio::test]
    async fn tasks_belong_to_their_owner_and_wait_on_approvals() {
        let core = scratch();
        let c = core.create(new_channel("work")).await.unwrap();
        let t = core.create_task(&c.id, "m", "Launch thread", Some(2)).await.unwrap();
        assert_eq!(t.status, TaskStatus::Writing);
        let same = core.create_task(&c.id, "m", "launch THREAD", None).await.unwrap();
        assert_eq!(same.id, t.id, "the same open task is not made twice");
        assert!(core.create_task(&c.id, "m", "  ", None).await.is_err());

        assert_eq!(
            core.update_task(&c.id, "a", &t.id, Some(TaskStatus::Done), None).await.unwrap_err(),
            "That task belongs to someone else."
        );
        core.hold_tasks(&c.id, "m", true).await.unwrap();
        assert_eq!(core.tasks(&c.id).await.unwrap()[0].status, TaskStatus::WaitingForYou);
        core.hold_tasks(&c.id, "m", false).await.unwrap();
        assert_eq!(core.tasks(&c.id).await.unwrap()[0].status, TaskStatus::Writing);

        let done = core.update_task(&c.id, "m", "Launch thread", Some(TaskStatus::Done), Some("5 posts".into())).await.unwrap();
        assert_eq!((done.status, done.result.as_deref()), (TaskStatus::Done, Some("5 posts")));
        let words: Vec<_> = done.steps.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(words.last(), Some(&"Done"));
        assert_eq!(TaskStatus::parse("waiting for you"), Some(TaskStatus::WaitingForYou));
        assert_eq!(TaskStatus::parse("nonsense"), None);

        let fresh = core.create_task(&c.id, "m", "Launch thread", None).await.unwrap();
        assert_ne!(fresh.id, t.id, "a finished task can be taken again");
    }

    #[tokio::test]
    async fn each_channel_agent_pair_has_a_thread_of_its_own() {
        let core = scratch();
        let one = core.create(new_channel("one")).await.unwrap();
        let two = core.create(new_channel("two")).await.unwrap();

        let (a1, existed) = core.thread_session(&one.id, "a").await.unwrap();
        assert!(!existed);
        let (a1_again, existed) = core.thread_session(&one.id, "a").await.unwrap();
        assert_eq!((a1_again.as_str(), existed), (a1.as_str(), true));
        let (m1, _) = core.thread_session(&one.id, "m").await.unwrap();
        let (a2, _) = core.thread_session(&two.id, "a").await.unwrap();
        assert!(a1 != m1 && a1 != a2 && m1 != a2, "one session per pair");

        let reread = Core::at((*core.home).clone(), None);
        assert_eq!(reread.thread_session(&one.id, "a").await.unwrap().0, a1, "it survives a restart");

        // The agent's own chat is a different conversation, and a thread's turn
        // is told apart from it by the hooks.
        assert!(observe_completed(&a1, &TurnStatus::Success, Some("x")));
        assert!(!observe_completed("some-agent-chat", &TurnStatus::Success, Some("x")));
    }

    #[tokio::test]
    async fn a_thread_turn_answers_the_ask_its_own_prompt_started() {
        let session = "chan-test-session";
        THREADS.lock().unwrap().insert(session.into(), ("c".into(), "m".into()));
        let (tx, mut rx) = oneshot::channel();
        PENDING.lock().unwrap().insert(session.into(), Pending { prompt: "the ask".into(), started: false, tx: Some(tx) });

        assert!(observe_completed(session, &TurnStatus::Success, Some("early")));
        assert!(rx.try_recv().is_err(), "a turn that closed before the ask began is not its answer");
        observe_user(session, "[earlier] the ask and more");
        observe_completed(session, &TurnStatus::Success, Some("  forty-two \n"));
        assert_eq!(rx.try_recv().unwrap(), Ok("forty-two".to_string()));

        let (tx, mut rx) = oneshot::channel();
        PENDING.lock().unwrap().insert(session.into(), Pending { prompt: "again".into(), started: true, tx: Some(tx) });
        observe_completed(session, &TurnStatus::Error, None);
        assert!(rx.try_recv().unwrap().is_err());
    }

    /// **The #teste bug, end to end from the wire.** A channel thread's turn
    /// closed with `finalText: null` because mcode's prompt reply carries only a
    /// `stopReason`; the ask resolved to an empty answer, which `is_pass` reads
    /// as "nothing to add", and the room never saw the reply. Replays the shape
    /// of the real thread (two chunks, then `end_turn`) through the mapper and
    /// hands the closing event to the hook the session layer calls.
    #[test]
    fn a_real_acp_turn_answers_the_channel_ask_with_its_text() {
        use crate::events::AgentEventPayload as P;
        use crate::harness::mcode::{mapper::Mapper, parser::{parse_notification, McodeEvent, PromptResponse}};
        use std::sync::{atomic::AtomicU64, Arc};

        let session = "chan-wire-session";
        THREADS.lock().unwrap().insert(session.into(), ("c".into(), "a".into()));
        let (tx, mut rx) = oneshot::channel();
        PENDING.lock().unwrap().insert(session.into(), Pending { prompt: "the ask".into(), started: true, tx: Some(tx) });

        let mut mapper = Mapper::new(session.into(), Arc::new(AtomicU64::new(0)));
        let mut events = Vec::new();
        for text in ["Fala, Gabriel! ", "T\u{f4} aqui."] {
            let params = json!({"sessionId": "mvs_x", "update": {"sessionUpdate": "agent_message_chunk", "messageId": "message", "content": {"type": "text", "text": text}}});
            let update = parse_notification("session/update", params).unwrap().unwrap();
            events.extend(mapper.map(McodeEvent::Update(Box::new(update))));
        }
        events.extend(mapper.map(McodeEvent::PromptDone(PromptResponse { stop_reason: "end_turn".into() })));

        let closing = events
            .into_iter()
            .find_map(|e| match e.payload {
                P::TurnCompleted { status, final_text, .. } => Some((status, final_text)),
                _ => None,
            })
            .expect("the turn closed");
        assert!(observe_completed(session, &closing.0, closing.1.as_deref()));
        let answer = rx.try_recv().unwrap().unwrap();
        assert_eq!(answer, "Fala, Gabriel! T\u{f4} aqui.");
        assert!(!is_pass(&answer));
    }

    #[test]
    fn two_members_with_one_name_are_told_apart_and_both_reachable() {
        let mut people = vec![person("a1", "Atlas"), person("m", "Mila"), person("a2", "Atlas")];
        number_twins(&mut people);
        let names: Vec<&str> = people.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["Atlas (1)", "Mila", "Atlas (2)"]);
        assert_eq!(mentions("@Atlas (2) take this", &people), ["a2"]);
        assert_eq!(mentions("@Mila and @Atlas (1)", &people), ["m", "a1"]);
    }

    #[test]
    fn a_mention_of_the_reader_lands_in_the_inbox_with_its_channel() {
        let ch = channel(Mode::Mention, 3);
        let mut msg = line("m", "@Gabriel o título ficou bom? Tenho mais três.");
        msg.seq = 7;
        let item = file_my_mention(&ch, &msg, "Gabriel", Some("sess-1")).expect("it mentions the reader");
        assert_eq!(item.channel.as_deref(), Some("launch"));
        assert_eq!(item.agent_id, "m");
        assert_eq!(item.sub, "#launch");
        assert_eq!(item.ref_.as_deref(), Some("channel:c1:7"));
        assert_eq!(parse_mention_ref(item.ref_.as_deref().unwrap()), Some(("c1".into(), 7)));

        let listed = crate::inbox::inbox_list();
        assert!(listed.items.iter().any(|i| i.id == item.id && i.channel.as_deref() == Some("launch")));

        assert!(file_my_mention(&ch, &line("m", "no one here"), "Gabriel", None).is_none());
        assert!(file_my_mention(&ch, &line("me", "@Gabriel"), "Gabriel", None).is_none(), "your own words are not a mention");
        let mut note = line("hz", "@Gabriel");
        note.kind = MessageKind::Note;
        assert!(file_my_mention(&ch, &note, "Gabriel", None).is_none());
        assert_eq!(parse_mention_ref("session:1"), None);
    }

    #[tokio::test]
    async fn a_workspace_taking_its_channels_with_it() {
        let core = scratch();
        let a = core.create(new_channel("gone")).await.unwrap();
        let mut keep = new_channel("kept");
        keep.workspace_id = Some("w2".into());
        let b = core.create(keep).await.unwrap();
        core.append(&a.id, line("me", "x")).await.unwrap();
        core.drop_workspace("w").await.unwrap();
        let left = core.list(None).await.unwrap();
        assert_eq!(left.iter().map(|c| c.id.clone()).collect::<Vec<_>>(), [b.id]);
        assert!(!core.dir(&a.id).exists());
    }

    #[tokio::test]
    async fn export_is_markdown_with_round_headings() {
        let core = scratch();
        let c = core.create(new_channel("md")).await.unwrap();
        core.append(&c.id, line("me", "ship it")).await.unwrap();
        let mut a = line("m", "On it.");
        a.round = 1;
        core.append(&c.id, a).await.unwrap();
        let md = core.export(&c.id, "Gabriel").await.unwrap();
        assert!(md.starts_with("# #md\n\nwhy\n\nMembers: Gabriel,"));
        assert!(md.contains("**Gabriel**") && md.contains("ship it") && md.contains("_Round 1 of 3_") && md.contains("On it."));
    }
}
