//! The real runners behind `agentkit`'s traits: Lima, the OS speech synthesiser, npm, and a loopback
//! HTTP listener. Each one is plain code over a trait or a path so its tests use fakes; none of the
//! tests starts Lima, plays a sound or touches the network.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use anyhow::{bail, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::agentkit::accounts::Engine;
use crate::agentkit::call::{self, Call, CallState, SentenceSplitter, SpeakQueue, Speaker, Turn, Voice};
use crate::agentkit::{app_api, engine_updates, speech};


fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<()> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(v)?)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn read_json<T: Default + for<'de> Deserialize<'de>>(path: &Path) -> T {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Plays audio; the real one hands it to the OS player.
pub trait Player: Send + Sync {
    /// Plays the bytes and returns when they end or `stop` cuts them.
    fn play(&self, audio: &[u8]) -> Result<()>;
    /// Cuts whatever is playing.
    fn stop(&self);
}

static PLAYING_PID: Mutex<Option<u32>> = Mutex::new(None);

/// Speech through macOS `say`, which renders to an AIFF file we read back.
pub struct SayVoice;

impl Voice for SayVoice {
    fn synth(&self, text: &str) -> Result<Vec<u8>> {
        if !cfg!(target_os = "macos") {
            bail!("no speech synthesiser is wired for this system");
        }
        let out = std::env::temp_dir().join(format!("hz-say-{}.aiff", uuid::Uuid::new_v4()));
        let status = std::process::Command::new("say").arg("-o").arg(&out).arg("--").arg(text).status()?;
        let bytes = std::fs::read(&out);
        let _ = std::fs::remove_file(&out);
        if !status.success() {
            bail!("`say` failed");
        }
        Ok(bytes?)
    }
}

/// Playback through macOS `afplay`; the pid is kept so a barge-in can kill it.
pub struct AfPlayer;

impl Player for AfPlayer {
    fn play(&self, audio: &[u8]) -> Result<()> {
        let file = std::env::temp_dir().join(format!("hz-play-{}.aiff", uuid::Uuid::new_v4()));
        std::fs::write(&file, audio)?;
        let spawned = std::process::Command::new("afplay").arg(&file).spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                let _ = std::fs::remove_file(&file);
                return Err(e.into());
            }
        };
        *PLAYING_PID.lock().expect("pid lock") = Some(child.id());
        let _ = child.wait();
        *PLAYING_PID.lock().expect("pid lock") = None;
        let _ = std::fs::remove_file(&file);
        Ok(())
    }

    fn stop(&self) {
        if let Some(pid) = PLAYING_PID.lock().expect("pid lock").take() {
            let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
        }
    }
}

struct Room {
    call: Call,
    queue: SpeakQueue,
    splitter: SentenceSplitter,
    turns: Vec<Turn>,
    pending: String,
    started: i64,
}

static CALLS: LazyLock<Mutex<HashMap<String, Room>>> = LazyLock::new(Default::default);

fn rooms() -> std::sync::MutexGuard<'static, HashMap<String, Room>> {
    CALLS.lock().expect("calls lock")
}

/// Opens a call for the agent; the voice is local so it is live at once.
pub fn call_start(agent: &str, now: i64) -> Result<(), String> {
    let mut g = rooms();
    if g.get(agent).is_some_and(|r| r.call.state() != CallState::Ended) {
        return Err("already on a call with this agent".into());
    }
    let mut c = Call::new();
    c.start();
    c.connected();
    g.insert(
        agent.into(),
        Room { call: c, queue: SpeakQueue::new(), splitter: SentenceSplitter::new(), turns: vec![], pending: String::new(), started: now },
    );
    Ok(())
}

/// Takes the next queued sentence through the voice and the player, one at a time. The lock is dropped
/// around the slow steps so a barge-in can cancel while a sentence is being made or played.
fn drain(agent: &str, voice: &dyn Voice, player: &dyn Player) {
    loop {
        let next = rooms().get_mut(agent).and_then(|r| r.queue.next_to_play());
        let Some(u) = next else { return };
        let audio = voice.synth(&speech::prepare(&u.text));
        let current = rooms().get(agent).is_some_and(|r| r.queue.is_current(&u));
        if let (Ok(a), true) = (audio, current) {
            let _ = player.play(&a);
        }
        if let Some(r) = rooms().get_mut(agent) {
            r.queue.finished(u.id);
        }
    }
}

