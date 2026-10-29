//! Browse and download from Frame.io (V4) with the reader's own Adobe app.
//!
//! Auth is the refresh-token grant against Adobe's token endpoint, with the refresh token supplied
//! by the caller. Everything here is URL building, reply parsing, download planning and a progress
//! state machine; the network sits behind [`HttpClient`]. Names and comments in the account are
//! other people's text: callers wrap them with `crate::agentkit::untrusted::wrap` for agents.

use anyhow::{anyhow, bail, Result};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fmt;
use std::future::Future;

pub const API_BASE: &str = "https://api.frame.io/v4";
pub const TOKEN_URL: &str = "https://ims-na1.adobelogin.com/ims/token/v3";
/// Seconds before real expiry at which a cached token counts as stale.
pub const EXPIRY_SKEW_SECS: i64 = 60;
/// Deepest folder nesting a walk will follow.
pub const MAX_DEPTH: usize = 20;

/// The reader's Adobe app and refresh token; Debug hides the secrets.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrameAuth {
    pub client_id: String,
    pub client_secret: String,
    pub refresh_token: String,
}

impl fmt::Debug for FrameAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FrameAuth")
            .field("client_id", &self.client_id)
            .field("client_secret", &"<redacted>")
            .field("refresh_token", &"<redacted>")
            .finish()
    }
}

/// Form body for the refresh-token grant.
pub fn token_request_body(auth: &FrameAuth) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .append_pair("grant_type", "refresh_token")
        .append_pair("client_id", &auth.client_id)
        .append_pair("client_secret", &auth.client_secret)
        .append_pair("refresh_token", &auth.refresh_token)
        .finish()
}

/// A bearer token and when it stops working.
#[derive(Clone, PartialEq, Eq)]
pub struct AccessToken {
    pub value: String,
    pub expires_at: DateTime<Utc>,
}

impl fmt::Debug for AccessToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AccessToken").field("value", &"<redacted>").field("expires_at", &self.expires_at).finish()
    }
}

impl AccessToken {
    /// True while more than the skew remains.
    pub fn is_fresh(&self, now: DateTime<Utc>) -> bool {
        now + Duration::seconds(EXPIRY_SKEW_SECS) < self.expires_at
    }
}

/// Reads Adobe's token reply; an `error` body becomes an error.
pub fn parse_token_response(json: &str, now: DateTime<Utc>) -> Result<AccessToken> {
    let v: Value = serde_json::from_str(json).map_err(|e| anyhow!("token reply is not JSON: {e}"))?;
    if let Some(err) = v.get("error").and_then(Value::as_str) {
        let d = v.get("error_description").and_then(Value::as_str).unwrap_or("");
        bail!("adobe refused the token request: {err} {d}");
    }
    let value = v
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("token reply has no access_token"))?;
    let secs = v.get("expires_in").and_then(Value::as_i64).unwrap_or(3600);
    Ok(AccessToken { value: value.to_string(), expires_at: now + Duration::seconds(secs) })
}

/// The network seam.
pub trait HttpClient {
    fn post_form(&self, url: &str, body: &str) -> impl Future<Output = Result<String>> + Send;
    fn get(&self, url: &str, bearer: &str) -> impl Future<Output = Result<String>> + Send;
}

/// Real client over reqwest.
pub struct ReqwestClient(pub reqwest::Client);

impl HttpClient for ReqwestClient {
    async fn post_form(&self, url: &str, body: &str) -> Result<String> {
        let resp: reqwest::Response = self
            .0
            .post(url)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body.to_string())
            .send()
            .await?;
        let text: String = resp.text().await?;
        Ok(text)
    }

    async fn get(&self, url: &str, bearer: &str) -> Result<String> {
        let resp: reqwest::Response = self.0.get(url).bearer_auth(bearer).send().await?;
        if !resp.status().is_success() {
            bail!("frame.io answered {}", resp.status());
        }
        let text: String = resp.text().await?;
        Ok(text)
    }
}

/// Holds one token and refreshes it inside the last minute.
#[derive(Default)]
pub struct TokenCache {
    token: Option<AccessToken>,
}

impl TokenCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// A usable bearer value, refreshing when needed.
    pub async fn get<H: HttpClient>(&mut self, http: &H, auth: &FrameAuth, now: DateTime<Utc>) -> Result<String> {
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
}

