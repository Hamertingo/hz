//! Gmail, Calendar and Drive over the reader's own OAuth app.
//!
//! The refresh token comes from the caller (a secrets file); nothing here stores it. Everything a
//! response carries (mail bodies, event titles, file text) is stranger-written text: the CALLER must
//! pass it through `crate::agentkit::untrusted::wrap` before an agent sees it. This module does not
//! import that wrapper on purpose, so the rule lives at one call site per tool.
//!
//! There is no way to send mail from here: only drafts are built, and no sending scope is ever asked for.

use anyhow::{anyhow, bail, Result};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fmt;
use std::future::Future;

pub const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GMAIL: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
/// The only write endpoint for mail: drafts. Nothing in this file names a send endpoint.
pub const DRAFTS_ENDPOINT: &str = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
pub const CALENDAR: &str = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
pub const DRIVE: &str = "https://www.googleapis.com/drive/v3/files";

/// Seconds before real expiry at which a cached token counts as stale.
pub const EXPIRY_SKEW_SECS: i64 = 60;

/// Whether a tool call runs on its own or stops to ask the reader first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActionClass {
    Free,
    Asks,
}

/// Every call this module can build, so the approval class lives next to the call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoogleAction {
    GmailSearch,
    GmailRead,
    GmailDraft,
    CalendarList,
    CalendarCreate,
    DriveSearch,
    DriveRead,
}

impl GoogleAction {
    /// Creating an event changes the reader's calendar and other people's, so it asks; the rest only read or write an unsent draft.
    pub fn class(self) -> ActionClass {
        match self {
            GoogleAction::CalendarCreate => ActionClass::Asks,
            _ => ActionClass::Free,
        }
    }
}

/// A feature the reader switched on; each maps to the smallest scope that serves it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feature {
    GmailRead,
    GmailDraft,
    CalendarRead,
    CalendarCreate,
    DriveRead,
    /// Labels and archiving for bulk organising; still no send and no delete.
    GmailOrganize,
}

/// The OAuth scopes for the chosen features, deduplicated and sorted, never wider than needed.
pub fn scopes_for(features: &[Feature]) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for f in features {
        let add: &[&'static str] = match f {
            Feature::GmailRead => &["https://www.googleapis.com/auth/gmail.readonly"],
            Feature::GmailDraft => &[
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/gmail.compose",
            ],
            Feature::CalendarRead => &["https://www.googleapis.com/auth/calendar.readonly"],
            Feature::CalendarCreate => &[
                "https://www.googleapis.com/auth/calendar.readonly",
                "https://www.googleapis.com/auth/calendar.events",
            ],
            Feature::DriveRead => &["https://www.googleapis.com/auth/drive.readonly"],
            Feature::GmailOrganize => &["https://www.googleapis.com/auth/gmail.modify"],
        };
        for s in add {
            if !out.contains(s) {
                out.push(s);
            }
        }
    }
    out.sort_unstable();
    out
}

/// The reader's own OAuth client plus a refresh token; Debug never shows the secrets.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoogleAuth {
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: String,
}

impl fmt::Debug for GoogleAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("GoogleAuth")
            .field("client_id", &self.client_id)
            .field("client_secret", &"<redacted>")
            .field("refresh_token", &"<redacted>")
            .finish()
    }
}

fn form(pairs: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(pairs.iter().copied())
        .finish()
}

/// Form body for the refresh-token grant.
pub fn token_request_body(auth: &GoogleAuth) -> String {
    form(&[
        ("client_id", &auth.client_id),
        ("client_secret", &auth.client_secret),
        ("refresh_token", &auth.refresh_token),
        ("grant_type", "refresh_token"),
    ])
}

/// A bearer token and the instant it stops working.
#[derive(Clone, PartialEq, Eq)]
pub struct AccessToken {
    pub value: String,
    pub expires_at: DateTime<Utc>,
}

