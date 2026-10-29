//! Rich answers: native charts and small sandboxed widgets.

use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Component, Path};

pub const MAX_POINTS: usize = 200;
pub const MAX_TITLE: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Bar,
    Line,
    Pie,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Chart {
    pub title: String,
    pub kind: Kind,
    pub series: Vec<(String, f64)>,
    #[serde(default)]
    pub unit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Widget {
    pub title: String,
    pub html: String,
}

/// Checks a chart is drawable: titled, 1..=200 points, finite values, and a positive total for pies.
pub fn validate_chart(c: &Chart) -> Result<(), String> {
    let t = c.title.trim();
    if t.is_empty() {
        return Err("chart needs a title".into());
    }
    if t.chars().count() > MAX_TITLE {
        return Err(format!("title is longer than {MAX_TITLE} characters"));
    }
    if c.series.is_empty() {
        return Err("chart has no data".into());
    }
    if c.series.len() > MAX_POINTS {
        return Err(format!("chart has more than {MAX_POINTS} points"));
    }
    if let Some((l, v)) = c.series.iter().find(|(_, v)| !v.is_finite()) {
        return Err(format!("value for '{l}' is not a finite number ({v})"));
    }
    if c.kind == Kind::Pie {
        if c.series.iter().any(|(_, v)| *v < 0.0) {
            return Err("a pie chart cannot have negative values".into());
        }
        if c.series.iter().map(|(_, v)| v).sum::<f64>() <= 0.0 {
            return Err("a pie chart needs a positive total".into());
        }
    }
    Ok(())
}

/// The payload the UI renders: `{type:"chart", ...}`.
pub fn chart_payload(c: &Chart) -> Value {
    json!({
        "type": "chart",
        "title": c.title,
        "kind": c.kind,
        "series": c.series.iter().map(|(l, v)| json!({"label": l, "value": v})).collect::<Vec<_>>(),
        "unit": c.unit,
    })
}

/// The payload the UI renders: `{type:"widget", ...}`; `html` should already be wrapped and image-embedded.
pub fn widget_payload(w: &Widget) -> Value {
    json!({"type": "widget", "title": w.title, "html": w.html})
}

/// Wraps widget HTML in a document whose CSP blocks the network and whose `hz.reply(text)` posts to the parent.
pub fn sandbox_wrap(html: &str) -> String {
    let base_or_meta = Regex::new(r"(?is)<(base|meta\s+http-equiv)\b[^>]*>").unwrap();
    let body = base_or_meta.replace_all(html, "");
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'\">\
<script>window.hz={{reply:function(t){{parent.postMessage({{type:'hz-reply',text:String(t)}},'*')}}}};</script>\
</head><body>{body}</body></html>"
    )
}

fn placeholder(why: &str) -> String {
    let svg = format!(
        "<svg xmlns='http://www.w3.org/2000/svg' width='160' height='60'><rect width='160' height='60' fill='#eee'/><text x='8' y='34' font-size='12' fill='#666'>{why}</text></svg>"
    );
    format!("data:image/svg+xml;base64,{}", STANDARD.encode(svg))
}

fn mime_of(p: &Path) -> Option<&'static str> {
    match p.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Replaces `src="file:name"` with a data URI read from `folder`; errors on path traversal, uses a placeholder for missing, unsupported or over-`max_bytes` files.
