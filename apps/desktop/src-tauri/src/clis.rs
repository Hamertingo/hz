//! The CLIs hz runs agents on, as Settings → CLIs shows them: version, path,
//! account, the adapter in between; checking for a newer one, updating,
//! signing in and out.
//!
//! hz drives the reader's own installs and never holds a key, so every action
//! here is **that CLI's own command** (`claude auth login`, `codex logout`,
//! `claude update`), run as a child with its output streamed to the page as
//! `cli_progress` events.

use std::{
    collections::HashMap,
    process::Stdio,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::{io::{AsyncBufReadExt, BufReader}, process::Command};
use ts_rs::TS;

use crate::{
    harness::{
        mcode::dialect::{self, CLAUDE_ADAPTER, CODEX_ADAPTER},
        Harness,
    },
    proc::HideConsole as _,
};

/// One installed (or missing) CLI.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct CliInfo {
    pub harness: String,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    /// `you@example.com · Max`, or what the CLI says about who is signed in.
    pub account: Option<String>,
    pub signed_in: bool,
    /// `ACP · claude-agent-acp 0.94.0`.
    pub via: String,
    /// The adapter hz speaks through is on disk (always true where there is none).
    pub adapter_ready: bool,
    /// A newer version than `version`, from the last check.
    pub latest: Option<String>,
    /// The command "Update" will run, or `None` where hz can't name one.
    pub update_command: Option<String>,
}

/// A line of output from an action in flight, or its end.
#[derive(Clone, Debug, Serialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct CliProgress {
    pub harness: String,
    /// `update`, `login`, `logout` or `adapter`.
    pub step: String,
    pub line: String,
    pub done: bool,
    pub ok: bool,
}

const PROGRESS: &str = "cli_progress";
const READ_TIMEOUT: Duration = Duration::from_secs(8);

/// The CLIs, in the order the page lists them.
const CLIS: [Harness; 3] = [Harness::Claude, Harness::Codex, Harness::OpenCode];

fn name_of(h: Harness) -> &'static str {
    match h {
        Harness::Claude => "Claude",
        Harness::Codex => "Codex",
        _ => "OpenCode",
    }
}

fn parse_harness(wire: &str) -> Result<Harness> {
    CLIS.into_iter().find(|h| h.wire_name() == wire).context("not a CLI hz runs agents on")
}

/// The npm package each CLI is published as, which is where "latest" is read.
fn npm_package(h: Harness) -> &'static str {
    match h {
        Harness::Claude => "@anthropic-ai/claude-code",
        Harness::Codex => "@openai/codex",
        _ => "opencode-ai",
    }
}

/// The first `1.2.3` in a CLI's `--version` output.
pub fn parse_version(text: &str) -> Option<String> {
    text.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|t| t.split('.').count() >= 3 && t.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())))
        .map(str::to_string)
}

/// Whether `latest` is a higher version than `current`, compared part by part
/// as numbers (so 0.10.0 is above 0.9.0).
pub fn is_newer(latest: &str, current: &str) -> bool {
    let parts = |v: &str| v.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
    parts(latest) > parts(current)
}

/// Terminal colour codes removed.
pub fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// The account line for Claude from `claude auth status` JSON.
pub fn claude_account(status: &Value) -> (bool, Option<String>) {
    if status["loggedIn"].as_bool() != Some(true) {
        return (false, None);
    }
    let email = status["email"].as_str().unwrap_or("signed in");
    let line = match status["subscriptionType"].as_str() {
        Some(plan) if !plan.is_empty() => {
            let mut c = plan.chars();
            let cap = c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default();
            format!("{email} \u{b7} {cap}")
        }
        _ => email.to_string(),
    };
    (true, Some(line))
}

/// The providers an OpenCode `auth list` names, from lines like `●  OpenCode Go api`.
pub fn opencode_providers(listing: &str) -> Vec<String> {
    strip_ansi(listing)
        .lines()
        .filter_map(|l| l.trim().strip_prefix('\u{25cf}'))
        .map(|rest| {
            let rest = rest.trim();
            // The credential type trails the name: `api`, `oauth` or `wellknown`.
            match rest.rsplit_once(' ') {
                Some((name, "api" | "oauth" | "wellknown")) => name.trim().to_string(),
                _ => rest.to_string(),
            }
        })
        .collect()
}