impl fmt::Debug for AccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AccessToken")
            .field("value", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

impl AccessToken {
    /// True while the token has more than the skew left.
    pub fn is_fresh(&self, now: DateTime<Utc>) -> bool {
        now + Duration::seconds(EXPIRY_SKEW_SECS) < self.expires_at
    }
}

/// Reads the token endpoint's answer; an `error` body becomes an error carrying Google's words.
pub fn parse_token_response(json: &str, now: DateTime<Utc>) -> Result<AccessToken> {
    let v: Value = serde_json::from_str(json).map_err(|e| anyhow!("token response is not JSON: {e}"))?;
    if let Some(err) = v.get("error").and_then(Value::as_str) {
        let desc = v.get("error_description").and_then(Value::as_str).unwrap_or("");
        bail!("google refused the token request: {err} {desc}");
    }
    let value = v
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("token response has no access_token"))?;
    let secs = v.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
    Ok(AccessToken {
        value: value.to_string(),
        expires_at: now + Duration::seconds(secs),
    })
}

/// The one network seam: form POST in, response text out.
pub trait HttpClient {
    fn post_form(&self, url: &str, body: &str) -> impl Future<Output = Result<String>> + Send;
}

/// Real client over reqwest.
pub struct ReqwestClient(pub reqwest::Client);

impl HttpClient for ReqwestClient {
    async fn post_form(&self, url: &str, body: &str) -> Result<String> {
        let resp = self
            .0
            .post(url)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body.to_string())
            .send()
            .await?;
        Ok(resp.text().await?)
    }
}

/// Holds one access token and trades the refresh token for a new one when it nears expiry.
#[derive(Default)]
pub struct TokenCache {
    token: Option<AccessToken>,
}

impl TokenCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns a usable bearer value, refreshing when within 60 s of expiry.
    pub async fn get<H: HttpClient>(&mut self, http: &H, auth: &GoogleAuth, now: DateTime<Utc>) -> Result<String> {
        if let Some(t) = &self.token {
            if t.is_fresh(now) {
                return Ok(t.value.clone());
            }
        }
        let text = http.post_form(TOKEN_URL, &token_request_body(auth)).await?;
        let t = parse_token_response(&text, now)?;
        let v = t.value.clone();
        self.token = Some(t);
        Ok(v)
    }

    /// Forgets the cached token, e.g. after a 401.
    pub fn invalidate(&mut self) {
        self.token = None;
    }
}

fn with_params(base: &str, params: &[(&str, &str)]) -> String {
    let mut u = url::Url::parse(base).expect("constant base url");
    u.query_pairs_mut().extend_pairs(params.iter().copied());
    u.into()
}

/// A parsed message, headers flattened and body decoded to text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Mail {
    pub id: String,
    pub from: String,
    pub to: String,
    pub subject: String,
    pub date: String,
    pub snippet: String,
    pub body_text: String,
}

/// URL listing message ids that match a Gmail search query.
pub fn gmail_search_url(query: &str, max: u32) -> String {
    with_params(
        &format!("{GMAIL}/messages"),
        &[("q", query), ("maxResults", &max.clamp(1, 100).to_string())],
    )
}

/// URL for one full message.
pub fn gmail_message_url(id: &str) -> String {
    with_params(&format!("{GMAIL}/messages/{}", encode_segment(id)), &[("format", "full")])
}

fn encode_segment(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// One page of up to 500 message ids for a bulk job; `page` is the previous reply's `nextPageToken`.
pub fn gmail_ids_page_url(query: &str, page: Option<&str>) -> String {
    let mut p = vec![("q", query), ("maxResults", "500")];
    if let Some(t) = page {
        p.push(("pageToken", t));
    }
    with_params(&format!("{GMAIL}/messages"), &p)
}

/// The ids of one page and the token for the next, `None` on the last page.
pub fn parse_message_page(json: &str) -> Result<(Vec<String>, Option<String>)> {
    let ids = parse_message_list(json)?;
    let v: Value = serde_json::from_str(json)?;
    Ok((ids, v.get("nextPageToken").and_then(Value::as_str).map(String::from)))
}

/// URL for a message's headers only, enough for a preview row.
pub fn gmail_headers_url(id: &str) -> String {
    let mut u = url::Url::parse(&format!("{GMAIL}/messages/{}", encode_segment(id))).expect("constant base url");
    u.query_pairs_mut()
        .append_pair("format", "metadata")
        .append_pair("metadataHeaders", "From")
        .append_pair("metadataHeaders", "Subject");
    u.into()
}

/// URL that lists, and with a POST creates, the reader's labels.
pub const LABELS_URL: &str = "https://gmail.googleapis.com/gmail/v1/users/me/labels";

/// The id of the label called `name` (case-insensitive) in a `labels.list` reply.
pub fn find_label(json: &str, name: &str) -> Result<Option<String>> {
    let v: Value = serde_json::from_str(json)?;
    Ok(v.get("labels").and_then(Value::as_array).and_then(|ls| {
        ls.iter()
            .find(|l| l.get("name").and_then(Value::as_str).is_some_and(|n| n.eq_ignore_ascii_case(name.trim())))
            .and_then(|l| l.get("id").and_then(Value::as_str).map(String::from))
    }))
}

/// Body for `labels.create`.
pub fn create_label_body(name: &str) -> Value {
    json!({ "name": name.trim(), "labelListVisibility": "labelShow", "messageListVisibility": "show" })
}

/// Message ids out of a `messages.list` reply; an empty result has no `messages` key at all.
pub fn parse_message_list(json: &str) -> Result<Vec<String>> {
    let v: Value = serde_json::from_str(json)?;
    Ok(v.get("messages")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|m| m.get("id").and_then(Value::as_str).map(String::from)).collect())
        .unwrap_or_default())
}