pub fn embed_images(html: &str, folder: &Path, max_bytes: u64) -> Result<String, String> {
    let re = Regex::new(r#"(?i)src\s*=\s*(["'])file:([^"']*)["']"#).unwrap();
    let root = folder.canonicalize().map_err(|e| format!("folder unreadable: {e}"))?;
    let mut err = None;
    let out = re.replace_all(html, |c: &regex::Captures| {
        let q = &c[1];
        let name = &c[2];
        let rel = Path::new(name);
        if name.is_empty() || rel.is_absolute() || rel.components().any(|p| !matches!(p, Component::Normal(_))) {
            err.get_or_insert(format!("image path '{name}' leaves the agent folder"));
            return String::new();
        }
        let uri = match root.join(rel).canonicalize() {
            Err(_) => placeholder("missing image"),
            Ok(full) if !full.starts_with(&root) => {
                err.get_or_insert(format!("image path '{name}' leaves the agent folder"));
                String::new()
            }
            Ok(full) => match (mime_of(&full), std::fs::metadata(&full)) {
                (None, _) => placeholder("unsupported image"),
                (_, Err(_)) => placeholder("missing image"),
                (Some(_), Ok(m)) if m.len() > max_bytes => placeholder("image too large"),
                (Some(mime), Ok(_)) => match std::fs::read(&full) {
                    Ok(b) => format!("data:{mime};base64,{}", STANDARD.encode(b)),
                    Err(_) => placeholder("missing image"),
                },
            },
        };
        format!("src={q}{uri}{q}")
    });
    match err {
        Some(e) => Err(e),
        None => Ok(out.into_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chart(kind: Kind, series: Vec<(&str, f64)>) -> Chart {
        Chart { title: "Sales".into(), kind, series: series.into_iter().map(|(a, b)| (a.into(), b)).collect(), unit: Some("EUR".into()) }
    }

    fn tmp() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("hz-genui-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn valid_chart_passes() {
        assert!(validate_chart(&chart(Kind::Bar, vec![("a", 1.0), ("b", -2.0)])).is_ok());
    }

    #[test]
    fn rejects_empty_and_titles() {
        assert!(validate_chart(&chart(Kind::Bar, vec![])).is_err());
        let mut c = chart(Kind::Line, vec![("a", 1.0)]);
        c.title = "  ".into();
        assert!(validate_chart(&c).is_err());
        c.title = "x".repeat(121);
        assert!(validate_chart(&c).is_err());
        c.title = "é".repeat(120);
        assert!(validate_chart(&c).is_ok());
    }

    #[test]
    fn rejects_non_finite() {
        assert!(validate_chart(&chart(Kind::Bar, vec![("a", f64::NAN)])).is_err());
        assert!(validate_chart(&chart(Kind::Bar, vec![("a", f64::INFINITY)])).is_err());
    }

    #[test]
    fn point_limit() {
        let ok: Vec<(String, f64)> = (0..200).map(|i| (i.to_string(), 1.0)).collect();
        let mut c = Chart { title: "t".into(), kind: Kind::Line, series: ok, unit: None };
        assert!(validate_chart(&c).is_ok());
        c.series.push(("x".into(), 1.0));
        assert!(validate_chart(&c).is_err());
    }

    #[test]
    fn pie_rules() {
        assert!(validate_chart(&chart(Kind::Pie, vec![("a", 1.0), ("b", -1.0)])).is_err());
        assert!(validate_chart(&chart(Kind::Pie, vec![("a", 0.0)])).is_err());
        assert!(validate_chart(&chart(Kind::Pie, vec![("a", 3.0), ("b", 1.0)])).is_ok());
    }

    #[test]
    fn payload_shapes() {
        let p = chart_payload(&chart(Kind::Pie, vec![("a", 1.5)]));
        assert_eq!(p["type"], "chart");
        assert_eq!(p["kind"], "pie");
        assert_eq!(p["series"][0]["label"], "a");
        assert_eq!(p["series"][0]["value"], 1.5);
        assert_eq!(p["unit"], "EUR");
        let w = widget_payload(&Widget { title: "W".into(), html: "<b>x</b>".into() });
        assert_eq!(w, json!({"type":"widget","title":"W","html":"<b>x</b>"}));
    }

    #[test]
    fn sandbox_has_csp_and_bridge() {
        let d = sandbox_wrap("<button onclick=\"hz.reply('hi')\">go</button>");
        assert!(d.contains("default-src 'none'"));
        assert!(d.contains("img-src data:"));
        assert!(!d.contains("connect-src"));
        assert!(d.contains("parent.postMessage"));
        assert!(d.contains("window.hz="));
        assert!(d.contains("<button"));
    }

    #[test]
    fn sandbox_strips_base_and_meta_override() {
        let d = sandbox_wrap("<base href=\"https://evil\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src *\"><p>x</p>");
        assert!(!d.contains("evil"));
        assert!(!d.contains("default-src *"));
        assert!(d.contains("<p>x</p>"));
    }

    #[test]
    fn embeds_image_as_data_uri() {
        let d = tmp();
        std::fs::write(d.join("a.png"), [1u8, 2, 3]).unwrap();
        let out = embed_images("<img src=\"file:a.png\">", &d, 100).unwrap();
        assert!(out.contains("src=\"data:image/png;base64,AQID\""));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn rejects_traversal() {
        let d = tmp();
        for bad in ["../x.png", "/etc/passwd", "a/../../x.png", ""] {
            assert!(embed_images(&format!("<img src=\"file:{bad}\">"), &d, 100).is_err(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn oversize_missing_unsupported_get_placeholder() {
        let d = tmp();
        std::fs::write(d.join("big.png"), vec![0u8; 50]).unwrap();
        std::fs::write(d.join("x.exe"), [0u8]).unwrap();
        let out = embed_images("<img src='file:big.png'><img src=\"file:none.png\"><img src=\"file:x.exe\">", &d, 10).unwrap();
        assert_eq!(out.matches("data:image/svg+xml;base64,").count(), 3);
        assert!(!out.contains("file:"));
        let _ = std::fs::remove_dir_all(d);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_rejected() {
        let d = tmp();
        let outside = tmp();
        std::fs::write(outside.join("s.png"), [1u8]).unwrap();
        std::os::unix::fs::symlink(&outside, d.join("link")).unwrap();
        assert!(embed_images("<img src=\"file:link/s.png\">", &d, 100).is_err());
        let _ = std::fs::remove_dir_all(d);
        let _ = std::fs::remove_dir_all(outside);
    }

    #[test]
    fn leaves_other_srcs_alone() {
        let d = tmp();
        let h = "<img src=\"data:image/png;base64,AA\">";
        assert_eq!(embed_images(h, &d, 1).unwrap(), h);
        let _ = std::fs::remove_dir_all(d);
    }
}
