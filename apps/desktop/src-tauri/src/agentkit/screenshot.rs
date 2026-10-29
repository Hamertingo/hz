//! Screenshots an agent takes of its screen: where they are saved, how the capture is requested, and what is shared.

use std::path::{Component, Path, PathBuf};

use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Folder under the workspace that holds them.
pub const FOLDER: &str = "screenshots";
const MAX_CAPTION: usize = 500;

/// Keeps letters, digits, `-` and `_`; everything else (dots and slashes included) becomes `_`, so a name can never climb out of its folder.
pub fn safe_name(raw: &str) -> String {
    let s: String = raw.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let s = s.trim_matches('_').to_string();
    if s.is_empty() { "agent".into() } else { s.chars().take(48).collect() }
}

/// `<workspace>/screenshots/<agent>-<yyyymmdd-hhmmss>.png`.
pub fn capture_path(workspace: &Path, agent: &str, now: DateTime<Utc>) -> PathBuf {
    workspace.join(FOLDER).join(format!("{}-{}.png", safe_name(agent), now.format("%Y%m%d-%H%M%S")))
}

/// A program and its arguments, returned as data so the caller decides how to run it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureCmd {
    pub program: String,
    pub args: Vec<String>,
}

/// Grabs a screen over its VNC port with `vncsnapshot`.
pub fn vnc_capture_cmd(vnc_port: u16, out: &Path) -> CaptureCmd {
    CaptureCmd {
        program: "vncsnapshot".into(),
        args: vec!["-allowblank".into(), format!("127.0.0.1::{vnc_port}"), out.to_string_lossy().into_owned()],
    }
}

/// A Chrome DevTools capture: list targets at `list_url`, then send `message` on the page's websocket.
#[derive(Debug, Clone, PartialEq)]
pub struct CdpCapture {
    pub list_url: String,
    pub message: serde_json::Value,
}

/// The DevTools request for a PNG of the page open on `cdp_port`.
pub fn cdp_capture(cdp_port: u16) -> CdpCapture {
    CdpCapture {
        list_url: format!("http://127.0.0.1:{cdp_port}/json"),
        message: serde_json::json!({"id": 1, "method": "Page.captureScreenshot", "params": {"format": "png"}}),
    }
}

/// Reads the image bytes out of a DevTools reply.
pub fn decode_cdp_response(reply: &str) -> anyhow::Result<Vec<u8>> {
    let v: serde_json::Value = serde_json::from_str(reply)?;
    let data = v
        .pointer("/result/data")
        .and_then(|d| d.as_str())
        .ok_or_else(|| anyhow::anyhow!("the browser sent no image"))?;
    Ok(base64::engine::general_purpose::STANDARD.decode(data)?)
}

/// Scales (w, h) down so the longer edge is at most `max_edge`; never enlarges, never returns a zero side.
pub fn shrink_dimensions(w: u32, h: u32, max_edge: u32) -> (u32, u32) {
    let longest = w.max(h);
    if longest <= max_edge || longest == 0 {
        return (w, h);
    }
    let scale = max_edge as f64 / longest as f64;
    (((w as f64 * scale).round() as u32).max(1), ((h as f64 * scale).round() as u32).max(1))
}

/// What the agent posts to the chat and the library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Share {
    pub path: PathBuf,
    pub caption: String,
}

impl Share {
    /// Builds the payload with the caption trimmed and capped.
    pub fn new(path: PathBuf, caption: &str) -> Self {
        Self { path, caption: caption.trim().chars().take(MAX_CAPTION).collect() }
    }
}

/// Turns a path the agent named into one inside the workspace; refuses `..` and absolute paths outside it.
pub fn resolve_share(workspace: &Path, requested: &str) -> anyhow::Result<PathBuf> {
    let p = Path::new(requested);
    let full = if p.is_absolute() {
        p.strip_prefix(workspace).map_err(|_| anyhow::anyhow!("that file is outside the workspace"))?.to_path_buf()
    } else {
        p.to_path_buf()
    };
    if full.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        anyhow::bail!("that path leaves the workspace");
    }
    Ok(workspace.join(full))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 3, 4, 5, 6, 7).unwrap()
    }

    #[test]
    fn path_is_timestamped_under_folder() {
        let p = capture_path(Path::new("/w"), "Ana", now());
        assert_eq!(p, PathBuf::from("/w/screenshots/Ana-20260304-050607.png"));
    }

    #[test]
    fn names_are_sanitised() {
        assert_eq!(safe_name("../../etc/passwd"), "etc_passwd");
        assert_eq!(safe_name("a b/c"), "a_b_c");
        assert_eq!(safe_name(""), "agent");
        assert_eq!(safe_name("///"), "agent");
        assert_eq!(safe_name(&"x".repeat(200)).len(), 48);
    }

    #[test]
    fn hostile_agent_name_stays_inside() {
        let p = capture_path(Path::new("/w"), "../../x", now());
        assert!(p.starts_with("/w/screenshots"));
        assert!(!p.to_string_lossy().contains(".."));
    }

    #[test]
    fn vnc_cmd_uses_port() {
        let c = vnc_capture_cmd(5902, Path::new("/o.png"));
        assert_eq!(c.program, "vncsnapshot");
        assert!(c.args.contains(&"127.0.0.1::5902".to_string()));
        assert_eq!(c.args.last().unwrap(), "/o.png");
    }

    #[test]
    fn cdp_request_shape() {
        let c = cdp_capture(9202);
        assert_eq!(c.list_url, "http://127.0.0.1:9202/json");
        assert_eq!(c.message["method"], "Page.captureScreenshot");
    }

    #[test]
    fn cdp_reply_decodes() {
        assert_eq!(decode_cdp_response(r#"{"id":1,"result":{"data":"aGVsbG8="}}"#).unwrap(), b"hello");
        assert!(decode_cdp_response(r#"{"id":1,"error":{}}"#).is_err());
        assert!(decode_cdp_response("nope").is_err());
        assert!(decode_cdp_response(r#"{"result":{"data":"!!"}}"#).is_err());
    }

    #[test]
    fn shrink_keeps_ratio_and_never_grows() {
        assert_eq!(shrink_dimensions(2000, 1000, 1000), (1000, 500));
        assert_eq!(shrink_dimensions(1000, 2000, 1000), (500, 1000));
        assert_eq!(shrink_dimensions(800, 600, 1000), (800, 600));
        assert_eq!(shrink_dimensions(0, 0, 100), (0, 0));
        assert_eq!(shrink_dimensions(10000, 1, 100), (100, 1));
    }

    #[test]
    fn caption_is_trimmed_and_capped() {
        let s = Share::new("/a.png".into(), &format!("  hi {}", "x".repeat(900)));
        assert!(s.caption.starts_with("hi"));
        assert_eq!(s.caption.chars().count(), 500);
    }

    #[test]
    fn share_paths_cannot_traverse() {
        let w = Path::new("/w");
        assert_eq!(resolve_share(w, "screenshots/a.png").unwrap(), PathBuf::from("/w/screenshots/a.png"));
        assert_eq!(resolve_share(w, "/w/screenshots/a.png").unwrap(), PathBuf::from("/w/screenshots/a.png"));
        assert!(resolve_share(w, "../secret").is_err());
        assert!(resolve_share(w, "a/../../b").is_err());
        assert!(resolve_share(w, "/etc/passwd").is_err());
        assert!(resolve_share(w, "/w/../etc/passwd").is_err());
    }
}