/// The command "Update" runs for a CLI installed at `path`. `None` where the
/// install method isn't one hz can tell, rather than a guess that edits the
/// wrong copy.
pub fn update_command(h: Harness, path: &str) -> Option<Vec<String>> {
    let v = |a: &[&str]| Some(a.iter().map(|s| s.to_string()).collect());
    match h {
        Harness::Claude => v(&["claude", "update"]),
        Harness::OpenCode => v(&["opencode", "upgrade"]),
        Harness::Codex if path.contains("/homebrew/") || path.contains("/Cellar/") || path.contains("/linuxbrew/") => {
            v(&["brew", "upgrade", "codex"])
        }
        Harness::Codex if path.contains("node_modules") || path.contains("/.nvm/") || path.contains("/.bun/") || path.contains("npm") => {
            v(&["npm", "install", "-g", "@openai/codex@latest"])
        }
        _ => None,
    }
}

/// A child's PATH and a no-window flag, ready to run `bin`.
fn command(bin: &std::path::Path) -> Command {
    let mut c = Command::new(bin);
    c.env("PATH", crate::binpath::child_path(crate::binpath::resolved_bin_dirs())).kill_on_drop(true);
    c
}

/// Runs a command to the end and answers stdout and stderr together.
async fn capture(c: Command, limit: Duration) -> Result<String> {
    let out = tokio::time::timeout(limit, c.hide_console().stdin(Stdio::null()).output())
        .await
        .context("timed out")??;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    text.push_str(&String::from_utf8_lossy(&out.stderr));
    Ok(text)
}

async fn version_of(bin: &std::path::Path) -> Option<String> {
    let mut c = command(bin);
    c.arg("--version");
    capture(c, READ_TIMEOUT).await.ok().and_then(|t| parse_version(&t))
}

/// Who a CLI is signed in as, as far as the CLI will say.
async fn account_of(h: Harness, bin: &std::path::Path) -> (bool, Option<String>) {
    match h {
        Harness::Claude => {
            let mut c = command(bin);
            c.args(["auth", "status"]);
            match capture(c, READ_TIMEOUT).await.ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
                Some(status) => claude_account(&status),
                None => (false, None),
            }
        }
        Harness::Codex => {
            let mut c = command(bin);
            c.args(["login", "status"]);
            let signed = capture(c, READ_TIMEOUT).await.is_ok_and(|t| t.to_lowercase().contains("logged in"));
            if !signed {
                return (false, None);
            }
            (true, codex_account(bin).await.or_else(|| Some("signed in".into())))
        }
        _ => {
            let mut c = command(bin);
            c.args(["auth", "list"]);
            let names = capture(c, READ_TIMEOUT).await.map(|t| opencode_providers(&t)).unwrap_or_default();
            if names.is_empty() {
                (false, None)
            } else {
                (true, Some(names.join(", ")))
            }
        }
    }
}

/// `email · Plus` from Codex's app server. Best-effort: the status line already
/// answered "signed in".
async fn codex_account(bin: &std::path::Path) -> Option<String> {
    use tokio::io::AsyncWriteExt;
    let mut c = command(bin);
    c.arg("app-server");
    let mut child = c.hide_console().stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    let input = [
        json!({"id": 1, "method": "initialize", "params": {"clientInfo": {"name": "hz", "title": "hz", "version": "0"}}}),
        json!({"method": "initialized"}),
        json!({"id": 2, "method": "account/read", "params": {"refreshToken": false}}),
    ];
    for line in input {
        stdin.write_all(format!("{line}\n").as_bytes()).await.ok()?;
    }
    let mut lines = BufReader::new(stdout).lines();
    let read = async {
        while let Ok(Some(line)) = lines.next_line().await {
            let v: Value = serde_json::from_str(&line).ok()?;
            if v["id"] == 2 {
                let a = &v["result"]["account"];
                let email = a["email"].as_str()?;
                let plan = a["planType"].as_str().map(|p| {
                    let mut ch = p.chars();
                    ch.next().map(|f| f.to_uppercase().collect::<String>() + ch.as_str()).unwrap_or_default()
                });
                return Some(plan.map_or_else(|| email.to_string(), |p| format!("{email} \u{b7} {p}")));
            }
        }
        None
    };
    tokio::time::timeout(READ_TIMEOUT, read).await.ok().flatten()
}

/// What the last "check for updates" found, by harness wire name, and when.
static LATEST: LazyLock<Mutex<HashMap<String, (Instant, String)>>> = LazyLock::new(Default::default);