/// Queues a piece of the agent's reply for speaking and plays what is complete; `last` flushes the tail
/// and closes the agent's turn in the transcript.
pub fn call_say(agent: &str, delta: &str, last: bool, voice: &dyn Voice, player: &dyn Player) -> Result<(), String> {
    {
        let mut g = rooms();
        let r = g.get_mut(agent).ok_or("no call with this agent")?;
        if r.call.state() != CallState::Live {
            return Err("the call is not live".into());
        }
        r.pending.push_str(delta);
        let mut sentences = r.splitter.push(delta);
        if last {
            sentences.extend(r.splitter.flush());
            let text = std::mem::take(&mut r.pending);
            if !text.trim().is_empty() {
                r.turns.push(Turn { speaker: Speaker::Agent, text });
            }
        }
        for s in sentences {
            r.queue.enqueue(&s);
        }
    }
    drain(agent, voice, player);
    Ok(())
}

/// Records what the user said. A stop word cuts the speech off and returns true; it is not part of the transcript.
pub fn call_heard(agent: &str, text: &str, player: &dyn Player) -> Result<bool, String> {
    let stop = call::is_stop_word(text);
    {
        let mut g = rooms();
        let r = g.get_mut(agent).ok_or("no call with this agent")?;
        if stop {
            r.queue.cancel_all();
        } else if r.call.is_listening() && !text.trim().is_empty() {
            r.turns.push(Turn { speaker: Speaker::User, text: text.trim().to_string() });
        }
    }
    if stop {
        player.stop();
    }
    Ok(stop)
}

/// Hangs up and returns the lines to post: how long it lasted, then the last turns, each clipped.
pub fn call_end(agent: &str, now: i64, player: &dyn Player) -> Result<Vec<String>, String> {
    let mut room = rooms().remove(agent).ok_or("no call with this agent")?;
    room.queue.cancel_all();
    room.call.end();
    player.stop();
    if !room.pending.trim().is_empty() {
        room.turns.push(Turn { speaker: Speaker::Agent, text: std::mem::take(&mut room.pending) });
    }
    let mins = ((now - room.started).max(0) + 59) / 60;
    let mut lines = vec![format!("Call ended after {mins} min.")];
    let skip = room.turns.len().saturating_sub(10);
    for t in &room.turns[skip..] {
        let who = if t.speaker == Speaker::User { "You" } else { "Agent" };
        let text: String = t.text.split_whitespace().collect::<Vec<_>>().join(" ");
        let clipped: String = text.chars().take(160).collect();
        lines.push(format!("{who}: {clipped}"));
    }
    Ok(lines)
}

/// One site an agent is signed in to; no secret is kept here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Login {
    pub site: String,
    pub user: String,
    pub used: String,
}

/// The logins saved at `path`, oldest first.
pub fn logins_list(path: &Path) -> Vec<Login> {
    read_json(path)
}

/// Adds a login, or refreshes the user and date of the one for that site.
pub fn login_record(path: &Path, site: &str, user: &str, today: &str) -> Result<()> {
    let mut all = logins_list(path);
    all.retain(|l| l.site != site);
    all.push(Login { site: site.into(), user: user.into(), used: today.into() });
    write_json(path, &all)
}

/// Drops the login for a site.
pub fn login_remove(path: &Path, site: &str) -> Result<()> {
    let mut all = logins_list(path);
    all.retain(|l| l.site != site);
    write_json(path, &all)
}

const MAX_VERSIONS: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VersionRec {
    n: String,
    title: String,
    by: String,
    at: i64,
    snapshot: Value,
}

/// The versions at `path` without their snapshots, oldest first.
pub fn versions_list(path: &Path) -> Vec<Value> {
    read_json::<Vec<VersionRec>>(path)
        .into_iter()
        .map(|v| json!({"n": v.n, "title": v.title, "by": v.by, "at": v.at}))
        .collect()
}

/// Appends a version and returns its number; the oldest go once there are more than a hundred.
pub fn version_record(path: &Path, title: &str, by: &str, snapshot: Value, at: i64) -> Result<String> {
    let mut all: Vec<VersionRec> = read_json(path);
    let next = all.iter().filter_map(|v| v.n.parse::<u64>().ok()).max().unwrap_or(0) + 1;
    all.push(VersionRec { n: next.to_string(), title: title.into(), by: by.into(), at, snapshot });
    if all.len() > MAX_VERSIONS {
        all.drain(..all.len() - MAX_VERSIONS);
    }
    write_json(path, &all)?;
    Ok(next.to_string())
}

