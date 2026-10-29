//! Messaging bridge over a local Matrix client-server API (default `127.0.0.1:29300`, device token).
//!
//! READ-ONLY BY DESIGN: this module lists rooms, finds a chat, reads messages and builds download
//! URLs. It has no sending function at all; anything that should go out is written as a draft for
//! the reader to send themselves. A test greps this file to keep it that way. Message text comes
//! from other people: callers wrap it with `crate::agentkit::untrusted::wrap` before an agent sees it.

use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;
use std::future::Future;

pub const DEFAULT_BASE: &str = "http://127.0.0.1:29300";
/// Most pages a whole-day read will walk before stopping, so a huge room cannot loop forever.
pub const MAX_PAGES: usize = 200;

/// Connection details; the token never shows in Debug.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RelayConfig {
    pub base: String,
    pub token: String,
}

impl fmt::Debug for RelayConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RelayConfig").field("base", &self.base).field("token", &"<redacted>").finish()
    }
}

impl RelayConfig {
    /// Builds a config; only loopback addresses are accepted so the token never leaves the machine.
    pub fn new(base: &str, token: &str) -> Result<RelayConfig> {
        let u = url::Url::parse(base).map_err(|_| anyhow!("relay address is not a url"))?;
        let host = u.host_str().unwrap_or("");
        if !matches!(host, "127.0.0.1" | "localhost" | "[::1]" | "::1") {
            bail!("the relay must be on this machine, not {host}");
        }
        if token.trim().is_empty() {
            bail!("the relay token is empty");
        }
        Ok(RelayConfig { base: base.trim_end_matches('/').to_string(), token: token.trim().to_string() })
    }

    /// Config for the default local address.
    pub fn local(token: &str) -> Result<RelayConfig> {
        Self::new(DEFAULT_BASE, token)
    }

    /// Value for the `Authorization` header.
    pub fn bearer(&self) -> String {
        format!("Bearer {}", self.token)
    }
}

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// URL listing the rooms the account has joined.
pub fn joined_rooms_url(base: &str) -> String {
    format!("{}/_matrix/client/v3/joined_rooms", base.trim_end_matches('/'))
}

/// URL for a room's name state event.
pub fn room_name_url(base: &str, room: &str) -> String {
    format!("{}/_matrix/client/v3/rooms/{}/state/m.room.name", base.trim_end_matches('/'), enc(room))
}

/// Room ids from `joined_rooms`.
pub fn parse_joined_rooms(json: &str) -> Result<Vec<String>> {
    let v: Value = serde_json::from_str(json)?;
    Ok(v.get("joined_rooms")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("no joined_rooms in reply"))?
        .iter()
        .filter_map(|r| r.as_str().map(String::from))
        .collect())
}

/// A room's name from its `m.room.name` state; `None` when it has none.
pub fn parse_room_name(json: &str) -> Option<String> {
    let v: Value = serde_json::from_str(json).ok()?;
    v.get("name").and_then(Value::as_str).filter(|n| !n.trim().is_empty()).map(String::from)
}

/// A joined room with its display name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Room {
    pub id: String,
    pub name: String,
}

fn fold(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
            'ç' | 'Ç' => 'c',
            'ñ' | 'Ñ' => 'n',
            c => c.to_ascii_lowercase(),
        })
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = vec![i + 1];
        for (j, cb) in b.iter().enumerate() {
            cur.push((prev[j] + usize::from(ca != cb)).min(prev[j + 1] + 1).min(cur[j] + 1));
        }
        prev = cur;
    }
    prev[b.len()]
}

fn similarity(a: &str, b: &str) -> f64 {
    let m = a.chars().count().max(b.chars().count());
    if m == 0 {
        return 1.0;
    }
    1.0 - edit_distance(a, b) as f64 / m as f64
}