async fn info_of(h: Harness) -> CliInfo {
    let bin = crate::binpath::agent_binary(h).await;
    let installed = bin.is_absolute();
    let wire = h.wire_name();
    let latest = LATEST.lock().expect("latest poisoned").get(&wire).map(|(_, v)| v.clone());

    let (version, account) = if installed {
        let (v, a) = tokio::join!(version_of(&bin), account_of(h, &bin));
        (v, a)
    } else {
        (None, (false, None))
    };
    let newer = match (&latest, &version) {
        (Some(l), Some(c)) if is_newer(l, c) => Some(l.clone()),
        _ => None,
    };
    let path = installed.then(|| bin.to_string_lossy().into_owned());
    let (via, adapter_ready) = match h {
        Harness::Claude => (
            format!("ACP \u{b7} claude-agent-acp {}", CLAUDE_ADAPTER.version),
            dialect::adapter_entry_if_installed(h).await.is_some(),
        ),
        Harness::Codex => (
            format!("ACP \u{b7} codex-acp {}", CODEX_ADAPTER.version),
            dialect::adapter_entry_if_installed(h).await.is_some(),
        ),
        _ => ("ACP \u{b7} opencode acp".to_string(), true),
    };

    CliInfo {
        harness: wire,
        name: name_of(h).into(),
        installed,
        version,
        update_command: path.as_deref().and_then(|p| update_command(h, p)).map(|c| c.join(" ")),
        path,
        account: account.1,
        signed_in: account.0,
        via,
        adapter_ready,
        latest: newer,
    }
}

/// One CLI's row, so the page can fill each card as its own read lands.
#[tauri::command]
pub async fn cli_info(harness: String) -> Result<CliInfo, String> {
    let h = parse_harness(&harness).map_err(|e| e.to_string())?;
    Ok(info_of(h).await)
}

/// Every CLI's row, read in turn. The page takes the list whole.
async fn cli_overview() -> Vec<CliInfo> {
    let mut rows = Vec::with_capacity(CLIS.len());
    for h in CLIS {
        rows.push(info_of(h).await);
    }
    rows
}

/// Asks npm for each installed CLI's newest version and remembers the answer for
/// the page. Answers the list again, so one call both checks and redraws.
#[tauri::command]
pub async fn cli_check_updates() -> Vec<CliInfo> {
    check_all().await;
    cli_overview().await
}

async fn check_all() {
    let npm = crate::binpath::npm().await;
    if !npm.is_absolute() {
        return;
    }
    for h in CLIS {
        if !crate::binpath::agent_binary(h).await.is_absolute() {
            continue;
        }
        let mut c = command(&npm);
        c.args(["view", npm_package(h), "version"]);
        if let Ok(text) = capture(c, Duration::from_secs(15)).await {
            if let Some(v) = parse_version(&text) {
                LATEST.lock().expect("latest poisoned").insert(h.wire_name(), (Instant::now(), v));
            }
        }
    }
}

fn emit(app: &AppHandle, harness: &str, step: &str, line: &str, done: bool, ok: bool) {
    let _ = app.emit(
        PROGRESS,
        CliProgress { harness: harness.into(), step: step.into(), line: line.into(), done, ok },
    );
}

/// Runs `c` to the end, sending each line it prints as progress. The first URL
/// in the output is opened in the reader's browser, which is how a CLI's own
/// sign-in reaches them when it can't open one itself.
async fn stream(app: &AppHandle, harness: &str, step: &str, c: Command, limit: Duration, open_urls: bool) -> Result<()> {
    let mut child = c
        .hide_console()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("could not start the command")?;
    let mut out = BufReader::new(child.stdout.take().context("no stdout")?).lines();
    let mut err = BufReader::new(child.stderr.take().context("no stderr")?).lines();
    let mut opened = false;

    let run = async {
        loop {
            let line = tokio::select! {
                l = out.next_line() => l,
                l = err.next_line() => l,
            };
            match line {
                Ok(Some(line)) => {
                    let clean = strip_ansi(&line).trim().to_string();
                    if clean.is_empty() {
                        continue;
                    }
                    if open_urls && !opened {
                        if let Some(url) = clean.split_whitespace().find(|w| w.starts_with("https://")) {
                            opened = true;
                            use tauri_plugin_opener::OpenerExt;
                            let _ = app.opener().open_url(url, None::<&str>);
                        }
                    }
                    emit(app, harness, step, &clean, false, true);
                }
                // One stream ending is not the child ending: wait for it.
                Ok(None) | Err(_) => break,
            }
        }
        child.wait().await
    };
    let status = tokio::time::timeout(limit, run).await.context("it took too long")??;
    anyhow::ensure!(status.success(), "the command failed ({status})");
    Ok(())
}

async fn finish(app: &AppHandle, harness: &str, step: &str, result: Result<()>) -> Result<(), String> {
    match &result {
        Ok(()) => emit(app, harness, step, "Done", true, true),
        Err(e) => emit(app, harness, step, &format!("{e:#}"), true, false),
    }
    result.map_err(|e| format!("{e:#}"))
}