fn seg(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Accounts the token can see.
pub fn accounts_url() -> String {
    format!("{API_BASE}/accounts")
}

/// Workspaces of an account.
pub fn workspaces_url(account: &str) -> String {
    format!("{API_BASE}/accounts/{}/workspaces", seg(account))
}

/// Projects of a workspace.
pub fn projects_url(account: &str, workspace: &str) -> String {
    format!("{API_BASE}/accounts/{}/workspaces/{}/projects", seg(account), seg(workspace))
}

/// Children (folders, files, version stacks) of a folder, with download links included.
pub fn folder_children_url(account: &str, folder: &str) -> String {
    format!("{API_BASE}/accounts/{}/folders/{}/children?include=media_links.original&page_size=100", seg(account), seg(folder))
}

/// One folder.
pub fn folder_url(account: &str, folder: &str) -> String {
    format!("{API_BASE}/accounts/{}/folders/{}", seg(account), seg(folder))
}

/// One file with its original-quality download link.
pub fn file_url(account: &str, file: &str) -> String {
    format!("{API_BASE}/accounts/{}/files/{}?include=media_links.original", seg(account), seg(file))
}

/// The versions inside a version stack.
pub fn version_stack_children_url(account: &str, stack: &str) -> String {
    format!("{API_BASE}/accounts/{}/version_stacks/{}/children?include=media_links.original&page_size=100", seg(account), seg(stack))
}

/// A share link's details.
pub fn share_url(account: &str, share: &str) -> String {
    format!("{API_BASE}/accounts/{}/shares/{}", seg(account), seg(share))
}

/// Turns a reply's `links.next` (often a bare path) into a full URL on the API host.
pub fn resolve_next(next: &str) -> Option<String> {
    if next.starts_with("https://api.frame.io/") {
        Some(next.to_string())
    } else if next.starts_with('/') && !next.starts_with("//") {
        Some(format!("https://api.frame.io{next}"))
    } else {
        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntryKind {
    Folder,
    File,
    VersionStack,
    Other,
}

/// One row of any listing: an account, workspace, project, folder, file or stack.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    pub created_at: String,
    pub download_url: Option<String>,
    pub root_folder_id: Option<String>,
}

/// A page of rows and the URL of the next page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page {
    pub entries: Vec<Entry>,
    pub next: Option<String>,
}

/// Reads `{data:[...], links:{next}}` listings; a single object under `data` counts as a one-row page.
pub fn parse_list(json: &str) -> Result<Page> {
    let v: Value = serde_json::from_str(json)?;
    let data = v.get("data").ok_or_else(|| anyhow!("reply has no data"))?;
    let rows: Vec<&Value> = match data {
        Value::Array(a) => a.iter().collect(),
        o @ Value::Object(_) => vec![o],
        _ => bail!("data is neither a list nor an object"),
    };
    let entries = rows
        .into_iter()
        .filter_map(|r| {
            let id = r.get("id").and_then(Value::as_str)?.to_string();
            let name = ["name", "display_name"].iter().find_map(|k| r.get(*k).and_then(Value::as_str)).unwrap_or("").to_string();
            let kind = match r.get("type").and_then(Value::as_str).unwrap_or("") {
                "folder" => EntryKind::Folder,
                "file" => EntryKind::File,
                "version_stack" => EntryKind::VersionStack,
                _ => EntryKind::Other,
            };
            Some(Entry {
                id,
                name,
                kind,
                size: r.get("file_size").and_then(Value::as_u64).unwrap_or(0),
                created_at: r.get("created_at").and_then(Value::as_str).unwrap_or("").to_string(),
                download_url: r.pointer("/media_links/original/download_url").and_then(Value::as_str).map(String::from),
                root_folder_id: r.get("root_folder_id").and_then(Value::as_str).map(String::from),
            })
        })
        .collect();
    let next = v.pointer("/links/next").and_then(Value::as_str).and_then(resolve_next);
    Ok(Page { entries, next })
}

/// What a pasted Frame.io link points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkTarget {
    File { project_id: String, file_id: String },
    Folder { project_id: String, folder_id: String },
    Project { project_id: String },
    ShareLink { id: String },
    /// An f.io short code; follow the redirect to learn the real target.
    ShortLink { code: String },
}