fn decode_b64url(s: &str) -> Option<String> {
    let bytes = URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn header(payload: &Value, name: &str) -> String {
    payload
        .get("headers")
        .and_then(Value::as_array)
        .and_then(|hs| {
            hs.iter().find(|h| {
                h.get("name").and_then(Value::as_str).is_some_and(|n| n.eq_ignore_ascii_case(name))
            })
        })
        .and_then(|h| h.get("value").and_then(Value::as_str))
        .unwrap_or("")
        .to_string()
}

fn collect_bodies(part: &Value, plain: &mut Vec<String>, html: &mut Vec<String>) {
    let mime = part.get("mimeType").and_then(Value::as_str).unwrap_or("");
    let has_file = part.get("filename").and_then(Value::as_str).is_some_and(|f| !f.is_empty());
    if !has_file {
        if let Some(text) = part.pointer("/body/data").and_then(Value::as_str).and_then(decode_b64url) {
            match mime {
                "text/plain" => plain.push(text),
                "text/html" => html.push(text),
                _ => {}
            }
        }
    }
    if let Some(parts) = part.get("parts").and_then(Value::as_array) {
        for p in parts {
            collect_bodies(p, plain, html);
        }
    }
}

/// Crude tag stripper for the HTML-only mail case; scripts and styles go with their content.
pub fn strip_html(html: &str) -> String {
    let block = regex::Regex::new(r"(?is)<(script|style|head)[^>]*>.*?</(script|style|head)>").unwrap();
    let breaks = regex::Regex::new(r"(?i)<br\s*/?>|</p>|</div>|</li>|</tr>|</h[1-6]>").unwrap();
    let tags = regex::Regex::new(r"(?s)<[^>]*>").unwrap();
    let s = block.replace_all(html, " ");
    let s = breaks.replace_all(&s, "\n");
    let s = tags.replace_all(&s, "");
    let s = s
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    let lines: Vec<String> = s
        .lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect();
    let mut out = String::new();
    let mut blank = 0;
    for l in lines {
        if l.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push_str(&l);
        out.push('\n');
    }
    out.trim().to_string()
}

/// Turns a `format=full` message into a [`Mail`], preferring text/plain over stripped HTML.
pub fn parse_message(json: &str) -> Result<Mail> {
    let v: Value = serde_json::from_str(json)?;
    let id = v.get("id").and_then(Value::as_str).ok_or_else(|| anyhow!("message has no id"))?;
    let payload = v.get("payload").cloned().unwrap_or(Value::Null);
    let (mut plain, mut html) = (Vec::new(), Vec::new());
    collect_bodies(&payload, &mut plain, &mut html);
    let body_text = if !plain.is_empty() {
        plain.join("\n")
    } else {
        html.iter().map(|h| strip_html(h)).collect::<Vec<_>>().join("\n")
    };
    Ok(Mail {
        id: id.to_string(),
        from: header(&payload, "From"),
        to: header(&payload, "To"),
        subject: header(&payload, "Subject"),
        date: header(&payload, "Date"),
        snippet: v.get("snippet").and_then(Value::as_str).unwrap_or("").to_string(),
        body_text,
    })
}

/// A file to attach to a draft.
#[derive(Debug, Clone)]
pub struct Attachment {
    pub filename: String,
    pub mime: String,
    pub data: Vec<u8>,
}

fn no_crlf(label: &str, s: &str) -> Result<()> {
    if s.contains('\r') || s.contains('\n') {
        bail!("{label} must be one line");
    }
    Ok(())
}

fn encoded_word(s: &str) -> String {
    if s.is_ascii() {
        s.to_string()
    } else {
        format!("=?UTF-8?B?{}?=", STANDARD.encode(s))
    }
}

fn wrap76(s: &str) -> String {
    s.as_bytes()
        .chunks(76)
        .map(|c| String::from_utf8_lossy(c).into_owned())
        .collect::<Vec<_>>()
        .join("\r\n")
}

/// RFC 2822 message, base64url-encoded as Gmail's draft `raw` field wants; header injection is refused.
pub fn draft_body(to: &str, subject: &str, body: &str, attachments: &[Attachment]) -> Result<String> {
    no_crlf("to", to)?;
    no_crlf("subject", subject)?;
    for a in attachments {
        no_crlf("attachment name", &a.filename)?;
        no_crlf("attachment type", &a.mime)?;
        if a.filename.contains('"') {
            bail!("attachment name must not contain quotes");
        }
    }
    let mut m = String::new();
    m.push_str(&format!("To: {to}\r\nSubject: {}\r\nMIME-Version: 1.0\r\n", encoded_word(subject)));
    let body_b64 = wrap76(&STANDARD.encode(body));
    if attachments.is_empty() {
        m.push_str("Content-Type: text/plain; charset=\"UTF-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n");
        m.push_str(&body_b64);
    } else {
        let boundary = format!("hz-{}", uuid::Uuid::new_v4().simple());
        m.push_str(&format!("Content-Type: multipart/mixed; boundary=\"{boundary}\"\r\n\r\n"));
        m.push_str(&format!(
            "--{boundary}\r\nContent-Type: text/plain; charset=\"UTF-8\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{body_b64}\r\n"
        ));
        for a in attachments {
            m.push_str(&format!(
                "--{boundary}\r\nContent-Type: {}; name=\"{}\"\r\nContent-Disposition: attachment; filename=\"{}\"\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n",
                a.mime,
                a.filename,
                a.filename,
                wrap76(&STANDARD.encode(&a.data))
            ));
        }
        m.push_str(&format!("--{boundary}--"));
    }
    Ok(URL_SAFE_NO_PAD.encode(m.as_bytes()))
}

/// JSON body for `drafts.create`.
pub fn draft_request_json(raw: &str) -> Value {
    json!({ "message": { "raw": raw } })
}

/// One calendar entry; all-day events carry a date in `start`, timed ones an RFC 3339 time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct CalEvent {
    pub id: String,
    pub summary: String,
    pub start: String,
    pub end: String,
    pub location: String,
    pub attendees: Vec<String>,
}

