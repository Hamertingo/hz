//! Agents talking to each other, never blocking.
//!
//! `team_message` returns at once. From anywhere but a channel the text lands in
//! a **pair thread**: a hidden channel whose two members are the agents
//! (`channels.rs` keeps it, `pair: Some(true)`), which the person can read and
//! not write in. The receiver is woken in its own session for that thread, so
//! its chat stays clean, and its plain reply there *is* the answer: it is posted
//! in the thread and wakes the sender in the chat it wrote from.
//!
//! Every run started here is bot-triggered, and the limits count those: hops
//! along one conversation (the person's message is 0, each message and each
//! answer +1, the workspace's `handoffs` the ceiling) and runs per thread per
//! [`RATE_WINDOW_MS`]. Runs are persisted, so one cut off by a restart is handed
//! back once.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{LazyLock, Mutex, OnceLock},
};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use crate::{
    agents::{self, AgentRecord},
    channels::{ChannelMessage, Core, MessageKind},
    events::{MessageSender, TurnStatus},
    orchestration,
};

/// Longest message one call carries; a longer brief belongs in a file.
pub const MAX_TEXT: usize = 4000;
/// Bot-triggered runs one thread may start inside [`RATE_WINDOW_MS`].
pub const RATE_RUNS: usize = 12;
pub const RATE_WINDOW_MS: u64 = 10 * 60 * 1000;
/// How far back a restart looks for a run it cut off.
const CUT_OFF_MS: u64 = 10 * 60 * 1000;
/// Unseen thread messages a woken receiver is shown.
const UNSEEN: usize = 10;
/// The reply that says nothing is left to say. Posted nowhere, wakes nobody.
pub const NO_REPLY: &str = "NO_REPLY";

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ───────────────────────── rules (pure) ─────────────────────────

/// Which of `names` a teammate reference means: case-insensitive, a leading `@`
/// ignored, an exact name before a unique prefix. The error lists who can be
/// reached, since that is what the caller needs to try again.
pub fn match_name(query: &str, names: &[String]) -> Result<usize, String> {
    let q = query.trim().trim_start_matches('@').trim().to_lowercase();
    let reachable = || {
        if names.is_empty() {
            "You cannot reach anyone from here.".to_string()
        } else {
            format!("You can reach: {}.", names.join(", "))
        }
    };
    if q.is_empty() {
        return Err(format!("Say who the message is for. {}", reachable()));
    }
    if let Some(at) = names.iter().position(|n| n.to_lowercase() == q) {
        return Ok(at);
    }
    let starts: Vec<usize> = (0..names.len()).filter(|&i| names[i].to_lowercase().starts_with(&q)).collect();
    match starts.as_slice() {
        [one] => Ok(*one),
        [] => Err(format!("No teammate is called {}. {}", query.trim(), reachable())),
        many => Err(format!(
            "{} could be {}. Use the full name.",
            query.trim(),
            many.iter().map(|&i| names[i].as_str()).collect::<Vec<_>>().join(" or ")
        )),
    }
}

/// Whether a reply is the agent saying it has nothing to add.
pub fn is_no_reply(text: &str) -> bool {
    let t = text.trim().trim_matches(|c: char| c == '`' || c == '*' || c == '.' || c.is_whitespace());
    t.is_empty() || t.eq_ignore_ascii_case(NO_REPLY) || t.to_ascii_uppercase().starts_with("NO_REPLY")
}

/// Words a message can be made of and still say nothing but thanks, okay or bye.
const ACK_WORDS: &[&str] = &[
    "thanks", "thank", "you", "thx", "ty", "ok", "okay", "k", "cool", "great", "perfect", "nice", "got", "it", "noted",
    "sounds", "good", "will", "do", "cheers", "bye", "goodbye", "see", "later", "all", "set", "awesome", "so", "much",
    "a", "lot", "lots", "again", "np", "no", "problem", "welcome", "you're", "youre", "right", "sure", "yes", "yep",
    "obrigado", "obrigada", "valeu", "vlw", "beleza", "blz", "perfeito", "perfeita", "ótimo", "otimo", "show", "tmj",
    "entendi", "combinado", "certo", "muito", "de", "nada", "fechado", "tchau", "até", "ate", "mais", "boa",
    "gracias", "perfecto", "vale", "genial", "listo", "muchas", "adiós", "adios", "hasta", "luego", "claro", "entendido",
];

/// Whether a message is only an acknowledgement, which wakes nobody: answering
/// a thanks with a thanks is how two agents talk forever.
pub fn is_ack_only(text: &str) -> bool {
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !(c.is_alphanumeric() || c == '\''))
        .filter(|w| !w.is_empty())
        .collect();
    words.len() <= 8 && words.iter().all(|w| ACK_WORDS.contains(w))
}

/// Openings that promise work rather than report it.
const ANNOUNCE: &[&str] = &[
    "i'll ", "i will ", "let me ", "on it", "give me a ", "working on it", "i'm on it", "i am on it", "checking",
    "looking into it", "vou ", "já vou", "ja vou", "deixa eu ", "deixa comigo", "estou vendo", "tô vendo", "to vendo",
    "voy a ", "déjame ", "dejame ", "dame un ", "estoy en ello", "lo reviso",
];

/// Whether an answer only announces work ("I'll check the logs"). It is posted,
/// but the sender stays waiting: only the result that follows wakes it.
pub fn announces_work(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    t.chars().count() <= 200 && !t.contains("\n\n") && ANNOUNCE.iter().any(|a| t.starts_with(a))
}