fn score(name: &str, query: &str) -> f64 {
    let (n, q) = (fold(name), fold(query));
    if q.is_empty() || n.is_empty() {
        return 0.0;
    }
    if n == q {
        return 1.0;
    }
    if n.starts_with(&q) {
        return 0.9;
    }
    if n.contains(&q) {
        return 0.8;
    }
    let ntoks: Vec<&str> = n.split(' ').collect();
    let qtoks: Vec<&str> = q.split(' ').collect();
    let per_tok: f64 = qtoks
        .iter()
        .map(|qt| ntoks.iter().map(|nt| if nt.starts_with(qt) { 0.95 } else { similarity(nt, qt) }).fold(0.0, f64::max))
        .sum::<f64>()
        / qtoks.len() as f64;
    per_tok * 0.75
}

/// The room whose name best matches `query` (accents and case ignored, small typos tolerated); `None` below a sane floor.
pub fn best_room<'a>(rooms: &'a [Room], query: &str) -> Option<&'a Room> {
    let mut best: Option<(&Room, f64)> = None;
    for r in rooms {
        let s = score(&r.name, query);
        let better = match best {
            None => true,
            Some((b, bs)) => s > bs + 1e-9 || ((s - bs).abs() <= 1e-9 && r.name.len() < b.name.len()),
        };
        if better {
            best = Some((r, s));
        }
    }
    best.filter(|(_, s)| *s >= 0.5).map(|(r, _)| r)
}

/// Paging direction for `/messages`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dir {
    Backward,
    Forward,
}

/// URL for one page of a room's history.
pub fn messages_url(base: &str, room: &str, from_token: Option<&str>, dir: Dir, limit: u32) -> String {
    let d = if dir == Dir::Backward { "b" } else { "f" };
    let mut u = format!(
        "{}/_matrix/client/v3/rooms/{}/messages?dir={d}&limit={}",
        base.trim_end_matches('/'),
        enc(room),
        limit.clamp(1, 200)
    );
    if let Some(t) = from_token {
        u.push_str("&from=");
        u.push_str(&enc(t));
    }
    u
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Kind {
    Text,
    Image,
    Audio,
    File,
}

/// One message as the agent sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Msg {
    pub sender: String,
    /// Milliseconds since the Unix epoch, as the server stamps it.
    pub ts: i64,
    pub kind: Kind,
    pub body: String,
    pub mxc: Option<String>,
    pub voice: bool,
}

/// One page of history and the token for the next (older, when paging backward).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessagePage {
    pub msgs: Vec<Msg>,
    pub next: Option<String>,
}

/// True for a voice note: the voice marker, or an Ogg/Opus audio message.
pub fn is_voice_note(content: &Value) -> bool {
    if content.get("org.matrix.msc3245.voice").is_some() {
        return true;
    }
    let audio = content.get("msgtype").and_then(Value::as_str) == Some("m.audio");
    let mime = content.pointer("/info/mimetype").and_then(Value::as_str).unwrap_or("");
    audio && (mime.starts_with("audio/ogg") || mime.contains("opus"))
}

/// Reads a `/messages` reply; non-message events and redacted ones are skipped.
pub fn parse_messages(json: &str) -> Result<MessagePage> {
    let v: Value = serde_json::from_str(json)?;
    let chunk = v.get("chunk").and_then(Value::as_array).ok_or_else(|| anyhow!("no chunk in reply"))?;
    let mut msgs = Vec::new();
    for e in chunk {
        if e.get("type").and_then(Value::as_str) != Some("m.room.message") {
            continue;
        }
        let Some(content) = e.get("content").filter(|c| c.get("msgtype").is_some()) else { continue };
        let kind = match content.get("msgtype").and_then(Value::as_str).unwrap_or("") {
            "m.image" | "m.sticker" => Kind::Image,
            "m.audio" => Kind::Audio,
            "m.file" | "m.video" => Kind::File,
            _ => Kind::Text,
        };
        let mxc = content
            .get("url")
            .or_else(|| content.pointer("/file/url"))
            .and_then(Value::as_str)
            .filter(|u| u.starts_with("mxc://"))
            .map(String::from);
        msgs.push(Msg {
            sender: e.get("sender").and_then(Value::as_str).unwrap_or("").to_string(),
            ts: e.get("origin_server_ts").and_then(Value::as_i64).unwrap_or(0),
            kind,
            body: content.get("body").and_then(Value::as_str).unwrap_or("").to_string(),
            mxc,
            voice: is_voice_note(content),
        });
    }
    let next = v.get("end").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from);
    Ok(MessagePage { msgs, next })
}