/// Classifies a Frame.io link; anything off Frame.io's own hosts is refused.
pub fn parse_link(link: &str) -> Result<LinkTarget> {
    let u = url::Url::parse(link.trim()).map_err(|_| anyhow!("not a url"))?;
    if u.scheme() != "https" {
        bail!("only https links are accepted");
    }
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    let segs: Vec<&str> = u.path_segments().map(|s| s.filter(|x| !x.is_empty()).collect()).unwrap_or_default();
    if host == "f.io" || host == "www.f.io" {
        return match segs.as_slice() {
            [code] => Ok(LinkTarget::ShortLink { code: code.to_string() }),
            _ => bail!("short link has no code"),
        };
    }
    if !(host == "frame.io" || host.ends_with(".frame.io")) {
        bail!("{host} is not a Frame.io address");
    }
    if host == "share.frame.io" {
        return match segs.as_slice() {
            [id, ..] => Ok(LinkTarget::ShareLink { id: id.to_string() }),
            _ => bail!("share link has no id"),
        };
    }
    let mut i = 0;
    while i < segs.len() {
        match segs[i] {
            "share" | "shares" | "reviews" | "presentations" => {
                return segs.get(i + 1).map(|id| LinkTarget::ShareLink { id: id.to_string() }).ok_or_else(|| anyhow!("share link has no id"));
            }
            "project" | "projects" => {
                let Some(pid) = segs.get(i + 1) else { bail!("project link has no id") };
                let project_id = pid.to_string();
                return Ok(match (segs.get(i + 2).copied(), segs.get(i + 3)) {
                    (Some("folder" | "folders"), Some(f)) => LinkTarget::Folder { project_id, folder_id: f.to_string() },
                    (Some("view" | "file" | "files"), Some(f)) => LinkTarget::File { project_id, file_id: f.to_string() },
                    (Some(f), None) if f.len() > 8 && f != "view" => LinkTarget::Folder { project_id, folder_id: f.to_string() },
                    _ => LinkTarget::Project { project_id },
                });
            }
            _ => i += 1,
        }
    }
    bail!("this Frame.io link does not point at a project, file, folder or share")
}

/// Names that Windows will not create as files.
const RESERVED: [&str; 8] = ["con", "prn", "aux", "nul", "com1", "com2", "lpt1", "lpt2"];

/// One safe path component: no separators, no control characters, never `.` or `..`, bounded length, extension kept.
pub fn sanitize_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let mut s = cleaned.trim().trim_matches('.').trim().to_string();
    if s.is_empty() {
        return "_".into();
    }
    if s.chars().count() > 120 {
        let ext: String = match s.rsplit_once('.') {
            Some((_, e)) if e.chars().count() <= 10 => format!(".{e}"),
            _ => String::new(),
        };
        let keep = 120 - ext.chars().count();
        s = format!("{}{ext}", s.chars().take(keep).collect::<String>());
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        s = format!("_{s}");
    }
    s
}

/// Refuses a relative path that is absolute, empty, uses `..`, backslashes or empty components.
pub fn check_rel_path(p: &str) -> Result<()> {
    if p.is_empty() || p.starts_with('/') || p.contains('\\') || p.contains('\0') {
        bail!("unsafe path: {p:?}");
    }
    if p.split('/').any(|c| c.is_empty() || c == "." || c == "..") {
        bail!("unsafe path: {p:?}");
    }
    if p.len() > 1024 {
        bail!("path too long");
    }
    Ok(())
}

/// A tree as fetched, before planning.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    File { id: String, name: String, size: u64, url: Option<String> },
    Folder { id: String, name: String, children: Vec<Node> },
    /// Versions of one cut; only the newest is downloaded.
    Stack { id: String, name: String, versions: Vec<Version> },
}

/// One version inside a stack.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub size: u64,
    pub url: Option<String>,
}

/// One file to fetch and where it goes, relative to the chosen download folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub rel_path: String,
    pub size: u64,
    pub url: Option<String>,
}

/// Every file to download, flattened to safe, unique relative paths.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct DownloadPlan {
    pub items: Vec<Item>,
}

impl DownloadPlan {
    /// Flattens a file, a folder tree or a version stack; collisions get " (2)", " (3)" suffixes.
    pub fn build(root: &Node) -> Result<DownloadPlan> {
        let mut raw: Vec<(Vec<String>, String, u64, Option<String>)> = Vec::new();
        collect(root, &mut Vec::new(), &mut raw, 0)?;
        let mut taken: HashSet<String> = HashSet::new();
        let mut items = Vec::new();
        for (dirs, name, size, url) in raw {
            let prefix = dirs.join("/");
            let mut candidate = name.clone();
            let mut n = 1;
            loop {
                let full = if prefix.is_empty() { candidate.clone() } else { format!("{prefix}/{candidate}") };
                if taken.insert(full.to_lowercase()) {
                    check_rel_path(&full)?;
                    items.push((full, size, url.clone()));
                    break;
                }
                n += 1;
                candidate = match name.rsplit_once('.') {
                    Some((stem, ext)) if !stem.is_empty() => format!("{stem} ({n}).{ext}"),
                    _ => format!("{name} ({n})"),
                };
            }
        }
        Ok(DownloadPlan { items: items.into_iter().map(|(rel_path, size, url)| Item { id: rel_path.clone(), rel_path, size, url }).collect() })
    }