/// Why an answer in a thread wakes nobody, or `None` when it wakes the sender.
#[derive(Debug, PartialEq, Eq)]
pub enum Hold {
    NoReply,
    Announced,
    Ack,
    HopLimit,
    /// The sender has a run of its own pending in this thread, which shows it.
    SenderInThread,
}

/// `delegated` is a run that passed part of the work on: what it says now is an
/// update, and only its reply once that answer is back goes up the chain.
pub fn hold_answer(text: &str, hop: u32, limit: u32, sender_in_thread: bool, delegated: bool) -> Option<Hold> {
    if is_no_reply(text) {
        Some(Hold::NoReply)
    } else if delegated || announces_work(text) {
        Some(Hold::Announced)
    } else if is_ack_only(text) {
        Some(Hold::Ack)
    } else if hop > limit {
        Some(Hold::HopLimit)
    } else if sender_in_thread {
        Some(Hold::SenderInThread)
    } else {
        None
    }
}

/// What a thread's run counter says about one more run.
#[derive(Debug, PartialEq, Eq)]
pub enum Allow {
    Run,
    /// Over the limit, and the quiet note has not been written this window.
    PauseAndSay,
    Paused,
}

#[derive(Default)]
pub struct Rate {
    runs: VecDeque<u64>,
    noted: bool,
}

impl Rate {
    /// Counts a run at `now` if the window has room for it.
    pub fn take(&mut self, now: u64) -> Allow {
        while self.runs.front().is_some_and(|t| now.saturating_sub(*t) >= RATE_WINDOW_MS) {
            self.runs.pop_front();
        }
        if self.runs.len() < RATE_RUNS {
            self.runs.push_back(now);
            self.noted = false;
            return Allow::Run;
        }
        if self.noted {
            Allow::Paused
        } else {
            self.noted = true;
            Allow::PauseAndSay
        }
    }
}

fn clock(ms: u64) -> String {
    use chrono::{Local, TimeZone};
    Local
        .timestamp_millis_opt(ms as i64)
        .single()
        .map(|t| t.format("%H:%M").to_string())
        .unwrap_or_default()
}

/// What the receiver reads when it is woken in its thread.
pub fn pair_prompt(me: &str, other: &str, person: &str, unseen: &[(u64, String)]) -> String {
    let mut out = format!("[your thread with {other} \u{2014} {person} can read it but not write in it]\n\nNew in the thread, oldest first:\n");
    for (ts, text) in unseen {
        out.push_str(&format!("[{}] {other}: {}\n", clock(*ts), text.trim()));
    }
    out.push_str(&format!(
        "\nThis is a private thread between you, {me}, and your teammate {other}. Answer here, briefly, the way a \
         colleague would: your reply is posted in the thread and goes back to {other} by itself, so do not use \
         team_message to answer them. If they asked for work, do it and put the result here. If you can only start it \
         now, say so in one line and carry on; {other} hears from you when the result is in. Anything that needs \
         {person}'s decision goes through {other}: do not address {person} or greet them. When nothing is left to \
         say (thanks, goodbye, small talk), answer exactly {NO_REPLY}."
    ));
    out
}

/// What wakes the sender, in the chat it wrote from, once the answer is in.
/// `lib/teamTalk.ts` rebuilds both halves to draw the words alone; change both.
pub fn answer_prompt(from: &str, answer: &str) -> String {
    format!("{}{}{}", answer_prefix(from), answer.trim(), answer_suffix(from))
}

pub fn answer_prefix(from: &str) -> String {
    format!("[{from} answered in your thread]\n\n")
}

pub fn answer_suffix(from: &str) -> String {
    format!(
        "\n\n(Tell the person in a line or two what came back, then carry on. If it needs nothing from you, answer \
         {NO_REPLY}. To write back to {from}, use team_message.)"
    )
}

/// The same answer for a sender that wrote from one of its own threads: the
/// person is not reading there, the teammate further up is.
pub fn answer_prompt_in_thread(from: &str, answer: &str) -> String {
    format!(
        "{}{}\n\n(That is the answer to what you passed on. Reply in this thread with what it means for the question \
         you were asked: your reply goes back by itself. If nothing is left to say, answer {NO_REPLY}.)",
        answer_prefix(from),
        answer.trim()
    )
}

fn resume_note(person: &str) -> String {
    format!("({person} wrote to you in your own chat, so this was paused. Pick it up again now.)\n\n")
}

const CUT_OFF_NOTE: &str = "(hz restarted while you were on this. Pick up where you left off.)\n\n";

// ───────────────────────── state ─────────────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    /// The receiver answering in its thread session.
    Pair,
    /// The sender woken by an answer, in the chat it wrote from.
    Wake,
}

/// A message still waiting on its answer.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Open {
    pair: String,
    from: String,
    to: String,
    /// The session the sender wrote from, where the answer wakes it.
    origin: String,
    hop: u32,
    seq: u64,
    at: u64,
}