/// Updates a CLI with its own update command, and sets up its adapter if that
/// is what is missing.
#[tauri::command]
pub async fn cli_update(app: AppHandle, harness: String) -> Result<(), String> {
    let h = parse_harness(&harness).map_err(|e| e.to_string())?;
    let result = async {
        let bin = crate::binpath::agent_binary(h).await;
        anyhow::ensure!(bin.is_absolute(), "{} isn't installed", name_of(h));

        if let Some(adapter) = dialect::adapter_for(h) {
            if dialect::adapter_entry_if_installed(h).await.is_none() {
                emit(&app, &harness, "adapter", &format!("Installing {} {}", adapter.package, adapter.version), false, true);
                dialect::install_adapter(adapter).await?;
            }
        }
        let path = bin.to_string_lossy().into_owned();
        let Some(cmd) = update_command(h, &path) else {
            bail!("hz can't tell how {} was installed; update it with the tool that installed it", name_of(h));
        };
        let mut parts = cmd.into_iter();
        let program = parts.next().context("empty command")?;
        let resolved = if program == name_program(h) { bin.clone() } else { sibling(&bin, &program) };
        let mut c = command(&resolved);
        c.args(parts);
        stream(&app, &harness, "update", c, Duration::from_secs(600), false).await
    }
    .await;
    if result.is_ok() {
        LATEST.lock().expect("latest poisoned").remove(&harness);
    }
    finish(&app, &harness, "update", result).await
}

fn name_program(h: Harness) -> &'static str {
    match h {
        Harness::Claude => "claude",
        Harness::Codex => "codex",
        _ => "opencode",
    }
}

/// `program` next to `bin` when it lives there (brew beside a Homebrew codex),
/// else left to the PATH.
fn sibling(bin: &std::path::Path, program: &str) -> std::path::PathBuf {
    bin.parent()
        .map(|d| d.join(program))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| std::path::PathBuf::from(program))
}

/// Signs in with the CLI's own flow. Claude and Codex open the browser (hz opens
/// the URL they print); OpenCode's is a menu, so it gets a Terminal window.
#[tauri::command]
pub async fn cli_sign_in(app: AppHandle, harness: String) -> Result<(), String> {
    let h = parse_harness(&harness).map_err(|e| e.to_string())?;
    let result = async {
        let bin = crate::binpath::agent_binary(h).await;
        anyhow::ensure!(bin.is_absolute(), "{} isn't installed", name_of(h));
        match h {
            Harness::Claude => {
                let mut c = command(&bin);
                c.args(["auth", "login"]);
                stream(&app, &harness, "login", c, Duration::from_secs(300), true).await
            }
            Harness::Codex => {
                let mut c = command(&bin);
                c.arg("login");
                stream(&app, &harness, "login", c, Duration::from_secs(300), true).await
            }
            _ => open_in_terminal(&format!("{} auth login", bin.to_string_lossy())).await,
        }
    }
    .await;
    finish(&app, &harness, "login", result).await
}

/// Signs out with the CLI's own command.
#[tauri::command]
pub async fn cli_sign_out(app: AppHandle, harness: String) -> Result<(), String> {
    let h = parse_harness(&harness).map_err(|e| e.to_string())?;
    let result = async {
        let bin = crate::binpath::agent_binary(h).await;
        anyhow::ensure!(bin.is_absolute(), "{} isn't installed", name_of(h));
        match h {
            Harness::Claude => {
                let mut c = command(&bin);
                c.args(["auth", "logout"]);
                stream(&app, &harness, "logout", c, Duration::from_secs(60), false).await
            }
            Harness::Codex => {
                let mut c = command(&bin);
                c.arg("logout");
                stream(&app, &harness, "logout", c, Duration::from_secs(60), false).await
            }
            _ => {
                // One `auth logout <provider>` per credential it lists.
                let mut list = command(&bin);
                list.args(["auth", "list"]);
                let providers = opencode_providers(&capture(list, READ_TIMEOUT).await?);
                anyhow::ensure!(!providers.is_empty(), "OpenCode has no credentials to remove");
                for p in providers {
                    let mut c = command(&bin);
                    c.args(["auth", "logout", &p]);
                    stream(&app, &harness, "logout", c, Duration::from_secs(60), false).await?;
                }
                Ok(())
            }
        }
    }
    .await;
    finish(&app, &harness, "logout", result).await
}