/// URL listing events between two RFC 3339 times, recurring ones expanded.
pub fn events_url(time_min: &str, time_max: &str) -> String {
    with_params(
        CALENDAR,
        &[
            ("timeMin", time_min),
            ("timeMax", time_max),
            ("singleEvents", "true"),
            ("orderBy", "startTime"),
        ],
    )
}

/// Events out of an `events.list` reply.
pub fn parse_events(json: &str) -> Result<Vec<CalEvent>> {
    let v: Value = serde_json::from_str(json)?;
    let time = |e: &Value, k: &str| -> String {
        e.pointer(&format!("/{k}/dateTime"))
            .or_else(|| e.pointer(&format!("/{k}/date")))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let s = |e: &Value, k: &str| e.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Ok(v.get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|e| CalEvent {
                    id: s(e, "id"),
                    summary: e.get("summary").and_then(Value::as_str).unwrap_or("(no title)").to_string(),
                    start: time(e, "start"),
                    end: time(e, "end"),
                    location: s(e, "location"),
                    attendees: e
                        .get("attendees")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(|x| x.get("email").and_then(Value::as_str).map(String::from)).collect())
                        .unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default())
}

/// Body for `events.insert`. Callers must confirm with the reader first: see [`GoogleAction::class`].
pub fn create_event_body(summary: &str, start: &str, end: &str, time_zone: &str, attendees: &[String]) -> Value {
    let mut v = json!({
        "summary": summary,
        "start": { "dateTime": start, "timeZone": time_zone },
        "end": { "dateTime": end, "timeZone": time_zone },
    });
    if !attendees.is_empty() {
        v["attendees"] = attendees.iter().map(|e| json!({ "email": e })).collect();
    }
    v
}

/// A Drive file's listing fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub modified: String,
    pub link: String,
}