/// A run this module handed to a session and has not seen end.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Run {
    session: String,
    agent: String,
    pair: String,
    kind: Kind,
    /// The agent at the other end of the thread.
    other: String,
    hop: u32,
    /// The framing alone; a note (resume, restart) goes in front of it.
    body: String,
    /// What was actually sent, which is how its turn is recognised.
    #[serde(default)]
    prompt: String,
    /// 0 until handed over.
    #[serde(default)]
    sent_at: u64,
    #[serde(default)]
    started: bool,
    #[serde(default)]
    suspended: bool,
    #[serde(default)]
    requeued: bool,
    /// The newest thread message it was shown.
    #[serde(default)]
    upto: u64,
    /// It sent a teammate a message of its own while it ran.
    #[serde(default)]
    delegated: bool,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    #[serde(default)]
    open: Vec<Open>,
    #[serde(default)]
    runs: Vec<Run>,
    /// `pair:agent` → the newest seq that agent was shown.
    #[serde(default)]
    seen: HashMap<String, u64>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Default::default);
static RATES: LazyLock<Mutex<HashMap<String, Rate>>> = LazyLock::new(Default::default);
/// Agents whose own chat is answering the person right now: a thread run for
/// them waits, and one already running was paused for it.
static CHAT_BUSY: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
static APP: OnceLock<AppHandle> = OnceLock::new();
static WRITE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().expect("talk state poisoned")
}

fn seen_key(pair: &str, agent: &str) -> String {
    format!("{pair}:{agent}")
}

/// Writes the state and tells the window who waits on whom. The snapshot is
/// taken under the write lock, so the last write is always the newest state.
fn changed() {
    let Some(app) = APP.get().cloned() else { return };
    app.emit("team_status", status()).ok();
    tauri::async_runtime::spawn(async move {
        let _guard = WRITE.lock().await;
        let body = serde_json::to_string_pretty(&*state()).unwrap_or_default();
        if let Ok(home) = crate::store::get_home_app_dir().await {
            if let Err(e) = crate::store::write_atomic(&home.join("team-talk.json"), body).await {
                eprintln!("[talk err] could not save: {e:#}");
            }
        }
    });
}

/// One agent's place in its conversations, for the sidebar and the header.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct TeamStatus {
    pub agent_id: String,
    /// Teammates it wrote to that have not answered yet.
    pub waiting_for: Vec<String>,
    /// Teammates it is answering in a thread right now.
    pub working_for: Vec<String>,
}

fn status_of(s: &State) -> Vec<TeamStatus> {
    let mut by: HashMap<String, TeamStatus> = HashMap::new();
    let blank = |id: &str| TeamStatus { agent_id: id.to_string(), waiting_for: Vec::new(), working_for: Vec::new() };
    for o in &s.open {
        let t = by.entry(o.from.clone()).or_insert_with(|| blank(&o.from));
        if !t.waiting_for.contains(&o.to) {
            t.waiting_for.push(o.to.clone());
        }
    }
    for r in s.runs.iter().filter(|r| r.kind == Kind::Pair && r.sent_at > 0 && !r.suspended) {
        let t = by.entry(r.agent.clone()).or_insert_with(|| blank(&r.agent));
        if !t.working_for.contains(&r.other) {
            t.working_for.push(r.other.clone());
        }
    }
    let mut out: Vec<TeamStatus> = by.into_values().collect();
    out.sort_by(|a, b| a.agent_id.cmp(&b.agent_id));
    out
}

/// Who is waiting for and working for whom, right now.
pub fn status() -> Vec<TeamStatus> {
    status_of(&state())
}

/// The hop the run in `session` is at, or 0 for a turn nothing here started.
fn hop_of(s: &State, session: &str) -> u32 {
    s.runs.iter().filter(|r| r.session == session && r.started).map(|r| r.hop).max().unwrap_or(0)
}

/// Runs cut off by a restart that get one more try: handed over in the last
/// [`CUT_OFF_MS`] and never re-queued before. The rest are dropped.
fn take_cut_off(runs: &mut Vec<Run>, now: u64) -> Vec<Run> {
    let mut again = Vec::new();
    runs.retain_mut(|r| {
        if r.sent_at == 0 {
            // Never handed over: it was waiting on the agent's own chat, which a
            // restart has ended. It goes now.
            again.push(r.clone());
            return true;
        }
        if r.requeued || now.saturating_sub(r.sent_at) > CUT_OFF_MS {
            return false;
        }
        r.requeued = true;
        r.started = false;
        r.sent_at = 0;
        r.prompt = format!("{CUT_OFF_NOTE}{}", r.body);
        again.push(r.clone());
        true
    });
    again
}

/// How the prompts name the person: their name, or "the person" while it is
/// still the placeholder.
async fn person_name() -> String {
    let name = crate::settings::read().await.me.name;
    if name.trim().is_empty() || name == "You" {
        "the person".into()
    } else {
        name
    }
}

fn workspace_limit(agent: &AgentRecord) -> u32 {
    match agent.workspace_id.as_deref() {
        Some(id) => crate::workspaces::defaults_of(id),
        None => crate::workspaces::first_defaults(),
    }
    .handoffs
}

// ───────────────────────── the tool ─────────────────────────