/// The snapshot saved as version `n`.
pub fn version_snapshot(path: &Path, n: &str) -> Option<Value> {
    read_json::<Vec<VersionRec>>(path).into_iter().find(|v| v.n == n).map(|v| v.snapshot)
}

/// A latest version already fetched, behind `engine_updates::Source` so `check_all` stays the one decider.
struct Fetched(Engine, String);

impl engine_updates::Source for Fetched {
    fn engine(&self) -> Engine {
        self.0
    }
    fn latest(&self) -> Result<String> {
        Ok(self.1.clone())
    }
}

fn engine_name(e: Engine) -> String {
    serde_json::to_value(e).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

/// Which engines are behind, as `{engine, installed, latest}`.
pub fn updates_from(latest: &BTreeMap<String, String>, installed: &HashMap<Engine, String>) -> Vec<Value> {
    let sources: Vec<Fetched> = installed
        .keys()
        .filter_map(|e| latest.get(&engine_name(*e)).map(|v| Fetched(*e, v.clone())))
        .collect();
    let refs: Vec<&dyn engine_updates::Source> = sources.iter().map(|s| s as &dyn engine_updates::Source).collect();
    let mut out: Vec<Value> = engine_updates::check_all(&refs, installed)
        .into_iter()
        .map(|u| json!({"engine": engine_name(u.engine), "installed": u.installed, "latest": u.latest}))
        .collect();
    out.sort_by_key(|v| v["engine"].as_str().unwrap_or("").to_string());
    out
}

#[derive(Default, Serialize, Deserialize)]
struct UpdateCache {
    checked: i64,
    latest: BTreeMap<String, String>,
}

async fn npm_latest(http: &reqwest::Client, package: &str) -> Option<String> {
    let body = http.get(engine_updates::npm_latest_url(package)).send().await.ok()?.text().await.ok()?;
    engine_updates::parse_npm_latest(&body)
}

/// Installed CLIs behind npm's latest. npm is asked when the cache at `cache` is six hours old; a failed
/// lookup keeps the last answer.
pub async fn engine_updates(cache: &Path, now: DateTime<Utc>) -> Vec<Value> {
    let mut installed = HashMap::new();
    for (wire, engine) in [("claude", Engine::Claude), ("codex", Engine::Codex), ("opencode", Engine::OpenCode)] {
        if let Ok(info) = crate::clis::cli_info(wire.into()).await {
            if let (true, Some(v)) = (info.installed, info.version) {
                installed.insert(engine, v);
            }
        }
    }
    let mut c: UpdateCache = read_json(cache);
    let last = DateTime::from_timestamp(c.checked, 0);
    if !installed.is_empty() && engine_updates::should_check(last, now) {
        if let Ok(http) = reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build() {
            let mut any = false;
            for e in installed.keys() {
                let Some(pkg) = engine_updates::npm_package(*e) else { continue };
                if let Some(v) = npm_latest(&http, pkg).await {
                    c.latest.insert(engine_name(*e), v);
                    any = true;
                }
            }
            if any {
                c.checked = now.timestamp();
                let _ = write_json(cache, &c);
            }
        }
    }
    updates_from(&c.latest, &installed)
}

fn http_reply(code: u16, body: &str) -> String {
    let reason = match code {
        200 => "OK",
        401 => "Unauthorized",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Bad Request",
    };
    format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn safe_segment(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn read_memories(home: &Path, id: &str) -> Vec<Value> {
    let dir = home.join("agents").join(id).join("memory");
    let mut names: Vec<String> = std::fs::read_dir(dir.clone())
        .map(|d| d.flatten().filter_map(|e| e.file_name().into_string().ok()).collect())
        .unwrap_or_default();
    names.retain(|n| n.ends_with(".md") && !n.contains('/'));
    names.sort();
    names
        .into_iter()
        .take(200)
        .filter_map(|n| {
            let text = std::fs::read_to_string(dir.join(&n)).ok()?;
            let content: String = text.chars().take(64_000).collect();
            Some(json!({"name": n, "content": content}))
        })
        .collect()
}

/// Answers one request head. The key is checked before the route is looked at, so an unauthenticated
/// caller learns nothing about which paths exist. Reads the roster the app already writes and the memory folders.
pub fn handle_request(head: &str, keys_path: &Path, home: &Path, now: DateTime<Utc>) -> String {
    let mut lines = head.lines();
    let mut first = lines.next().unwrap_or("").split_whitespace();
    let (method, path) = (first.next().unwrap_or(""), first.next().unwrap_or(""));
    let auth = lines
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.trim().eq_ignore_ascii_case("authorization"))
        .map(|(_, v)| v.trim().to_string());
    let Ok(mut keys) = app_api::AppKeys::open(keys_path) else {
        return http_reply(401, r#"{"error":"unauthorized"}"#);
    };
    let Some(id) = auth.as_deref().and_then(app_api::bearer_token).and_then(|t| keys.verify(t)) else {
        return http_reply(401, r#"{"error":"unauthorized"}"#);
    };
    let reply = match app_api::route(method, path) {
        app_api::Route::Agents => {
            let roster: Vec<Value> = read_json(&home.join("agents.json"));
            let slim: Vec<Value> = roster
                .iter()
                .map(|a| json!({"id": a["id"], "name": a["name"], "role": a["role"]}))
                .collect();
            http_reply(200, &json!(slim).to_string())
        }
        app_api::Route::Memories(agent) if safe_segment(&agent) => http_reply(200, &json!(read_memories(home, &agent)).to_string()),
        app_api::Route::MethodNotAllowed => http_reply(405, r#"{"error":"method not allowed"}"#),
        _ => http_reply(404, r#"{"error":"not found"}"#),
    };
    let _ = keys.touch(&id, now);
    reply
}

/// Listens on a random loopback port, writes it to `app-api.json`, and serves the read-only API.
pub async fn serve_app_api() -> Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let home = crate::store::get_home_app_dir().await?;
    let kit = home.join("agentkit");
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    write_json(&kit.join("app-api.json"), &json!({"port": port}))?;
    loop {
        let (mut sock, _) = listener.accept().await?;
        let (keys, home) = (kit.join("app-keys.json"), home.clone());
        tokio::spawn(async move {
            let mut buf = Vec::with_capacity(1024);
            let mut chunk = [0u8; 1024];
            let read = async {
                while buf.len() < 8192 && !buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = sock.read(&mut chunk).await?;
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                std::io::Result::Ok(())
            };
            if tokio::time::timeout(std::time::Duration::from_secs(5), read).await.is_err() {
                return;
            }
            let reply = handle_request(&String::from_utf8_lossy(&buf), &keys, &home, Utc::now());
            let _ = sock.write_all(reply.as_bytes()).await;
            let _ = sock.shutdown().await;
        });
    }
}

/// Starts the local API and the watch poller. Both are side channels: a failure costs the feature, not the app.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async {
        if let Err(e) = serve_app_api().await {
            eprintln!("[app api err] {e:#}");
        }
    });
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(5));
        let mut n: u32 = 0;
        loop {
            tick.tick().await;
            for wake in crate::kit_cmds::poll_watches().await.unwrap_or_default() {
                let _ = app.emit("agent_wake", &wake);
                if let (Some(bot), Some(message)) = (wake["bot"].as_str(), wake["message"].as_str()) {
                    crate::agent_tools::wake(&app, bot, message).await;
                }
            }
            // The agents' computers are asked less often: each look is a round trip into a machine.
            n = n.wrapping_add(1);
            if n.is_multiple_of(3) {
                crate::agent_tools::poll_computer_watches(&app).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentkit::call::FakeVoice;

    struct FakePlayer {
        played: Mutex<Vec<String>>,
        stops: Mutex<u32>,
    }
    impl FakePlayer {
        fn new() -> Self {
            Self { played: Mutex::new(vec![]), stops: Mutex::new(0) }
        }
    }
    impl Player for FakePlayer {
        fn play(&self, audio: &[u8]) -> Result<()> {
            self.played.lock().unwrap().push(String::from_utf8_lossy(audio).into_owned());
            Ok(())
        }
        fn stop(&self) {
            *self.stops.lock().unwrap() += 1;
        }
    }

    fn tmp() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("hz-rt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_call_speaks_in_sentences_stops_on_stop_and_summarises() {
        let (voice, player) = (FakeVoice::default(), FakePlayer::new());
        call_start("t-call", 1000).unwrap();
        assert!(call_start("t-call", 1000).is_err());
        call_say("t-call", "Hello there. How are", false, &voice, &player).unwrap();
        call_say("t-call", " you today", true, &voice, &player).unwrap();
        assert_eq!(player.played.lock().unwrap().len(), 2);
        assert!(!call_heard("t-call", "Can you book Friday?", &player).unwrap());
        assert!(call_heard("t-call", "Stop!", &player).unwrap());
        assert_eq!(*player.stops.lock().unwrap(), 1);
        let lines = call_end("t-call", 1000 + 125, &player).unwrap();
        assert_eq!(lines[0], "Call ended after 3 min.");
        assert!(lines.iter().any(|l| l.starts_with("You: Can you book")));
        assert!(lines.iter().any(|l| l.starts_with("Agent: Hello there.")));
        assert!(call_end("t-call", 0, &player).is_err());
    }

    #[test]
    fn saying_to_nobody_is_an_error() {
        let (voice, player) = (FakeVoice::default(), FakePlayer::new());
        assert!(call_say("t-nobody", "hi.", false, &voice, &player).is_err());
    }

    #[test]
    fn logins_upsert_and_remove() {
        let p = tmp().join("l.json");
        login_record(&p, "a.com", "me", "2026-01-01").unwrap();
        login_record(&p, "b.com", "me", "2026-01-02").unwrap();
        login_record(&p, "a.com", "you", "2026-01-03").unwrap();
        let l = logins_list(&p);
        assert_eq!(l.len(), 2);
        assert_eq!(l[1], Login { site: "a.com".into(), user: "you".into(), used: "2026-01-03".into() });
        login_remove(&p, "a.com").unwrap();
        assert_eq!(logins_list(&p).len(), 1);
    }

    #[test]
    fn versions_number_up_hide_snapshots_and_restore() {
        let p = tmp().join("v.json");
        assert_eq!(version_record(&p, "first", "me", json!({"model": "a"}), 10).unwrap(), "1");
        assert_eq!(version_record(&p, "second", "agent", json!({"model": "b"}), 20).unwrap(), "2");
        let l = versions_list(&p);
        assert_eq!(l.len(), 2);
        assert!(l[0].get("snapshot").is_none() && l[1]["by"] == "agent");
        assert_eq!(version_snapshot(&p, "1").unwrap()["model"], "a");
        assert!(version_snapshot(&p, "9").is_none());
    }

    #[test]
    fn updates_report_only_engines_that_are_behind() {
        let installed = HashMap::from([(Engine::Claude, "1.0.0".to_string()), (Engine::Codex, "2.0.0".to_string())]);
        let latest = BTreeMap::from([("claude".to_string(), "1.1.0".to_string()), ("codex".to_string(), "2.0.0".to_string())]);
        let out = updates_from(&latest, &installed);
        assert_eq!(out, vec![json!({"engine": "claude", "installed": "1.0.0", "latest": "1.1.0"})]);
        assert!(updates_from(&BTreeMap::new(), &installed).is_empty());
    }

    #[test]
    fn the_local_api_checks_the_key_then_serves_only_reads() {
        let home = tmp();
        let keys = home.join("keys.json");
        let (_, key) = app_api::AppKeys::open(&keys).unwrap().create("t").unwrap();
        std::fs::write(home.join("agents.json"), r#"[{"id":"a1","name":"Mavis","role":"ops","instructions":"secret"}]"#).unwrap();
        let mem = home.join("agents/a1/memory");
        std::fs::create_dir_all(&mem).unwrap();
        std::fs::write(mem.join("MEMORY.md"), "# Memory").unwrap();
        let req = |m: &str, p: &str, auth: &str| format!("{m} {p} HTTP/1.1\r\nHost: x\r\n{auth}\r\n\r\n");
        let bearer = format!("authorization: Bearer {key}");
        let go = |m: &str, p: &str, a: &str| handle_request(&req(m, p, a), &keys, &home, Utc::now());

        assert!(go("GET", "/v1/agents", "").starts_with("HTTP/1.1 401"));
        assert!(go("GET", "/v1/agents", "Authorization: Bearer nope").starts_with("HTTP/1.1 401"));
        assert!(go("GET", "/nothing", "").starts_with("HTTP/1.1 401"));
        let agents = go("GET", "/v1/agents", &bearer);
        assert!(agents.starts_with("HTTP/1.1 200") && agents.contains("Mavis") && !agents.contains("secret"));
        assert!(go("GET", "/v1/agents/a1/memories", &bearer).contains("# Memory"));
        assert!(go("POST", "/v1/agents", &bearer).starts_with("HTTP/1.1 405"));
        assert!(go("GET", "/v1/agents/a%2f..%2f/memories", &bearer).starts_with("HTTP/1.1 404"));
        assert!(go("GET", "/v1/live", &bearer).starts_with("HTTP/1.1 404"));
        assert!(app_api::AppKeys::open(&keys).unwrap().last_used(&app_api::AppKeys::open(&keys).unwrap().list()[0].id).is_some());
    }
}