/// Escapes text for use inside a single-quoted Drive query literal.
pub fn drive_literal(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}

/// URL for a Drive full-text search of non-trashed files.
pub fn drive_search_url(text: &str, max: u32) -> String {
    let q = format!("fullText contains '{}' and trashed = false", drive_literal(text));
    with_params(
        DRIVE,
        &[
            ("q", &q),
            ("pageSize", &max.clamp(1, 100).to_string()),
            ("fields", "files(id,name,mimeType,modifiedTime,webViewLink)"),
        ],
    )
}

/// Files out of a `files.list` reply.
pub fn parse_files(json: &str) -> Result<Vec<DriveFile>> {
    let v: Value = serde_json::from_str(json)?;
    let s = |e: &Value, k: &str| e.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Ok(v.get("files")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|f| DriveFile {
                    id: s(f, "id"),
                    name: s(f, "name"),
                    mime_type: s(f, "mimeType"),
                    modified: s(f, "modifiedTime"),
                    link: s(f, "webViewLink"),
                })
                .collect()
        })
        .unwrap_or_default())
}

/// Plain-text export URL for a Google Doc (text), Sheet (CSV) or Slides deck (text); `None` for other types, which download as-is.
pub fn export_text_url(file_id: &str, mime: &str) -> Option<String> {
    let target = match mime {
        "application/vnd.google-apps.document" | "application/vnd.google-apps.presentation" => "text/plain",
        "application/vnd.google-apps.spreadsheet" => "text/csv",
        _ => return None,
    };
    Some(with_params(
        &format!("{DRIVE}/{}/export", encode_segment(file_id)),
        &[("mimeType", target)],
    ))
}

/// URL for a file's name and type.
pub fn file_meta_url(file_id: &str) -> String {
    with_params(&format!("{DRIVE}/{}", encode_segment(file_id)), &[("fields", "id,name,mimeType")])
}