/// `team_message`: posts `text` for the teammate `to` and returns at once.
/// `session` is the session the call came from, which is where an answer lands.
pub async fn send(app: &AppHandle, me: &AgentRecord, session: Option<&str>, to: &str, text: &str) -> Result<String> {
    let text = text.trim();
    anyhow::ensure!(!text.is_empty(), "team_message needs some `text`");
    anyhow::ensure!(
        text.chars().count() <= MAX_TEXT,
        "that message is over {MAX_TEXT} characters; put the long part in a file and send its path"
    );
    let origin = session
        .map(str::to_string)
        .or_else(|| me.session_id.clone())
        .context("you have no conversation to write from yet")?;

    // Inside a channel the message is an @-post in the room, for members only.
    if let Some((channel_id, _)) = crate::channels::thread_of(&origin) {
        let core = Core::live(app).await.map_err(anyhow::Error::msg)?;
        let channel = core.channel(&channel_id).await.map_err(anyhow::Error::msg)?;
        if channel.pair != Some(true) {
            return crate::channels::tool_mention(app, &channel_id, &me.id, to, text).await;
        }
    }

    let reachable: Vec<AgentRecord> =
        agents::teammates(&me.id).into_iter().filter(|a| agents::may_talk(me, a).is_ok()).collect();
    let names: Vec<String> = reachable.iter().map(|a| a.name.clone()).collect();
    let target = reachable[match_name(to, &names).map_err(anyhow::Error::msg)?].clone();

    let core = Core::live(app).await.map_err(anyhow::Error::msg)?;
    let pair = core.pair_for(&me.id, &target.id, me.workspace_id.clone()).await.map_err(anyhow::Error::msg)?;
    if crate::channels::thread_of(&origin).is_some_and(|(c, _)| c == pair.id) {
        anyhow::bail!(
            "you are already in your thread with {}: just answer, and your reply goes back to them by itself",
            target.name
        );
    }

    let limit = workspace_limit(me);
    let hop = hop_of(&state(), &origin) + 1;
    anyhow::ensure!(
        hop <= limit,
        "this conversation has gone back and forth {limit} times already; stop here and tell the person what is still open"
    );

    let from_chat = me.session_id.as_deref() == Some(origin.as_str());
    let msg = core
        .append(
            &pair.id,
            ChannelMessage { from: me.id.clone(), text: text.to_string(), from_chat: Some(from_chat), ..Default::default() },
        )
        .await
        .map_err(anyhow::Error::msg)?;

    let back = if from_chat { "this chat" } else { "this conversation" };
    if is_ack_only(text) {
        return Ok(format!("Posted in your thread with {}. It only says thanks, so they are not woken.", target.name));
    }

    {
        let mut s = state();
        for r in s.runs.iter_mut().filter(|r| r.session == origin && r.started) {
            r.delegated = true;
        }
        s.open.push(Open {
            pair: pair.id.clone(),
            from: me.id.clone(),
            to: target.id.clone(),
            origin: origin.clone(),
            hop,
            seq: msg.seq,
            at: msg.ts,
        });
    }
    changed();

    if !wake_receiver(app, &target, &pair.id, &me.id, hop).await {
        state().open.retain(|o| !(o.pair == pair.id && o.seq == msg.seq));
        changed();
        return Ok(format!(
            "Posted in your thread with {}, but that thread has had a lot of traffic in the last ten minutes, so it is \
             paused. Tell the person what you were trying to pass on.",
            target.name
        ));
    }
    if crate::channels::thread_of(&origin).is_some() {
        return Ok(format!(
            "Sent to {}. Say in one line here that you passed it on, then end your turn: their answer comes back to \
             this thread, and your reply after it is the one that goes back up.",
            target.name
        ));
    }
    Ok(format!(
        "Sent to {}. Tell the person in a line or two what you passed on, then end your turn: the answer comes back to \
         {back} by itself.",
        target.name
    ))
}

/// Wakes `agent` in its thread with `other`, unless a run of its own there is
/// still going (it picks up what is new when that ends). False when the thread
/// is paused for traffic.
async fn wake_receiver(app: &AppHandle, agent: &AgentRecord, pair: &str, other: &str, hop: u32) -> bool {
    if state().runs.iter().any(|r| r.kind == Kind::Pair && r.agent == agent.id && r.pair == pair) {
        return true;
    }
    let Ok(core) = Core::live(app).await else { return false };
    let Ok((session, _)) = core.thread_session(pair, &agent.id).await else { return false };
    let seen = state().seen.get(&seen_key(pair, &agent.id)).copied().unwrap_or(0);
    let messages = core.messages(pair).await.unwrap_or_default();
    let unseen: Vec<&ChannelMessage> =
        messages.iter().filter(|m| m.seq > seen && m.from != agent.id && m.kind == MessageKind::Message).collect();
    if unseen.is_empty() {
        return true;
    }
    let shown: Vec<(u64, String)> =
        unseen[unseen.len().saturating_sub(UNSEEN)..].iter().map(|m| (m.ts, m.text.clone())).collect();
    let upto = unseen.last().map_or(seen, |m| m.seq);
    let person = person_name().await;
    let other_name = agents::name_of(other).unwrap_or_else(|| "your teammate".into());
    let body = pair_prompt(&agent.name, &other_name, &person, &shown);
    let run = Run {
        session,
        agent: agent.id.clone(),
        pair: pair.to_string(),
        kind: Kind::Pair,
        other: other.to_string(),
        hop,
        prompt: body.clone(),
        body,
        sent_at: 0,
        started: false,
        suspended: false,
        requeued: false,
        upto,
        delegated: false,
    };
    start(app, run).await
}