/// Runs an interactive command in a new Terminal window (macOS). Elsewhere the
/// reader is told the command to run themselves.
async fn open_in_terminal(command_line: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"\ntell application \"Terminal\" to activate",
            command_line.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let mut c = Command::new("osascript");
        c.arg("-e").arg(script);
        let status = c.hide_console().status().await?;
        anyhow::ensure!(status.success(), "could not open Terminal");
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        bail!("run `{command_line}` in a terminal")
    }
}

/// Sets up the pinned adapter for a CLI that has none on disk yet.
#[tauri::command]
pub async fn cli_install_adapter(app: AppHandle, harness: String) -> Result<(), String> {
    let h = parse_harness(&harness).map_err(|e| e.to_string())?;
    let result = async {
        let adapter = dialect::adapter_for(h).context("this CLI needs no adapter")?;
        emit(&app, &harness, "adapter", &format!("Installing {} {}", adapter.package, adapter.version), false, true);
        dialect::install_adapter(adapter).await.map(|_| ())
    }
    .await;
    finish(&app, &harness, "adapter", result).await
}

/// Checks for newer CLIs once a day while the switch is on, and tells the page
/// when one is found. Never updates anything: the reader presses Update.
pub fn start_daily_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(90)).await;
        loop {
            if crate::studio::read().await.update_check {
                check_all().await;
                let _ = app.emit("cli_updates_checked", ());
            }
            tokio::time::sleep(Duration::from_secs(24 * 3600)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `cargo test live_ -- --ignored --nocapture` on a machine with the CLIs.
    #[tokio::test]
    #[ignore = "runs the installed CLIs"]
    async fn live_overview_reads_versions_and_accounts() {
        let all = cli_overview().await;
        for c in &all {
            eprintln!("{c:?}");
        }
        assert!(all.iter().any(|c| c.installed && c.version.is_some()));
    }

    #[test]
    fn versions_are_found_in_each_clis_own_banner() {
        assert_eq!(parse_version("2.1.304 (Claude Code)\n").as_deref(), Some("2.1.304"));
        assert_eq!(parse_version("codex-cli 0.163.0").as_deref(), Some("0.163.0"));
        assert_eq!(parse_version("1.19.0").as_deref(), Some("1.19.0"));
        assert_eq!(parse_version("no version here"), None);
        assert_eq!(parse_version("v2"), None);
    }

    #[test]
    fn versions_compare_as_numbers() {
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(is_newer("2.1.305", "2.1.304"));
        assert!(!is_newer("2.1.304", "2.1.304"));
        assert!(!is_newer("1.9.9", "2.0.0"));
    }

    #[test]
    fn colour_codes_are_stripped_from_a_cli_listing() {
        assert_eq!(strip_ansi("\u{1b}[90m~/.local\u{1b}[0m x"), "~/.local x");
    }

    #[test]
    fn claude_status_json_becomes_an_account_line() {
        let signed = json!({"loggedIn": true, "email": "a@b.co", "subscriptionType": "max"});
        assert_eq!(claude_account(&signed), (true, Some("a@b.co \u{b7} Max".into())));
        assert_eq!(claude_account(&json!({"loggedIn": false})), (false, None));
        let no_plan = json!({"loggedIn": true, "email": "a@b.co"});
        assert_eq!(claude_account(&no_plan), (true, Some("a@b.co".into())));
    }

    #[test]
    fn opencode_credentials_are_read_from_its_listing() {
        let listing = "\u{1b}[0m\u{250c}  Credentials \u{1b}[90m~/.local/share/opencode/auth.json\n\u{2502}\n\u{25cf}  OpenCode Go \u{1b}[90mapi\n\u{2502}\n\u{2514}  1 credentials";
        assert_eq!(opencode_providers(listing), vec!["OpenCode Go".to_string()]);
        assert!(opencode_providers("nothing").is_empty());
    }

    #[test]
    fn update_follows_how_the_cli_was_installed() {
        let cmd = |h, p| update_command(h, p).map(|c| c.join(" "));
        assert_eq!(cmd(Harness::Claude, "/opt/homebrew/bin/claude").as_deref(), Some("claude update"));
        assert_eq!(cmd(Harness::OpenCode, "/Users/a/.opencode/bin/opencode").as_deref(), Some("opencode upgrade"));
        assert_eq!(cmd(Harness::Codex, "/opt/homebrew/bin/codex").as_deref(), Some("brew upgrade codex"));
        assert_eq!(
            cmd(Harness::Codex, "/Users/a/.nvm/versions/node/v22/bin/codex").as_deref(),
            Some("npm install -g @openai/codex@latest")
        );
        assert_eq!(cmd(Harness::Codex, "/usr/local/bin/codex"), None, "an unknown install is not guessed at");
    }
}
