//! The page an agent's screen shows while the agent works somewhere else, so it never sits blank.

use base64::Engine;

/// Seconds between automatic reloads of the page.
pub const REFRESH_SECONDS: u32 = 3;

/// Escapes text for HTML body and attribute use.
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// The full page: the agent's name, what it does now and its last steps (newest first as given). Reloads itself.
pub fn render(agent_name: &str, now_step: &str, recent_steps: &[String]) -> String {
    let steps: String = recent_steps.iter().take(8).map(|s| format!("<li>{}</li>", escape(s))).collect();
    let now = if now_step.trim().is_empty() { "Getting ready".to_string() } else { escape(now_step.trim()) };
    format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="{REFRESH_SECONDS}">
<meta name="color-scheme" content="light dark">
<title>{name}</title>
<style>
:root{{--bg:#f6f5f2;--fg:#1d1d1b;--muted:#6b6a66;--accent:#d4a017}}
@media (prefers-color-scheme:dark){{:root{{--bg:#161615;--fg:#f1f0ec;--muted:#9a9890;--accent:#f0c040}}}}
body{{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font:16px system-ui,sans-serif}}
h1{{font-size:28px;margin:0 0 8px}}
.now{{font-size:20px;color:var(--accent);margin-bottom:24px}}
ul{{list-style:none;padding:0;margin:0;color:var(--muted);max-width:560px}}
li{{padding:4px 0}}
</style></head><body>
<h1>{name}</h1>
<div class="now">{now}</div>
<ul>{steps}</ul>
</body></html>"#,
        name = escape(agent_name),
    )
}

/// The page as a `data:` URL the browser can open without a server.
pub fn data_url(html: &str) -> String {
    format!("data:text/html;base64,{}", base64::engine::general_purpose::STANDARD.encode(html))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_everything_risky() {
        assert_eq!(escape(r#"<a href="x">&'"#), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
    }

    #[test]
    fn page_names_agent_and_step() {
        let h = render("Ana", "Opening the inbox", &["Searched".into()]);
        assert!(h.contains("<h1>Ana</h1>"));
        assert!(h.contains("Opening the inbox"));
        assert!(h.contains("<li>Searched</li>"));
    }

    #[test]
    fn page_refreshes() {
        assert!(render("a", "b", &[]).contains(r#"http-equiv="refresh" content="3""#));
    }

    #[test]
    fn page_supports_both_themes() {
        let h = render("a", "b", &[]);
        assert!(h.contains("prefers-color-scheme:dark"));
        assert!(h.contains(r#"name="color-scheme""#));
    }

    #[test]
    fn injected_markup_is_inert() {
        let h = render("<script>x</script>", "<img onerror=y>", &["<b>z</b>".into()]);
        assert!(!h.contains("<script>"));
        assert!(!h.contains("<img onerror"));
        assert!(!h.contains("<b>z"));
    }

    #[test]
    fn empty_step_has_fallback() {
        assert!(render("a", "  ", &[]).contains("Getting ready"));
    }

    #[test]
    fn only_recent_steps_shown() {
        let steps: Vec<String> = (0..20).map(|i| format!("s{i}")).collect();
        let h = render("a", "b", &steps);
        assert_eq!(h.matches("<li>").count(), 8);
    }

    #[test]
    fn data_url_round_trips() {
        let u = data_url("<p>hi</p>");
        let b64 = u.strip_prefix("data:text/html;base64,").unwrap();
        let back = base64::engine::general_purpose::STANDARD.decode(b64).unwrap();
        assert_eq!(back, b"<p>hi</p>");
    }
}