/// Counts a run against its thread and hands it over, or keeps it until the
/// agent's own chat is free. False when the thread is paused.
async fn start(app: &AppHandle, run: Run) -> bool {
    let allow = RATES.lock().expect("talk rates poisoned").entry(run.pair.clone()).or_default().take(now_ms());
    match allow {
        Allow::Run => {}
        Allow::Paused => return false,
        Allow::PauseAndSay => {
            let a = agents::name_of(&run.agent).unwrap_or_default();
            let b = agents::name_of(&run.other).unwrap_or_default();
            note(app, &run.pair, format!("Paused: {a} and {b} have written a lot in the last ten minutes, so this thread rests for a while.")).await;
            return false;
        }
    }
    let wait = run.kind == Kind::Pair && CHAT_BUSY.lock().expect("talk busy poisoned").contains(&run.agent);
    state().runs.push(run.clone());
    changed();
    if !wait {
        hand_over(app, run).await;
    }
    true
}

async fn note(app: &AppHandle, pair: &str, text: String) {
    if let Ok(core) = Core::live(app).await {
        let _ = core
            .append(pair, ChannelMessage { from: "hz".into(), text, kind: MessageKind::Note, ..Default::default() })
            .await;
    }
}

/// Sends a registered run's prompt into its session, opening the thread's
/// session on first use. Recorded as sent *before* the send, since the prompt is
/// logged inside it and that log line is what marks the run started.
async fn hand_over(app: &AppHandle, run: Run) {
    let existing = orchestration::resolved_session(Some(&run.session)).await;
    let fresh = existing.is_none() && run.kind == Kind::Pair;
    let prompt = if fresh {
        let identity = agents::by_id(&run.agent).map(|a| crate::channels::identity(&a)).unwrap_or_default();
        format!("{}\n\n{}", identity.trim_end(), run.prompt)
    } else {
        run.prompt.clone()
    };
    {
        let mut s = state();
        // Claimed here, so a resume racing a first start cannot send it twice.
        let Some(r) = s.runs.iter_mut().find(|r| r.session == run.session && r.body == run.body && r.sent_at == 0) else {
            return;
        };
        r.sent_at = now_ms();
        r.prompt = prompt.clone();
        r.started = fresh;
        if run.kind == Kind::Pair {
            let key = seen_key(&run.pair, &run.agent);
            let seen = s.seen.entry(key).or_default();
            *seen = (*seen).max(run.upto);
        }
    }
    changed();

    let sent = match existing {
        Some(item) => {
            if run.kind == Kind::Pair {
                agents::bind(&run.session, &run.agent);
            }
            let from = agents::by_id(&run.other)
                .map(|o| MessageSender { session_id: o.session_id.unwrap_or_default(), title: o.name });
            orchestration::deliver(&item, from, &prompt, app).await.map(|_| ())
        }
        None if fresh => match agents::by_id(&run.agent) {
            Some(record) => orchestration::start_thread_session(&record, &run.session, &prompt, app).await.map(|_| ()),
            None => Err(anyhow::anyhow!("the agent is no longer on the roster")),
        },
        None => Err(anyhow::anyhow!("the conversation it wrote from is gone")),
    };
    if let Err(e) = sent {
        eprintln!("[talk err] could not wake {}: {e:#}", run.agent);
        state().runs.retain(|r| !(r.session == run.session && r.body == run.body));
        if run.kind == Kind::Pair {
            let name = agents::name_of(&run.agent).unwrap_or_else(|| "The agent".into());
            note(app, &run.pair, format!("{name} could not be reached: {e:#}")).await;
        }
        changed();
    }
}

// ───────────────────────── turn hooks ─────────────────────────

/// Called with every message a session logs. Marks a handed-over run started
/// once its own prompt opens a turn, and, for a message the person wrote in an
/// agent's own chat, pauses that agent's thread work until they are answered.
pub fn observe_user(session_id: &str, text: &str, by_reader: bool) {
    {
        let mut s = state();
        if let Some(r) = s.runs.iter_mut().find(|r| r.session == session_id && r.sent_at > 0 && !r.started && text.contains(r.prompt.trim()))
        {
            r.started = true;
        }
    }
    if !by_reader {
        return;
    }
    let Some(agent) = agents::agent_of(session_id).filter(|a| a.session_id.as_deref() == Some(session_id)) else {
        return;
    };
    CHAT_BUSY.lock().expect("talk busy poisoned").insert(agent.id.clone());
    let paused: Vec<String> = {
        let mut s = state();
        s.runs
            .iter_mut()
            .filter(|r| r.kind == Kind::Pair && r.agent == agent.id && r.started && !r.suspended)
            .map(|r| {
                r.suspended = true;
                r.session.clone()
            })
            .collect()
    };
    if paused.is_empty() {
        return;
    }
    changed();
    if let Some(app) = APP.get().cloned() {
        tauri::async_runtime::spawn(async move {
            let manager = app.state::<crate::session::SessionManager>();
            for session in paused {
                let _ = manager.interrupt(&session, &app).await;
            }
        });
    }
}