/// Raw-content URL for binary or plain files.
pub fn download_url(file_id: &str) -> String {
    with_params(&format!("{DRIVE}/{}", encode_segment(file_id)), &[("alt", "media")])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn auth() -> GoogleAuth {
        GoogleAuth { client_id: "cid".into(), client_secret: "sec ret&".into(), refresh_token: "r/t".into() }
    }
    fn t0() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap().with_timezone(&Utc)
    }
    fn b64(s: &str) -> String {
        URL_SAFE_NO_PAD.encode(s)
    }

    #[test]
    fn token_body_is_form_encoded() {
        let b = token_request_body(&auth());
        assert!(b.contains("grant_type=refresh_token"));
        assert!(b.contains("client_secret=sec+ret%26"));
        assert!(b.contains("refresh_token=r%2Ft"));
    }

    #[test]
    fn debug_hides_secrets() {
        let d = format!("{:?}", auth());
        assert!(!d.contains("sec ret") && !d.contains("r/t"));
        assert!(d.contains("cid"));
    }

    #[test]
    fn token_response_sets_expiry() {
        let t = parse_token_response(r#"{"access_token":"abc","expires_in":3599}"#, t0()).unwrap();
        assert_eq!(t.value, "abc");
        assert_eq!(t.expires_at, t0() + Duration::seconds(3599));
        assert!(!format!("{t:?}").contains("abc"));
    }

    #[test]
    fn token_response_errors() {
        let e = parse_token_response(r#"{"error":"invalid_grant","error_description":"revoked"}"#, t0()).unwrap_err();
        assert!(e.to_string().contains("invalid_grant"));
        assert!(parse_token_response("{}", t0()).is_err());
        assert!(parse_token_response("nope", t0()).is_err());
    }

    #[test]
    fn freshness_uses_skew() {
        let t = AccessToken { value: "x".into(), expires_at: t0() + Duration::seconds(100) };
        assert!(t.is_fresh(t0()));
        assert!(t.is_fresh(t0() + Duration::seconds(39)));
        assert!(!t.is_fresh(t0() + Duration::seconds(40)));
        assert!(!t.is_fresh(t0() + Duration::seconds(200)));
    }

    struct Fake {
        calls: Mutex<u32>,
        reply: String,
    }
    impl HttpClient for Fake {
        async fn post_form(&self, url: &str, body: &str) -> Result<String> {
            assert_eq!(url, TOKEN_URL);
            assert!(body.contains("refresh_token"));
            *self.calls.lock().unwrap() += 1;
            Ok(self.reply.clone())
        }
    }

    #[tokio::test]
    async fn cache_reuses_then_refreshes() {
        let f = Fake { calls: Mutex::new(0), reply: r#"{"access_token":"tok","expires_in":3600}"#.into() };
        let mut c = TokenCache::new();
        assert_eq!(c.get(&f, &auth(), t0()).await.unwrap(), "tok");
        c.get(&f, &auth(), t0() + Duration::seconds(3000)).await.unwrap();
        assert_eq!(*f.calls.lock().unwrap(), 1);
        c.get(&f, &auth(), t0() + Duration::seconds(3550)).await.unwrap();
        assert_eq!(*f.calls.lock().unwrap(), 2);
        c.invalidate();
        c.get(&f, &auth(), t0() + Duration::seconds(3551)).await.unwrap();
        assert_eq!(*f.calls.lock().unwrap(), 3);
    }

    #[tokio::test]
    async fn cache_propagates_errors_and_keeps_nothing() {
        let f = Fake { calls: Mutex::new(0), reply: r#"{"error":"invalid_grant"}"#.into() };
        let mut c = TokenCache::new();
        assert!(c.get(&f, &auth(), t0()).await.is_err());
        assert!(c.get(&f, &auth(), t0()).await.is_err());
        assert_eq!(*f.calls.lock().unwrap(), 2);
    }

    #[test]
    fn scopes_are_minimal_and_never_send() {
        let s = scopes_for(&[Feature::GmailRead]);
        assert_eq!(s, vec!["https://www.googleapis.com/auth/gmail.readonly"]);
        let s = scopes_for(&[Feature::GmailRead, Feature::GmailDraft, Feature::DriveRead]);
        assert_eq!(s.len(), 3);
        assert!(s.iter().all(|x| !x.contains("gmail.send") && !x.contains("mail.google.com")));
        assert!(scopes_for(&[]).is_empty());
        let c = scopes_for(&[Feature::CalendarRead, Feature::CalendarCreate]);
        assert_eq!(c.len(), 2);
        assert!(c.contains(&"https://www.googleapis.com/auth/calendar.events"));
    }

    #[test]
    fn only_create_event_asks() {
        assert_eq!(GoogleAction::CalendarCreate.class(), ActionClass::Asks);
        for a in [
            GoogleAction::GmailSearch,
            GoogleAction::GmailRead,
            GoogleAction::GmailDraft,
            GoogleAction::CalendarList,
            GoogleAction::DriveSearch,
            GoogleAction::DriveRead,
        ] {
            assert_eq!(a.class(), ActionClass::Free);
        }
    }

    #[test]
    fn no_send_endpoint_anywhere() {
        let src = include_str!("google.rs");
        let code = src.split("#[cfg(test)]").next().unwrap();
        let needle_a = ["messages", "send"].join("/");
        let needle_b = ["messages", "send"].join(".");
        let needle_c = ["gmail", "send"].join(".");
        assert!(!code.contains(&needle_a) && !code.contains(&needle_b) && !code.contains(&needle_c));
        assert!(!code.contains("/send"));
        assert!(DRAFTS_ENDPOINT.ends_with("/drafts"));
    }

    #[test]
    fn search_url_encodes_query_and_clamps() {
        let u = gmail_search_url("from:a@b.com subject:\"x y\"", 500);
        assert!(u.starts_with("https://gmail.googleapis.com/gmail/v1/users/me/messages?q="));
        assert!(u.contains("maxResults=100"));
        assert!(!u.contains(' ') && !u.contains('"'));
        assert!(gmail_search_url("a", 0).contains("maxResults=1"));
    }

    #[test]
    fn message_list_handles_empty() {
        assert_eq!(parse_message_list(r#"{"messages":[{"id":"a"},{"id":"b"}]}"#).unwrap(), vec!["a", "b"]);
        assert!(parse_message_list(r#"{"resultSizeEstimate":0}"#).unwrap().is_empty());
        assert!(parse_message_list("x").is_err());
    }

    #[test]
    fn message_prefers_plain_text() {
        let j = json!({
            "id": "m1", "snippet": "hi",
            "payload": {
                "mimeType": "multipart/alternative",
                "headers": [
                    {"name": "from", "value": "A <a@x.com>"},
                    {"name": "To", "value": "b@x.com"},
                    {"name": "Subject", "value": "Hello"},
                    {"name": "Date", "value": "Mon, 1 Jan 2026"}
                ],
                "parts": [
                    {"mimeType": "text/html", "body": {"data": b64("<p>html body</p>")}},
                    {"mimeType": "text/plain", "body": {"data": b64("plain body")}}
                ]
            }
        });
        let m = parse_message(&j.to_string()).unwrap();
        assert_eq!(m.body_text, "plain body");
        assert_eq!(m.from, "A <a@x.com>");
        assert_eq!(m.subject, "Hello");
        assert_eq!(m.snippet, "hi");
    }

    #[test]
    fn message_falls_back_to_stripped_html_and_nested_parts() {
        let j = json!({
            "id": "m2",
            "payload": {
                "mimeType": "multipart/mixed",
                "parts": [
                    {"mimeType": "multipart/alternative", "parts": [
                        {"mimeType": "text/html", "body": {"data": b64("<style>p{}</style><p>Hi &amp; bye</p><script>evil()</script><p>Two</p>")}}
                    ]},
                    {"mimeType": "text/plain", "filename": "notes.txt", "body": {"data": b64("attached")}}
                ]
            }
        });
        let m = parse_message(&j.to_string()).unwrap();
        assert_eq!(m.body_text, "Hi & bye\nTwo");
    }

    #[test]
    fn message_without_payload_or_id() {
        assert!(parse_message("{}").is_err());
        let m = parse_message(r#"{"id":"z"}"#).unwrap();
        assert_eq!(m.body_text, "");
    }

    #[test]
    fn base64_with_padding_decodes() {
        assert_eq!(decode_b64url("aGk=").unwrap(), "hi");
        assert_eq!(decode_b64url("aGk").unwrap(), "hi");
        assert!(decode_b64url("!!").is_none());
    }

    #[test]
    fn draft_is_decodable_rfc2822() {
        let raw = draft_body("a@b.com", "Hi", "hello there", &[]).unwrap();
        let text = String::from_utf8(URL_SAFE_NO_PAD.decode(raw).unwrap()).unwrap();
        assert!(text.starts_with("To: a@b.com\r\nSubject: Hi\r\n"));
        let body = text.split("\r\n\r\n").nth(1).unwrap().replace("\r\n", "");
        assert_eq!(String::from_utf8(STANDARD.decode(body).unwrap()).unwrap(), "hello there");
    }

    #[test]
    fn draft_encodes_non_ascii_subject_and_refuses_injection() {
        let raw = draft_body("a@b.com", "Olá", "x", &[]).unwrap();
        let text = String::from_utf8(URL_SAFE_NO_PAD.decode(raw).unwrap()).unwrap();
        assert!(text.contains("Subject: =?UTF-8?B?"));
        assert!(draft_body("a@b.com\r\nBcc: z@z.com", "s", "b", &[]).is_err());
        assert!(draft_body("a@b.com", "s\nBcc: z", "b", &[]).is_err());
    }

    #[test]
    fn draft_with_attachment_is_multipart() {
        let a = Attachment { filename: "r.pdf".into(), mime: "application/pdf".into(), data: vec![1, 2, 3] };
        let raw = draft_body("a@b.com", "S", "b", &[a]).unwrap();
        let text = String::from_utf8(URL_SAFE_NO_PAD.decode(raw).unwrap()).unwrap();
        assert!(text.contains("multipart/mixed"));
        assert!(text.contains("filename=\"r.pdf\""));
        assert!(text.contains(&STANDARD.encode([1u8, 2, 3])));
        assert!(text.trim_end().ends_with("--"));
        let bad = Attachment { filename: "a\".pdf".into(), mime: "x/y".into(), data: vec![] };
        assert!(draft_body("a@b.com", "S", "b", &[bad]).is_err());
        assert_eq!(draft_request_json("RAW")["message"]["raw"], "RAW");
    }

    #[test]
    fn calendar_url_and_parse() {
        let u = events_url("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z");
        assert!(u.contains("singleEvents=true") && u.contains("timeMin=2026-01-01T00%3A00%3A00Z"));
        let evs = parse_events(
            r#"{"items":[{"id":"1","summary":"Standup","start":{"dateTime":"2026-01-01T09:00:00Z"},"end":{"dateTime":"2026-01-01T09:15:00Z"},"attendees":[{"email":"a@x.com"}]},
                {"id":"2","start":{"date":"2026-01-02"},"end":{"date":"2026-01-03"}}]}"#,
        )
        .unwrap();
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].attendees, vec!["a@x.com"]);
        assert_eq!(evs[1].summary, "(no title)");
        assert_eq!(evs[1].start, "2026-01-02");
        assert!(parse_events("{}").unwrap().is_empty());
    }

    #[test]
    fn create_event_body_shape() {
        let b = create_event_body("Lunch", "2026-01-01T12:00:00", "2026-01-01T13:00:00", "America/Sao_Paulo", &[]);
        assert_eq!(b["start"]["timeZone"], "America/Sao_Paulo");
        assert!(b.get("attendees").is_none());
        let b = create_event_body("L", "s", "e", "UTC", &["a@x.com".into()]);
        assert_eq!(b["attendees"][0]["email"], "a@x.com");
    }

    #[test]
    fn drive_search_escapes_quotes() {
        assert_eq!(drive_literal("it's \\ ok"), "it\\'s \\\\ ok");
        let u = drive_search_url("a' or name contains 'b", 10);
        let q = url::Url::parse(&u).unwrap().query_pairs().find(|(k, _)| k == "q").unwrap().1.into_owned();
        assert_eq!(q, "fullText contains 'a\\' or name contains \\'b' and trashed = false");
        assert!(u.contains("pageSize=10"));
    }

    #[test]
    fn drive_parse_and_export() {
        let f = parse_files(r#"{"files":[{"id":"1","name":"Plan","mimeType":"application/vnd.google-apps.document","webViewLink":"https://x"}]}"#).unwrap();
        assert_eq!(f[0].name, "Plan");
        assert!(parse_files("{}").unwrap().is_empty());
        let d = export_text_url("1", "application/vnd.google-apps.document").unwrap();
        assert!(d.contains("/1/export") && d.contains("mimeType=text%2Fplain"));
        let s = export_text_url("2", "application/vnd.google-apps.spreadsheet").unwrap();
        assert!(s.contains("text%2Fcsv"));
        assert!(export_text_url("3", "application/vnd.google-apps.presentation").unwrap().contains("text%2Fplain"));
        assert!(export_text_url("4", "application/pdf").is_none());
        assert!(download_url("a/b").contains("a%2Fb") && download_url("x").contains("alt=media"));
        assert!(file_meta_url("a/b").contains("a%2Fb") && file_meta_url("x").contains("fields=id%2Cname%2CmimeType"));
    }

    #[test]
    fn bulk_pages_and_labels() {
        let u = gmail_ids_page_url("older_than:1y", Some("t2"));
        assert!(u.contains("maxResults=500") && u.contains("pageToken=t2"));
        assert!(!gmail_ids_page_url("x", None).contains("pageToken"));
        let (ids, next) = parse_message_page(r#"{"messages":[{"id":"a"}],"nextPageToken":"n"}"#).unwrap();
        assert_eq!((ids, next.as_deref()), (vec!["a".to_string()], Some("n")));
        assert_eq!(parse_message_page("{}").unwrap().1, None);
        let h = gmail_headers_url("m/1");
        assert!(h.contains("m%2F1") && h.contains("format=metadata") && h.contains("metadataHeaders=Subject"));
        let labels = r#"{"labels":[{"id":"INBOX","name":"INBOX"},{"id":"Label_3","name":"Receipts"}]}"#;
        assert_eq!(find_label(labels, " receipts ").unwrap().as_deref(), Some("Label_3"));
        assert_eq!(find_label(labels, "Nope").unwrap(), None);
        assert_eq!(create_label_body(" Receipts ")["name"], "Receipts");
        let s = scopes_for(&[Feature::GmailOrganize]);
        assert_eq!(s, vec!["https://www.googleapis.com/auth/gmail.modify"]);
    }

    #[test]
    fn strip_html_collapses() {
        assert_eq!(strip_html("<div>a</div><div>   b   c </div>"), "a\nb c");
        assert_eq!(strip_html("x &lt;y&gt;&nbsp;z"), "x <y> z");
    }
}