    /// Total bytes the plan expects.
    pub fn total_bytes(&self) -> u64 {
        self.items.iter().map(|i| i.size).sum()
    }
}

fn collect(node: &Node, dirs: &mut Vec<String>, out: &mut Vec<(Vec<String>, String, u64, Option<String>)>, depth: usize) -> Result<()> {
    if depth > MAX_DEPTH {
        bail!("folders are nested deeper than {MAX_DEPTH} levels");
    }
    match node {
        Node::File { name, size, url, .. } => out.push((dirs.clone(), sanitize_component(name), *size, url.clone())),
        Node::Folder { name, children, .. } => {
            dirs.push(sanitize_component(name));
            for c in children {
                collect(c, dirs, out, depth + 1)?;
            }
            dirs.pop();
        }
        Node::Stack { name, versions, .. } => {
            let latest = versions
                .iter()
                .enumerate()
                .max_by(|(ia, a), (ib, b)| a.created_at.cmp(&b.created_at).then(ia.cmp(ib)))
                .map(|(_, v)| v)
                .ok_or_else(|| anyhow!("version stack {name:?} has no versions"))?;
            let shown = if latest.name.trim().is_empty() { name } else { &latest.name };
            out.push((dirs.clone(), sanitize_component(shown), latest.size, latest.url.clone()));
        }
    }
    Ok(())
}

/// Where one file in a download stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileState {
    Queued,
    Running { bytes: u64 },
    Done,
    Failed(String),
}

/// Tracks a download with at most `limit` files running at once.
#[derive(Debug)]
pub struct Progress {
    sizes: Vec<u64>,
    states: Vec<FileState>,
    limit: usize,
}

impl Progress {
    pub fn new(plan: &DownloadPlan, limit: usize) -> Progress {
        Progress {
            sizes: plan.items.iter().map(|i| i.size).collect(),
            states: vec![FileState::Queued; plan.items.len()],
            limit: limit.max(1),
        }
    }

    fn running(&self) -> usize {
        self.states.iter().filter(|s| matches!(s, FileState::Running { .. })).count()
    }

    /// Starts as many queued files as the limit allows and returns their indexes.
    pub fn next_batch(&mut self) -> Vec<usize> {
        let room = self.limit.saturating_sub(self.running());
        let picked: Vec<usize> =
            self.states.iter().enumerate().filter(|(_, s)| **s == FileState::Queued).map(|(i, _)| i).take(room).collect();
        for &i in &picked {
            self.states[i] = FileState::Running { bytes: 0 };
        }
        picked
    }

    /// Reports bytes received so far for a running file.
    pub fn update(&mut self, i: usize, bytes: u64) -> Result<()> {
        match self.states.get_mut(i) {
            Some(FileState::Running { bytes: b }) => {
                *b = bytes.min(self.sizes[i].max(bytes));
                Ok(())
            }
            Some(_) => bail!("file {i} is not running"),
            None => bail!("no file {i}"),
        }
    }

    /// Marks a running file done.
    pub fn finish(&mut self, i: usize) -> Result<()> {
        match self.states.get_mut(i) {
            Some(s @ FileState::Running { .. }) => {
                *s = FileState::Done;
                Ok(())
            }
            Some(_) => bail!("file {i} is not running"),
            None => bail!("no file {i}"),
        }
    }

    /// Marks a running file failed.
    pub fn fail(&mut self, i: usize, why: &str) -> Result<()> {
        match self.states.get_mut(i) {
            Some(s @ FileState::Running { .. }) => {
                *s = FileState::Failed(why.to_string());
                Ok(())
            }
            Some(_) => bail!("file {i} is not running"),
            None => bail!("no file {i}"),
        }
    }

    /// Puts failed files back in the queue; returns how many.
    pub fn retry_failed(&mut self) -> usize {
        let mut n = 0;
        for s in &mut self.states {
            if matches!(s, FileState::Failed(_)) {
                *s = FileState::Queued;
                n += 1;
            }
        }
        n
    }