/// Called when a session's turn closes. Posts a thread answer and wakes whoever
/// waits on it; hands paused thread work back once the person is answered.
///
/// True when the turn was an errand of this module's, or said only
/// [`NO_REPLY`]: neither is news for the person's Inbox.
pub fn observe_completed(session_id: &str, status: &TurnStatus, stop_reason: Option<&str>, final_text: Option<&str>) -> bool {
    let cancelled = stop_reason == Some("cancelled");
    let silent = final_text.is_some_and(is_no_reply);

    let primary_of = agents::agent_of(session_id).filter(|a| a.session_id.as_deref() == Some(session_id)).map(|a| a.id);
    let freed = primary_of.filter(|id| CHAT_BUSY.lock().expect("talk busy poisoned").remove(id));

    let ended: Vec<Run> = {
        let mut s = state();
        let mut out = Vec::new();
        s.runs.retain_mut(|r| {
            if r.session != session_id || !r.started {
                return true;
            }
            if r.suspended && cancelled {
                // Stopped for the person: handed back once they are answered.
                r.started = false;
                r.sent_at = 0;
                r.prompt.clear();
                return true;
            }
            out.push(r.clone());
            false
        });
        out
    };
    let errand = !ended.is_empty();
    if errand || freed.is_some() {
        changed();
    }

    let Some(app) = APP.get().cloned() else { return errand || silent };
    let text = final_text.map(str::to_string);
    let status = *status;
    tauri::async_runtime::spawn(async move {
        // Whatever woke it, a turn in a pair thread's session is a reply in that
        // thread: the receiver's answer, or a sender's once its own hand-off is back.
        let thread = match crate::channels::thread_of(&ended.first().map(|r| r.session.clone()).unwrap_or_default()) {
            Some((channel, agent)) => match Core::live(&app).await {
                Ok(core) if core.channel(&channel).await.is_ok_and(|c| c.pair == Some(true)) => Some((channel, agent)),
                _ => None,
            },
            None => None,
        };
        if let (Some((pair, agent)), false) = (thread, ended.is_empty()) {
            // An aborted turn's half answer never goes back.
            if !cancelled {
                match status {
                    TurnStatus::Error => {
                        let name = agents::name_of(&agent).unwrap_or_else(|| "The agent".into());
                        note(&app, &pair, format!("{name} stopped before answering.")).await;
                    }
                    TurnStatus::Success => {
                        let upto = ended
                            .iter()
                            .filter(|r| r.pair == pair)
                            .map(|r| r.upto)
                            .max()
                            .unwrap_or_else(|| state().seen.get(&seen_key(&pair, &agent)).copied().unwrap_or(0));
                        let delegated = ended.iter().any(|r| r.delegated);
                        let hop = ended.iter().map(|r| r.hop).max().unwrap_or(0);
                        answered(&app, &pair, &agent, Reply { upto, hop, delegated }, text.as_deref().unwrap_or_default()).await;
                    }
                }
            }
        }
        if let Some(agent) = freed {
            resume(&app, &agent).await;
        }
    });
    errand || silent
}

/// Thread runs that waited for, or were paused by, the agent's own chat go now.
async fn resume(app: &AppHandle, agent: &str) {
    let person = person_name().await;
    let waiting: Vec<Run> = {
        let mut s = state();
        s.runs
            .iter_mut()
            .filter(|r| r.agent == agent && r.kind == Kind::Pair && r.sent_at == 0)
            .map(|r| {
                if r.suspended {
                    r.suspended = false;
                    r.prompt = format!("{}{}", resume_note(&person), r.body);
                }
                r.clone()
            })
            .collect()
    };
    for run in waiting {
        hand_over(app, run).await;
    }
}

/// A receiver's reply in its thread: posted, and, unless it holds back, the
/// sender woken in the chat it wrote from with the answer framed.
/// What the turn that wrote a thread reply knew: the newest message it was
/// shown, the hop it ran at, and whether it handed work on meanwhile.
struct Reply {
    upto: u64,
    hop: u32,
    delegated: bool,
}

async fn answered(app: &AppHandle, pair: &str, agent: &str, reply: Reply, text: &str) {
    let Reply { upto, hop, delegated } = reply;
    let Ok(core) = Core::live(app).await else { return };
    // Only what this run was shown: a message that came in during it is still
    // unanswered, and gets a run of its own below.
    let covers = |o: &Open| o.pair == pair && o.to == agent && o.seq <= upto;
    let latest = state().open.iter().filter(|o| covers(o)).max_by_key(|o| o.seq).cloned();

    if is_no_reply(text) {
        // Nothing to say is an answer too: nobody keeps waiting on it.
        state().open.retain(|o| !covers(o));
        changed();
    } else {
        let limit = agents::by_id(agent).map_or(4, |a| workspace_limit(&a));
        let wake = latest.as_ref().and_then(|o| {
            let sender_in_thread = state()
                .runs
                .iter()
                .any(|r| r.kind == Kind::Pair && r.agent == o.from && r.pair == pair && r.session != o.origin);
            // An answer is one hop past whatever led to it, its own hand-offs included.
            let hold = hold_answer(text, o.hop.max(hop) + 1, limit, sender_in_thread, delegated);
            hold.is_none().then(|| o.clone())
        });
        let to_chat = wake.as_ref().is_some_and(|o| agents::by_id(&o.from).and_then(|a| a.session_id).as_deref() == Some(o.origin.as_str()));
        let posted = core
            .append(
                pair,
                ChannelMessage {
                    from: agent.to_string(),
                    text: text.trim().to_string(),
                    from_chat: Some(false),
                    to_chat: Some(to_chat),
                    ..Default::default()
                },
            )
            .await;
        if let Ok(msg) = &posted {
            state().seen.insert(seen_key(pair, agent), msg.seq);
        }
        if !delegated && !announces_work(text) {
            state().open.retain(|o| !covers(o));
        }
        changed();

        if let Some(o) = wake {
            let name = agents::name_of(agent).unwrap_or_else(|| "Your teammate".into());
            let body = if crate::channels::thread_of(&o.origin).is_some() {
                answer_prompt_in_thread(&name, text)
            } else {
                answer_prompt(&name, text)
            };
            start(
                app,
                Run {
                    session: o.origin.clone(),
                    agent: o.from.clone(),
                    pair: pair.to_string(),
                    kind: Kind::Wake,
                    other: agent.to_string(),
                    hop: o.hop.max(hop) + 1,
                    prompt: body.clone(),
                    body,
                    sent_at: 0,
                    started: false,
                    suspended: false,
                    requeued: false,
                    upto: 0,
                    delegated: false,
                },
            )
            .await;
        }
    }

    // Messages that came in while it was answering get their own run.
    let later = state()
        .open
        .iter()
        .filter(|o| o.pair == pair && o.to == agent && o.seq > upto)
        .map(|o| (o.from.clone(), o.hop))
        .max_by_key(|(_, h)| *h);
    if let (Some((from, hop)), Some(agent)) = (later, agents::by_id(agent)) {
        wake_receiver(app, &agent, pair, &from, hop).await;
    }
}