/// Download URL for an `mxc://server/id` content address; refuses anything that could escape the path.
pub fn mxc_to_http(base: &str, mxc: &str) -> Option<String> {
    let rest = mxc.strip_prefix("mxc://")?;
    let (server, id) = rest.split_once('/')?;
    let ok = |s: &str| !s.is_empty() && s != ".." && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'));
    if !ok(server) || !ok(id) {
        return None;
    }
    Some(format!("{}/_matrix/media/v3/download/{server}/{id}", base.trim_end_matches('/')))
}

/// Start and end (exclusive) of a local day in epoch milliseconds, given the zone's UTC offset in seconds.
pub fn day_bounds_ms(day: NaiveDate, utc_offset_secs: i32) -> (i64, i64) {
    let start_local = day.and_hms_opt(0, 0, 0).expect("midnight exists");
    let start: DateTime<Utc> = Utc.from_utc_datetime(&(start_local - Duration::seconds(i64::from(utc_offset_secs))));
    ((start.timestamp_millis()), (start + Duration::days(1)).timestamp_millis())
}

/// What the day reader wants next.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Next {
    /// Fetch the page after this token.
    More(String),
    Done,
}

/// Pages backward through a room until it passes the start of the day.
#[derive(Debug)]
pub struct DayReader {
    start: i64,
    end: i64,
    pages: usize,
    got: Vec<Msg>,
}

impl DayReader {
    pub fn new(start_ms: i64, end_ms: i64) -> DayReader {
        DayReader { start: start_ms, end: end_ms, pages: 0, got: vec![] }
    }

    /// Takes one newest-first page; keeps what falls in the day and says whether to go on.
    pub fn feed(&mut self, page: MessagePage) -> Next {
        self.pages += 1;
        let oldest = page.msgs.iter().map(|m| m.ts).min();
        self.got.extend(page.msgs.into_iter().filter(|m| m.ts >= self.start && m.ts < self.end));
        match (page.next, oldest) {
            (Some(t), Some(o)) if o >= self.start && self.pages < MAX_PAGES => Next::More(t),
            (Some(t), None) if self.pages < MAX_PAGES => Next::More(t),
            _ => Next::Done,
        }
    }

    /// The day's messages, oldest first.
    pub fn finish(mut self) -> Vec<Msg> {
        self.got.sort_by_key(|m| m.ts);
        self.got
    }
}

/// The network seam: authenticated GET returning the body text.
pub trait Fetch {
    fn get(&self, url: &str) -> impl Future<Output = Result<String>> + Send;
}

/// Real fetcher using the config's token.
pub struct ReqwestFetch {
    pub client: reqwest::Client,
    pub config: RelayConfig,
}

impl Fetch for ReqwestFetch {
    async fn get(&self, url: &str) -> Result<String> {
        let resp: reqwest::Response = self.client.get(url).header("authorization", self.config.bearer()).send().await?;
        if !resp.status().is_success() {
            bail!("relay answered {}", resp.status());
        }
        let text: String = resp.text().await?;
        Ok(text)
    }
}