    /// Whole-download percentage: by bytes when sizes are known, by file count otherwise.
    pub fn percent(&self) -> u8 {
        if self.states.is_empty() {
            return 100;
        }
        let total: u64 = self.sizes.iter().sum();
        let (num, den) = if total > 0 {
            let got: u64 = self
                .states
                .iter()
                .zip(&self.sizes)
                .map(|(s, size)| match s {
                    FileState::Done => *size,
                    FileState::Running { bytes } => (*bytes).min(*size),
                    _ => 0,
                })
                .sum();
            (got, total)
        } else {
            (self.states.iter().filter(|s| **s == FileState::Done).count() as u64, self.states.len() as u64)
        };
        (num * 100 / den).min(100) as u8
    }

    /// True once nothing is queued or running (failures included).
    pub fn is_finished(&self) -> bool {
        self.states.iter().all(|s| matches!(s, FileState::Done | FileState::Failed(_)))
    }

    /// One line for the chat: `4/10 files, 37%` plus failures when there are any.
    pub fn line(&self) -> String {
        let done = self.states.iter().filter(|s| **s == FileState::Done).count();
        let failed = self.states.iter().filter(|s| matches!(s, FileState::Failed(_))).count();
        let mut l = format!("{done}/{} files, {}%", self.states.len(), self.percent());
        if failed > 0 {
            l.push_str(&format!(", {failed} failed"));
        }
        l
    }

    pub fn state(&self, i: usize) -> Option<&FileState> {
        self.states.get(i)
    }
}

/// Walks a folder through the API into a [`Node`] tree, following pages and nested folders.
pub async fn fetch_tree<H: HttpClient + Sync>(http: &H, bearer: &str, account: &str, folder: &Entry) -> Result<Node> {
    walk(http, bearer, account, folder, 0).await
}