// ───────────────────────── start-up and commands ─────────────────────────

/// Reads the saved state and hands back, once, the runs a restart cut off.
/// Waits for the webview's roster first: a run needs to know whose it is.
pub async fn load(app: AppHandle) {
    let _ = APP.set(app.clone());
    let Ok(home) = crate::store::get_home_app_dir().await else { return };
    let saved: State = crate::store::read_json(&home.join("team-talk.json")).await.unwrap_or_default();
    let again = {
        let mut s = state();
        *s = saved;
        let now = now_ms();
        // A message nobody answered in a day is not waited on any more.
        s.open.retain(|o| now.saturating_sub(o.at) < 24 * 60 * 60 * 1000);
        take_cut_off(&mut s.runs, now)
    };
    changed();
    if again.is_empty() {
        return;
    }
    for _ in 0..60 {
        if !agents::all().is_empty() && crate::team::port().is_some() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    for run in again {
        hand_over(&app, run).await;
    }
}

/// One pair thread, as an agent's chat draws its "N messages with X" lines.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct PairThread {
    pub channel_id: String,
    /// The agent at the other end.
    pub other: String,
    pub messages: Vec<ChannelMessage>,
}

/// Every thread an agent is in, with its messages.
#[tauri::command]
pub async fn team_pairs(app: AppHandle, agent_id: String) -> Result<Vec<PairThread>, String> {
    let core = Core::live(&app).await?;
    let mut out = Vec::new();
    for c in core.pairs_of(&agent_id).await? {
        let other = c.members.iter().find(|m| **m != agent_id).cloned().unwrap_or_default();
        let messages = core.messages(&c.id).await.map_err(|e| format!("{e:#}"))?;
        out.push(PairThread { channel_id: c.id, other, messages });
    }
    Ok(out)
}

/// The thread between two agents, for opening it read-only; `None` before either
/// has written.
#[tauri::command]
pub async fn team_pair_between(app: AppHandle, a: String, b: String) -> Result<Option<crate::channels::ChannelDetail>, String> {
    let core = Core::live(&app).await?;
    let Some(c) = core.pairs_of(&a).await?.into_iter().find(|c| c.members.contains(&b)) else { return Ok(None) };
    core.detail(&c.id).await.map(Some)
}