/// Lists joined rooms with their names (falling back to the id when a room has none).
pub async fn list_rooms<F: Fetch>(f: &F, base: &str) -> Result<Vec<Room>> {
    let ids = parse_joined_rooms(&f.get(&joined_rooms_url(base)).await?)?;
    let mut rooms = Vec::new();
    for id in ids {
        let name = match f.get(&room_name_url(base, &id)).await {
            Ok(t) => parse_room_name(&t),
            Err(_) => None,
        };
        rooms.push(Room { name: name.unwrap_or_else(|| id.clone()), id });
    }
    Ok(rooms)
}

/// Reads every message of one local day from a room, oldest first.
pub async fn read_day<F: Fetch>(f: &F, base: &str, room: &str, day: NaiveDate, utc_offset_secs: i32) -> Result<Vec<Msg>> {
    let (start, end) = day_bounds_ms(day, utc_offset_secs);
    let mut reader = DayReader::new(start, end);
    let mut token: Option<String> = None;
    loop {
        let page = parse_messages(&f.get(&messages_url(base, room, token.as_deref(), Dir::Backward, 100)).await?)?;
        match reader.feed(page) {
            Next::More(t) => token = Some(t),
            Next::Done => return Ok(reader.finish()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    fn rooms() -> Vec<Room> {
        ["Família Silva", "Equipe Design", "Design Review", "Clientes VIP", "Hyze Suporte"]
            .iter()
            .enumerate()
            .map(|(i, n)| Room { id: format!("!r{i}:local"), name: n.to_string() })
            .collect()
    }

    #[test]
    fn config_hides_token_and_requires_loopback() {
        let c = RelayConfig::local(" tok123 ").unwrap();
        assert_eq!(c.bearer(), "Bearer tok123");
        assert!(!format!("{c:?}").contains("tok123"));
        assert!(RelayConfig::new("http://evil.example:29300", "t").is_err());
        assert!(RelayConfig::new("http://localhost:29300/", "t").unwrap().base == "http://localhost:29300");
        assert!(RelayConfig::local("  ").is_err());
        assert!(RelayConfig::new("nonsense", "t").is_err());
    }

    #[test]
    fn room_urls_escape() {
        assert_eq!(joined_rooms_url("http://h:1/"), "http://h:1/_matrix/client/v3/joined_rooms");
        assert!(room_name_url("http://h", "!a:b").contains("rooms/%21a%3Ab/state/m.room.name"));
    }

    #[test]
    fn parses_rooms_and_names() {
        assert_eq!(parse_joined_rooms(r#"{"joined_rooms":["!a:x","!b:x"]}"#).unwrap().len(), 2);
        assert!(parse_joined_rooms("{}").is_err());
        assert_eq!(parse_room_name(r#"{"name":"Club"}"#).as_deref(), Some("Club"));
        assert_eq!(parse_room_name(r#"{"name":"  "}"#), None);
        assert_eq!(parse_room_name("nope"), None);
    }

    #[test]
    fn fuzzy_room_matching() {
        let r = rooms();
        assert_eq!(best_room(&r, "familia silva").unwrap().name, "Família Silva");
        assert_eq!(best_room(&r, "FAMÍLIA").unwrap().name, "Família Silva");
        assert_eq!(best_room(&r, "clientes").unwrap().name, "Clientes VIP");
        assert_eq!(best_room(&r, "suport").unwrap().name, "Hyze Suporte");
        assert_eq!(best_room(&r, "hyze suprte").unwrap().name, "Hyze Suporte");
        assert!(best_room(&r, "design").unwrap().name.contains("Design"));
    }

    #[test]
    fn no_match_below_floor() {
        let r = rooms();
        assert!(best_room(&r, "zzzzqqq").is_none());
        assert!(best_room(&r, "").is_none());
        assert!(best_room(&[], "x").is_none());
    }

    #[test]
    fn messages_url_shape() {
        let u = messages_url("http://h", "!a:b", None, Dir::Backward, 50);
        assert!(u.ends_with("/messages?dir=b&limit=50"));
        let u = messages_url("http://h", "!a:b", Some("t1_2/3"), Dir::Forward, 9999);
        assert!(u.contains("dir=f") && u.contains("limit=200") && u.ends_with("&from=t1_2%2F3"));
    }

    fn page_json() -> String {
        json!({
            "chunk": [
                {"type":"m.room.message","sender":"@a:x","origin_server_ts":3000,"content":{"msgtype":"m.text","body":"hello"}},
                {"type":"m.room.message","sender":"@b:x","origin_server_ts":2000,"content":{"msgtype":"m.image","body":"pic.png","url":"mxc://x/img1"}},
                {"type":"m.room.message","sender":"@b:x","origin_server_ts":1900,"content":{"msgtype":"m.audio","body":"Voice message","url":"mxc://x/aud1","info":{"mimetype":"audio/ogg"},"org.matrix.msc3245.voice":{}}},
                {"type":"m.room.message","sender":"@b:x","origin_server_ts":1800,"content":{"msgtype":"m.file","body":"a.pdf","file":{"url":"mxc://x/enc"}}},
                {"type":"m.room.member","sender":"@c:x","origin_server_ts":1700,"content":{"membership":"join"}},
                {"type":"m.room.message","sender":"@d:x","origin_server_ts":1600,"content":{}}
            ],
            "end": "t9"
        })
        .to_string()
    }

    #[test]
    fn parses_message_kinds() {
        let p = parse_messages(&page_json()).unwrap();
        assert_eq!(p.msgs.len(), 4);
        assert_eq!(p.next.as_deref(), Some("t9"));
        assert_eq!(p.msgs[0].kind, Kind::Text);
        assert_eq!(p.msgs[1].kind, Kind::Image);
        assert_eq!(p.msgs[1].mxc.as_deref(), Some("mxc://x/img1"));
        assert_eq!(p.msgs[2].kind, Kind::Audio);
        assert!(p.msgs[2].voice && !p.msgs[0].voice);
        assert_eq!(p.msgs[3].kind, Kind::File);
        assert_eq!(p.msgs[3].mxc.as_deref(), Some("mxc://x/enc"));
        assert!(parse_messages("{}").is_err());
        assert_eq!(parse_messages(r#"{"chunk":[]}"#).unwrap().next, None);
    }

    #[test]
    fn voice_detection() {
        assert!(is_voice_note(&json!({"msgtype":"m.audio","info":{"mimetype":"audio/ogg; codecs=opus"}})));
        assert!(is_voice_note(&json!({"msgtype":"m.text","org.matrix.msc3245.voice":{}})));
        assert!(!is_voice_note(&json!({"msgtype":"m.audio","info":{"mimetype":"audio/mpeg"}})));
        assert!(!is_voice_note(&json!({"msgtype":"m.text"})));
    }

    #[test]
    fn mxc_urls() {
        assert_eq!(
            mxc_to_http("http://127.0.0.1:29300/", "mxc://server.org/AbC-1_x").unwrap(),
            "http://127.0.0.1:29300/_matrix/media/v3/download/server.org/AbC-1_x"
        );
        for bad in ["http://x/y", "mxc://only", "mxc://a/../b", "mxc://a/b/c", "mxc:///id", "mxc://a/b?x=1", "mxc://../id"] {
            assert!(mxc_to_http("http://h", bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn day_bounds_respect_offset() {
        let d = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        let (s, e) = day_bounds_ms(d, 0);
        assert_eq!(s, 1_772_323_200_000);
        assert_eq!(e - s, 86_400_000);
        let (s3, _) = day_bounds_ms(d, -3 * 3600);
        assert_eq!(s3, s + 3 * 3_600_000);
    }

    fn msg(ts: i64) -> Msg {
        Msg { sender: "@a:x".into(), ts, kind: Kind::Text, body: ts.to_string(), mxc: None, voice: false }
    }

    #[test]
    fn day_reader_stops_before_day_start() {
        let mut r = DayReader::new(1000, 2000);
        assert_eq!(r.feed(MessagePage { msgs: vec![msg(2500), msg(1900), msg(1500)], next: Some("a".into()) }), Next::More("a".into()));
        assert_eq!(r.feed(MessagePage { msgs: vec![msg(1200), msg(900), msg(800)], next: Some("b".into()) }), Next::Done);
        let got: Vec<i64> = r.finish().iter().map(|m| m.ts).collect();
        assert_eq!(got, vec![1200, 1500, 1900]);
    }

    #[test]
    fn day_reader_ends_without_token_and_caps_pages() {
        let mut r = DayReader::new(0, 10);
        assert_eq!(r.feed(MessagePage { msgs: vec![msg(5)], next: None }), Next::Done);
        let mut r = DayReader::new(0, 10);
        let mut last = Next::Done;
        for _ in 0..MAX_PAGES {
            last = r.feed(MessagePage { msgs: vec![], next: Some("t".into()) });
        }
        assert_eq!(last, Next::Done);
    }

    struct Canned {
        pages: Mutex<Vec<String>>,
        urls: Mutex<Vec<String>>,
    }
    impl Fetch for Canned {
        async fn get(&self, url: &str) -> Result<String> {
            self.urls.lock().unwrap().push(url.to_string());
            if url.contains("joined_rooms") {
                return Ok(r#"{"joined_rooms":["!a:x","!b:x"]}"#.into());
            }
            if url.contains("state/m.room.name") {
                return if url.contains("%21a") { Ok(r#"{"name":"Alpha"}"#.into()) } else { bail!("404") };
            }
            Ok(self.pages.lock().unwrap().remove(0))
        }
    }
    fn pg(ts: &[i64], end: Option<&str>) -> String {
        let chunk: Vec<Value> = ts
            .iter()
            .map(|t| json!({"type":"m.room.message","sender":"@a:x","origin_server_ts":t,"content":{"msgtype":"m.text","body":"b"}}))
            .collect();
        json!({"chunk": chunk, "end": end}).to_string()
    }

    #[tokio::test]
    async fn lists_rooms_with_fallback_names() {
        let f = Canned { pages: Mutex::new(vec![]), urls: Mutex::new(vec![]) };
        let r = list_rooms(&f, "http://h").await.unwrap();
        assert_eq!(r[0].name, "Alpha");
        assert_eq!(r[1].name, "!b:x");
    }

    #[tokio::test]
    async fn reads_a_whole_day_across_pages() {
        let d = NaiveDate::from_ymd_opt(1970, 1, 2).unwrap();
        let (s, e) = day_bounds_ms(d, 0);
        let f = Canned {
            pages: Mutex::new(vec![pg(&[e + 5, e - 1, s + 10], Some("p2")), pg(&[s + 5, s - 1], Some("p3"))]),
            urls: Mutex::new(vec![]),
        };
        let got = read_day(&f, "http://h", "!a:x", d, 0).await.unwrap();
        assert_eq!(got.iter().map(|m| m.ts).collect::<Vec<_>>(), vec![s + 5, s + 10, e - 1]);
        let urls = f.urls.lock().unwrap();
        assert_eq!(urls.len(), 2);
        assert!(urls[1].ends_with("&from=p2"));
    }

    #[test]
    fn module_has_no_send_function() {
        let src = include_str!("relay.rs");
        let code = src.split("#[cfg(test)]").next().unwrap();
        for needle in [["fn ", "send"].concat(), ["/", "send", "/"].concat(), ["m.room.message", "/"].concat(), "Method::PUT".to_string(), ".put(".to_string()] {
            assert!(!code.contains(&needle), "found {needle}");
        }
        let names = regex::Regex::new(r"fn\s+(\w+)").unwrap();
        for c in names.captures_iter(code) {
            assert!(!c[1].to_lowercase().contains("send") && !c[1].to_lowercase().contains("post"), "{}", &c[1]);
        }
    }
}