fn walk<'a, H: HttpClient + Sync>(
    http: &'a H,
    bearer: &'a str,
    account: &'a str,
    folder: &'a Entry,
    depth: usize,
) -> std::pin::Pin<Box<dyn Future<Output = Result<Node>> + Send + 'a>> {
    Box::pin(async move {
        if depth > MAX_DEPTH {
            bail!("folders are nested deeper than {MAX_DEPTH} levels");
        }
        let mut children = Vec::new();
        let mut url = Some(folder_children_url(account, &folder.id));
        while let Some(u) = url {
            let page = parse_list(&http.get(&u, bearer).await?)?;
            for e in page.entries {
                match e.kind {
                    EntryKind::File => children.push(Node::File { id: e.id, name: e.name, size: e.size, url: e.download_url }),
                    EntryKind::Folder => children.push(walk(http, bearer, account, &e, depth + 1).await?),
                    EntryKind::VersionStack => {
                        let mut versions = Vec::new();
                        let mut vurl = Some(version_stack_children_url(account, &e.id));
                        while let Some(vu) = vurl {
                            let vp = parse_list(&http.get(&vu, bearer).await?)?;
                            versions.extend(vp.entries.into_iter().filter(|v| v.kind == EntryKind::File).map(|v| Version {
                                id: v.id,
                                name: v.name,
                                created_at: v.created_at,
                                size: v.size,
                                url: v.download_url,
                            }));
                            vurl = vp.next;
                        }
                        children.push(Node::Stack { id: e.id, name: e.name, versions });
                    }
                    EntryKind::Other => {}
                }
            }
            url = page.next;
        }
        Ok(Node::Folder { id: folder.id.clone(), name: folder.name.clone(), children })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn auth() -> FrameAuth {
        FrameAuth { client_id: "cid".into(), client_secret: "s e&c".into(), refresh_token: "rt".into() }
    }
    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z").unwrap().with_timezone(&Utc)
    }
    fn file(name: &str, size: u64) -> Node {
        Node::File { id: name.into(), name: name.into(), size, url: Some(format!("https://dl/{name}")) }
    }
    fn folder(name: &str, children: Vec<Node>) -> Node {
        Node::Folder { id: name.into(), name: name.into(), children }
    }
    fn paths(p: &DownloadPlan) -> Vec<&str> {
        p.items.iter().map(|i| i.rel_path.as_str()).collect()
    }

    #[test]
    fn token_flow() {
        let b = token_request_body(&auth());
        assert!(b.contains("grant_type=refresh_token") && b.contains("client_secret=s+e%26c"));
        assert!(!format!("{:?}", auth()).contains("s e&c"));
        let t = parse_token_response(r#"{"access_token":"abc","expires_in":86399}"#, now()).unwrap();
        assert_eq!(t.expires_at, now() + Duration::seconds(86399));
        assert!(!format!("{t:?}").contains("abc"));
        assert!(parse_token_response(r#"{"error":"invalid_grant"}"#, now()).is_err());
        assert!(parse_token_response("{}", now()).is_err());
        assert!(t.is_fresh(now()) && !t.is_fresh(now() + Duration::seconds(86350)));
    }

    struct Fake {
        calls: std::sync::Mutex<u32>,
        pages: HashMap<String, String>,
    }
    impl HttpClient for Fake {
        async fn post_form(&self, _u: &str, _b: &str) -> Result<String> {
            *self.calls.lock().unwrap() += 1;
            Ok(r#"{"access_token":"t","expires_in":3600}"#.into())
        }
        async fn get(&self, url: &str, bearer: &str) -> Result<String> {
            assert_eq!(bearer, "t");
            self.pages.get(url).cloned().ok_or_else(|| anyhow!("404 {url}"))
        }
    }

    #[tokio::test]
    async fn cache_refreshes_near_expiry() {
        let f = Fake { calls: Default::default(), pages: HashMap::new() };
        let mut c = TokenCache::new();
        c.get(&f, &auth(), now()).await.unwrap();
        c.get(&f, &auth(), now() + Duration::seconds(3000)).await.unwrap();
        assert_eq!(*f.calls.lock().unwrap(), 1);
        c.get(&f, &auth(), now() + Duration::seconds(3560)).await.unwrap();
        assert_eq!(*f.calls.lock().unwrap(), 2);
    }

    #[test]
    fn hierarchy_urls() {
        assert_eq!(accounts_url(), "https://api.frame.io/v4/accounts");
        assert_eq!(workspaces_url("a1"), "https://api.frame.io/v4/accounts/a1/workspaces");
        assert_eq!(projects_url("a1", "w 2"), "https://api.frame.io/v4/accounts/a1/workspaces/w+2/projects");
        assert!(folder_children_url("a", "f/../x").contains("folders/f%2F..%2Fx/children"));
        assert!(file_url("a", "f").contains("include=media_links.original"));
        assert!(version_stack_children_url("a", "s").contains("version_stacks/s/children"));
        assert!(share_url("a", "s").ends_with("/shares/s") && folder_url("a", "f").ends_with("/folders/f"));
    }

    #[test]
    fn list_parsing() {
        let p = parse_list(
            r#"{"data":[
              {"id":"1","name":"Cut","type":"file","file_size":10,"created_at":"2026-01-01","media_links":{"original":{"download_url":"https://dl/1"}}},
              {"id":"2","name":"Sub","type":"folder"},
              {"id":"3","name":"Stack","type":"version_stack"},
              {"id":"4","display_name":"Acme","root_folder_id":"r1"},
              {"name":"no id"}],
             "links":{"next":"/v4/accounts/a/folders/f/children?after=x"}}"#,
        )
        .unwrap();
        assert_eq!(p.entries.len(), 4);
        assert_eq!(p.entries[0].download_url.as_deref(), Some("https://dl/1"));
        assert_eq!(p.entries[1].kind, EntryKind::Folder);
        assert_eq!(p.entries[2].kind, EntryKind::VersionStack);
        assert_eq!(p.entries[3].name, "Acme");
        assert_eq!(p.entries[3].root_folder_id.as_deref(), Some("r1"));
        assert_eq!(p.next.as_deref(), Some("https://api.frame.io/v4/accounts/a/folders/f/children?after=x"));
        assert_eq!(parse_list(r#"{"data":{"id":"z","name":"One"}}"#).unwrap().entries.len(), 1);
        assert!(parse_list("{}").is_err());
        assert!(resolve_next("https://evil.example/x").is_none() && resolve_next("//evil.example").is_none());
    }

    #[test]
    fn link_kinds() {
        let p = "11111111-aaaa-bbbb-cccc-222222222222";
        assert_eq!(parse_link("https://f.io/AbC123").unwrap(), LinkTarget::ShortLink { code: "AbC123".into() });
        assert_eq!(parse_link("https://next.frame.io/share/xyz").unwrap(), LinkTarget::ShareLink { id: "xyz".into() });
        assert_eq!(parse_link("https://share.frame.io/xyz/view").unwrap(), LinkTarget::ShareLink { id: "xyz".into() });
        assert_eq!(parse_link("https://app.frame.io/reviews/abc").unwrap(), LinkTarget::ShareLink { id: "abc".into() });
        assert_eq!(parse_link(&format!("https://next.frame.io/project/{p}")).unwrap(), LinkTarget::Project { project_id: p.into() });
        assert_eq!(
            parse_link(&format!("https://next.frame.io/project/{p}/view/ff")).unwrap(),
            LinkTarget::File { project_id: p.into(), file_id: "ff".into() }
        );
        assert_eq!(
            parse_link(&format!("https://next.frame.io/project/{p}/folder/dd")).unwrap(),
            LinkTarget::Folder { project_id: p.into(), folder_id: "dd".into() }
        );
    }

    #[test]
    fn link_refusals() {
        for bad in ["http://f.io/x", "https://evil.example/project/x", "https://frame.io.evil.com/share/x", "https://f.io/", "https://next.frame.io/", "nope", "https://next.frame.io/share"] {
            assert!(parse_link(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn names_are_sanitised() {
        assert_eq!(sanitize_component("a/b\\c:d*e?.mov"), "a_b_c_d_e_.mov");
        assert_eq!(sanitize_component(".."), "_");
        assert_eq!(sanitize_component(" . "), "_");
        assert_eq!(sanitize_component(""), "_");
        assert_eq!(sanitize_component("con.txt"), "_con.txt");
        assert_eq!(sanitize_component("ok\u{0}name"), "ok_name");
        let long = format!("{}.mp4", "x".repeat(300));
        let s = sanitize_component(&long);
        assert_eq!(s.chars().count(), 120);
        assert!(s.ends_with(".mp4"));
    }

    #[test]
    fn rel_path_checks() {
        assert!(check_rel_path("a/b.mov").is_ok());
        for bad in ["", "/etc/passwd", "../x", "a/../b", "a//b", "a\\b", "./a", "a/"] {
            assert!(check_rel_path(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn plan_flattens_folders() {
        let tree = folder("Proj", vec![file("a.mov", 1), folder("Sub", vec![file("b.mov", 2), folder("Deep", vec![file("c.mov", 3)])])]);
        let p = DownloadPlan::build(&tree).unwrap();
        assert_eq!(paths(&p), vec!["Proj/a.mov", "Proj/Sub/b.mov", "Proj/Sub/Deep/c.mov"]);
        assert_eq!(p.total_bytes(), 6);
        assert_eq!(DownloadPlan::build(&file("x.mov", 5)).unwrap().items[0].rel_path, "x.mov");
    }

    #[test]
    fn plan_neutralises_traversal_names() {
        let tree = folder("..", vec![file("../../evil.sh", 1), folder("/abs", vec![file("..", 1)])]);
        let p = DownloadPlan::build(&tree).unwrap();
        for i in &p.items {
            check_rel_path(&i.rel_path).unwrap();
        }
        assert_eq!(paths(&p), vec!["_/_.._evil.sh", "_/_abs/_"]);
    }

    #[test]
    fn plan_dedupes_collisions_case_insensitively() {
        let tree = folder("F", vec![file("a.mov", 1), file("A.MOV", 1), file("a.mov", 1), file("noext", 1), file("noext", 1)]);
        let p = DownloadPlan::build(&tree).unwrap();
        assert_eq!(paths(&p), vec!["F/a.mov", "F/A (2).MOV", "F/a (3).mov", "F/noext", "F/noext (2)"]);
        let ids: HashSet<_> = p.items.iter().map(|i| i.rel_path.to_lowercase()).collect();
        assert_eq!(ids.len(), p.items.len());
    }

    #[test]
    fn stack_picks_latest_version() {
        let v = |id: &str, at: &str, url: &str| Version { id: id.into(), name: format!("cut_{id}.mov"), created_at: at.into(), size: 9, url: Some(url.into()) };
        let st = Node::Stack { id: "s".into(), name: "Cut".into(), versions: vec![v("1", "2026-01-01T00:00:00Z", "u1"), v("3", "2026-03-01T00:00:00Z", "u3"), v("2", "2026-02-01T00:00:00Z", "u2")] };
        let p = DownloadPlan::build(&folder("P", vec![st])).unwrap();
        assert_eq!(p.items.len(), 1);
        assert_eq!(p.items[0].rel_path, "P/cut_3.mov");
        assert_eq!(p.items[0].url.as_deref(), Some("u3"));
        let empty = Node::Stack { id: "s".into(), name: "Empty".into(), versions: vec![] };
        assert!(DownloadPlan::build(&empty).is_err());
    }

    #[test]
    fn deep_nesting_is_refused() {
        let mut n = file("x", 1);
        for i in 0..=MAX_DEPTH + 1 {
            n = folder(&format!("d{i}"), vec![n]);
        }
        assert!(DownloadPlan::build(&n).is_err());
    }

    fn plan(sizes: &[u64]) -> DownloadPlan {
        DownloadPlan { items: sizes.iter().enumerate().map(|(i, s)| Item { id: i.to_string(), rel_path: format!("f{i}"), size: *s, url: None }).collect() }
    }

    #[test]
    fn progress_respects_concurrency() {
        let mut p = Progress::new(&plan(&[10, 10, 10, 10, 10]), 2);
        assert_eq!(p.next_batch(), vec![0, 1]);
        assert!(p.next_batch().is_empty());
        p.finish(0).unwrap();
        assert_eq!(p.next_batch(), vec![2]);
        assert_eq!(p.state(2), Some(&FileState::Running { bytes: 0 }));
        assert!(!p.is_finished());
    }

    #[test]
    fn progress_percent_by_bytes() {
        let mut p = Progress::new(&plan(&[100, 100]), 2);
        assert_eq!(p.percent(), 0);
        p.next_batch();
        p.update(0, 50).unwrap();
        assert_eq!(p.percent(), 25);
        p.finish(0).unwrap();
        p.update(1, 100).unwrap();
        assert_eq!(p.percent(), 100);
        assert_eq!(p.line(), "1/2 files, 100%");
    }

    #[test]
    fn progress_percent_by_count_when_sizes_unknown() {
        let mut p = Progress::new(&plan(&[0, 0, 0, 0]), 4);
        p.next_batch();
        p.finish(0).unwrap();
        assert_eq!(p.percent(), 25);
        assert_eq!(Progress::new(&plan(&[]), 1).percent(), 100);
    }

    #[test]
    fn progress_failures_and_retry() {
        let mut p = Progress::new(&plan(&[10, 10]), 2);
        p.next_batch();
        p.fail(0, "timeout").unwrap();
        p.finish(1).unwrap();
        assert!(p.is_finished());
        assert!(p.line().ends_with("1 failed"));
        assert_eq!(p.retry_failed(), 1);
        assert!(!p.is_finished());
        assert_eq!(p.next_batch(), vec![0]);
    }

    #[test]
    fn progress_rejects_bad_transitions() {
        let mut p = Progress::new(&plan(&[10]), 0);
        assert!(p.finish(0).is_err());
        assert!(p.update(0, 1).is_err());
        assert!(p.fail(5, "x").is_err());
        assert_eq!(p.next_batch(), vec![0]);
        p.finish(0).unwrap();
        assert!(p.finish(0).is_err());
        p.update(0, 1).unwrap_err();
    }

    #[tokio::test]
    async fn walk_follows_pages_folders_and_stacks() {
        let base = |id: &str| folder_children_url("acc", id);
        let mut pages = HashMap::new();
        pages.insert(
            base("root"),
            r#"{"data":[{"id":"f1","name":"a.mov","type":"file","file_size":5,"media_links":{"original":{"download_url":"https://dl/a"}}},{"id":"d1","name":"Sub","type":"folder"}],"links":{"next":"/v4/page2"}}"#.to_string(),
        );
        pages.insert("https://api.frame.io/v4/page2".into(), r#"{"data":[{"id":"s1","name":"Stack","type":"version_stack"}]}"#.to_string());
        pages.insert(base("d1"), r#"{"data":[{"id":"f2","name":"b.mov","type":"file","file_size":7}]}"#.to_string());
        pages.insert(
            version_stack_children_url("acc", "s1"),
            r#"{"data":[{"id":"v1","name":"s_v1.mov","type":"file","created_at":"2026-01-01","file_size":1},{"id":"v2","name":"s_v2.mov","type":"file","created_at":"2026-02-01","file_size":2}]}"#.to_string(),
        );
        let f = Fake { calls: Default::default(), pages };
        let root = Entry { id: "root".into(), name: "Root".into(), kind: EntryKind::Folder, size: 0, created_at: String::new(), download_url: None, root_folder_id: None };
        let tree = fetch_tree(&f, "t", "acc", &root).await.unwrap();
        let plan = DownloadPlan::build(&tree).unwrap();
        assert_eq!(paths(&plan), vec!["Root/a.mov", "Root/Sub/b.mov", "Root/s_v2.mov"]);
        assert_eq!(plan.total_bytes(), 14);
    }
}