/// Who waits for and works for whom, for the first paint.
#[tauri::command]
pub fn team_status() -> Vec<TeamStatus> {
    status()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_name_matches_exactly_first_then_by_a_unique_prefix() {
        let team = names(&["Viktor", "Vik", "Atlas", "Mila Costa"]);
        assert_eq!(match_name("viktor", &team), Ok(0));
        assert_eq!(match_name("@Vik", &team), Ok(1), "exact beats a longer name it starts");
        assert_eq!(match_name("at", &team), Ok(2));
        assert_eq!(match_name("  @mila ", &team), Ok(3));
        let err = match_name("Hugo", &team).unwrap_err();
        assert!(err.contains("Viktor, Vik, Atlas, Mila Costa"), "{err}");
        let two = match_name("v", &names(&["Viktor", "Vera"])).unwrap_err();
        assert!(two.contains("Viktor or Vera"), "{two}");
        assert!(match_name("x", &[]).unwrap_err().contains("cannot reach anyone"));
    }

    #[test]
    fn thanks_and_goodbyes_wake_nobody() {
        for t in ["Thanks!", "ok, thank you so much", "Valeu, perfeito!", "👍", "Gracias, perfecto", "got it, thanks"] {
            assert!(is_ack_only(t), "{t} should be an ack");
        }
        assert!(is_ack_only("👍 thanks"));
        assert!(!is_ack_only("Thanks, but the price is wrong: it should be $9."));
        assert!(!is_ack_only("Can you check the logs?"));
    }

    #[test]
    fn no_reply_is_read_loosely() {
        assert!(is_no_reply("NO_REPLY"));
        assert!(is_no_reply("  `NO_REPLY`. "));
        assert!(is_no_reply("no_reply"));
        assert!(is_no_reply(""));
        assert!(!is_no_reply("No, reply to Atlas first."));
    }

    #[test]
    fn a_promise_of_work_is_not_an_answer() {
        assert!(announces_work("I'll check the logs and get back to you."));
        assert!(announces_work("Vou olhar isso agora."));
        assert!(announces_work("On it."));
        assert!(!announces_work("The logs show a timeout at 03:12 in the billing job; the retry fixed it."));
        let long = format!("I'll explain. {}", "The cause is the cache. ".repeat(12));
        assert!(!announces_work(&long), "a long answer that opens with I'll is still an answer");
    }

    #[test]
    fn an_answer_wakes_the_sender_unless_something_holds_it() {
        assert_eq!(hold_answer("The price is $9.", 2, 4, false, false), None);
        assert_eq!(hold_answer("NO_REPLY", 2, 4, false, false), Some(Hold::NoReply));
        assert_eq!(hold_answer("Let me look into it.", 2, 4, false, false), Some(Hold::Announced));
        assert_eq!(hold_answer("Thanks!", 2, 4, false, false), Some(Hold::Ack));
        assert_eq!(hold_answer("The price is $9.", 5, 4, false, false), Some(Hold::HopLimit));
        assert_eq!(hold_answer("The price is $9.", 4, 4, false, false), None, "the limit itself is allowed");
        assert_eq!(hold_answer("The price is $9.", 2, 4, true, false), Some(Hold::SenderInThread));
        // Measured live: "Passei a pergunta ao Quill…" matched no opening, so the
        // rule is structural: a run that handed work on has not answered yet.
        assert_eq!(hold_answer("Passei a pergunta ao Quill.", 2, 4, false, true), Some(Hold::Announced));
    }

    #[test]
    fn a_thread_pauses_after_twelve_runs_in_ten_minutes_and_says_so_once() {
        let mut rate = Rate::default();
        for i in 0..RATE_RUNS {
            assert_eq!(rate.take(i as u64 * 1000), Allow::Run);
        }
        assert_eq!(rate.take(20_000), Allow::PauseAndSay);
        assert_eq!(rate.take(21_000), Allow::Paused, "one quiet line, not one per refusal");
        assert_eq!(rate.take(RATE_WINDOW_MS + 500), Allow::Run, "the oldest run left the window");
    }

    #[test]
    fn the_answer_framing_round_trips_and_names_the_sender() {
        let p = answer_prompt("Viktor", "  It is $9.  ");
        assert!(p.starts_with("[Viktor answered in your thread]\n\nIt is $9."));
        assert!(p.ends_with(&answer_suffix("Viktor")));
        let up = answer_prompt_in_thread("Quill", "7");
        assert!(up.starts_with("[Quill answered in your thread]\n\n7") && !up.contains("Tell the person"));
        let pair = pair_prompt("Viktor", "Atlas", "Gabriel", &[(0, "What is the price?".into())]);
        assert!(pair.contains("Atlas: What is the price?"));
        assert!(pair.contains("Gabriel can read it but not write in it"));
        assert!(pair.contains(NO_REPLY));
        assert!(pair.contains("do not use team_message to answer them"));
    }

    fn run(session: &str, kind: Kind, agent: &str, other: &str) -> Run {
        Run {
            session: session.into(),
            agent: agent.into(),
            pair: "p1".into(),
            kind,
            other: other.into(),
            hop: 1,
            body: "body".into(),
            prompt: "body".into(),
            sent_at: 1,
            started: true,
            suspended: false,
            requeued: false,
            upto: 0,
            delegated: false,
        }
    }

    #[test]
    fn status_says_who_waits_on_whom_and_who_works_for_whom() {
        let s = State {
            open: vec![Open { pair: "p1".into(), from: "a".into(), to: "v".into(), origin: "sa".into(), hop: 1, seq: 1, at: 0 }],
            runs: vec![run("sv", Kind::Pair, "v", "a"), run("sa", Kind::Wake, "a", "v")],
            seen: HashMap::new(),
        };
        let st = status_of(&s);
        let a = st.iter().find(|t| t.agent_id == "a").unwrap();
        let v = st.iter().find(|t| t.agent_id == "v").unwrap();
        assert_eq!(a.waiting_for, ["v"]);
        assert!(a.working_for.is_empty(), "a wake in its own chat is not working for someone");
        assert_eq!(v.working_for, ["a"]);
        assert_eq!(hop_of(&s, "sv"), 1);
        assert_eq!(hop_of(&s, "elsewhere"), 0, "a turn nothing here started is the person's: hop 0");
    }

    #[test]
    fn a_restart_hands_back_recent_runs_once_with_a_note() {
        let now = 100 * 60 * 1000;
        let mut recent = run("s1", Kind::Pair, "v", "a");
        recent.sent_at = now - 60_000;
        let mut old = run("s2", Kind::Pair, "v", "a");
        old.sent_at = now - CUT_OFF_MS - 1;
        let mut twice = run("s3", Kind::Wake, "a", "v");
        twice.sent_at = now - 1000;
        twice.requeued = true;
        let mut waiting = run("s4", Kind::Pair, "m", "a");
        waiting.sent_at = 0;
        waiting.started = false;
        let mut runs = vec![recent, old, twice, waiting];

        let again = take_cut_off(&mut runs, now);
        let sessions: Vec<&str> = again.iter().map(|r| r.session.as_str()).collect();
        assert_eq!(sessions, ["s1", "s4"]);
        assert!(again[0].prompt.starts_with(CUT_OFF_NOTE) && again[0].prompt.ends_with("body"));
        assert_eq!(runs.len(), 2, "the old and the twice-cut runs are gone");

        // Handed over again and cut off again: that was its one more try.
        runs.iter_mut().find(|r| r.session == "s1").unwrap().sent_at = now;
        let third: Vec<String> = take_cut_off(&mut runs, now + 1000).into_iter().map(|r| r.session).collect();
        assert_eq!(third, ["s4"]);
    }
}
