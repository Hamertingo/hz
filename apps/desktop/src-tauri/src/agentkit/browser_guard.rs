//! What a browsing agent is shown: secrets masked, repeats collapsed, challenges flagged, size capped.

use super::secrets::mask_sensitive;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// Default cap on text handed back, in characters.
pub const DEFAULT_LIMIT: usize = 12_000;

/// How much a page moved since the last time this guard saw it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Changed {
    Same,
    Small,
    Large,
}

/// What the agent gets to read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Filtered {
    pub text: String,
    pub captcha: bool,
    pub changed: Changed,
}

/// Remembers the last masked snapshot per page.
pub struct Guard {
    prev: HashMap<String, String>,
    limit: usize,
}

impl Default for Guard {
    fn default() -> Self {
        Self::new()
    }
}

const CAPTCHA_HINTS: &[&str] = &[
    "recaptcha",
    "hcaptcha",
    "captcha",
    "turnstile",
    "cf-challenge",
    "challenge-platform",
    "verify you are human",
    "verify you're human",
    "are you a robot",
    "i'm not a robot",
    "i am not a robot",
    "checking your browser",
    "just a moment...",
    "press & hold",
    "unusual traffic",
    "human verification",
];

fn value_attr() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"(?i)(value\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s\]\)]+)"#).unwrap())
}

fn is_password_line(lower: &str) -> bool {
    lower.contains("password") || lower.contains("passcode") || lower.contains("type=password") || lower.contains("type=\"password\"")
}

/// Hides what sits in password fields, then masks codes and tokens anywhere else.
fn mask_page(text: &str) -> String {
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            if !is_password_line(&line.to_lowercase()) {
                return line.to_string();
            }
            if value_attr().is_match(line) {
                return value_attr().replace_all(line, "${1}[hidden]").into_owned();
            }
            // Tree lines of the form `textbox "Password": secret` keep the label and lose the value.
            match line.rfind("\":") {
                Some(i) if !line[i + 2..].trim().is_empty() => format!("{} [hidden]", &line[..i + 2]),
                _ => line.to_string(),
            }
        })
        .collect();
    mask_sensitive(&lines.join("\n"))
}

/// True when the text looks like a CAPTCHA or bot challenge.
pub fn looks_like_captcha(text: &str) -> bool {
    let l = text.to_lowercase();
    CAPTCHA_HINTS.iter().any(|h| l.contains(h))
}

fn cut(text: &str, limit: usize) -> String {
    match text.char_indices().nth(limit) {
        None => text.to_string(),
        Some((i, _)) => {
            let rest = text[i..].chars().count();
            format!("{}\n[truncated: {rest} more characters not shown]", &text[..i])
        }
    }
}

impl Guard {
    /// A guard with the default size cap.
    pub fn new() -> Self {
        Self::with_limit(DEFAULT_LIMIT)
    }

    /// A guard that cuts answers at `limit` characters.
    pub fn with_limit(limit: usize) -> Self {
        Guard { prev: HashMap::new(), limit: limit.max(1) }
    }

    /// Forgets the snapshot of one page, so its next read is shown whole.
    pub fn forget(&mut self, page_key: &str) {
        self.prev.remove(page_key);
    }

    /// Masks, compares against the last read of this page and trims what the agent sees.
    pub fn filter(&mut self, page_key: &str, answer_text: &str) -> Filtered {
        let captcha = looks_like_captcha(answer_text);
        let masked = mask_page(answer_text);
        let old = self.prev.insert(page_key.to_string(), masked.clone());
        let Some(old) = old else {
            return Filtered { text: cut(&masked, self.limit), captcha, changed: Changed::Large };
        };
        if old == masked {
            return Filtered { text: "Page unchanged since the last read.".into(), captcha, changed: Changed::Same };
        }
        let seen: HashSet<&str> = old.lines().map(str::trim).collect();
        let total = masked.lines().filter(|l| !l.trim().is_empty()).count();
        let fresh: Vec<&str> = masked
            .lines()
            .filter(|l| !l.trim().is_empty() && !seen.contains(l.trim()))
            .collect();
        // Over a third new and a diff stops being easier to read than the page.
        if total == 0 || fresh.len() * 3 > total {
            return Filtered { text: cut(&masked, self.limit), captcha, changed: Changed::Large };
        }
        let body = if fresh.is_empty() {
            "Some lines were removed or reordered; nothing new appeared.".to_string()
        } else {
            fresh.join("\n")
        };
        let text = format!("Page changed slightly ({} of {total} lines are new). New lines only:\n{body}", fresh.len());
        Filtered { text: cut(&text, self.limit), captcha, changed: Changed::Small }
    }
}

fn bracket_noise() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s*\[(?:ref=|cursor=|active|checked|disabled|expanded|selected|level=|pressed|nth=|\d+\])[^\]]*\]?").unwrap())
}

fn leading_index() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\[\d+\]\s*").unwrap())
}

fn role_line() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"^([A-Za-z][A-Za-z-]*)(?:\s+"((?:[^"\\]|\\.)*)")?\s*:?\s*(.*)$"#).unwrap())
}

const KEEP_ROLE: &[&str] = &["button", "link", "textbox", "checkbox", "radio", "combobox", "searchbox", "tab", "menuitem", "switch", "option", "slider"];

/// Strips an accessibility tree to readable text: names and visible text, no refs or structure.
pub fn read_page(text: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    for raw in text.lines() {
        let mut line = raw.trim().trim_start_matches("- ").trim().to_string();
        if line.is_empty() || line.starts_with("/url:") || line.starts_with("/placeholder:") {
            continue;
        }
        line = leading_index().replace(&line, "").into_owned();
        line = bracket_noise().replace_all(&line, "").into_owned();
        let line = line.trim();
        let Some(c) = role_line().captures(line) else { continue };
        let role = c[1].to_lowercase();
        let name = c.get(2).map(|m| m.as_str().trim()).unwrap_or("");
        let rest = c[3].trim().trim_matches('"').trim();
        let readable = if role == "text" || role == "paragraph" || role == "statictext" {
            if name.is_empty() { rest.to_string() } else { name.to_string() }
        } else if role == "heading" {
            format!("# {}", if name.is_empty() { rest } else { name })
        } else if KEEP_ROLE.contains(&role.as_str()) {
            let label = if name.is_empty() { rest } else { name };
            if label.is_empty() { continue } else { format!("{role}: {label}") }
        } else if !name.is_empty() {
            name.to_string()
        } else if line.contains(' ') && !line.ends_with(':') && !role_line_is_bare(line) {
            line.to_string()
        } else {
            continue;
        };
        if readable.is_empty() || out.last() == Some(&readable) {
            continue;
        }
        out.push(readable);
    }
    out.join("\n")
}

fn role_line_is_bare(line: &str) -> bool {
    !line.contains(' ') || line.trim_end_matches(':').chars().all(|c| c.is_ascii_alphabetic() || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_read_is_whole_and_large() {
        let mut g = Guard::new();
        let f = g.filter("p", "hello\nworld");
        assert_eq!((f.text.as_str(), f.changed, f.captcha), ("hello\nworld", Changed::Large, false));
    }

    #[test]
    fn unchanged_page_is_one_line() {
        let mut g = Guard::new();
        g.filter("p", "a\nb");
        let f = g.filter("p", "a\nb");
        assert_eq!(f.changed, Changed::Same);
        assert!(!f.text.contains('\n') && f.text.contains("unchanged"));
    }

    #[test]
    fn small_change_returns_only_new_lines() {
        let mut g = Guard::new();
        let page: String = (0..20).map(|i| format!("line {i}\n")).collect();
        g.filter("p", &page);
        let f = g.filter("p", &format!("{page}brand new line"));
        assert_eq!(f.changed, Changed::Small);
        assert!(f.text.contains("brand new line") && !f.text.contains("line 7"));
    }

    #[test]
    fn large_change_returns_whole_page() {
        let mut g = Guard::new();
        g.filter("p", "a\nb\nc");
        let f = g.filter("p", "x\ny\nz");
        assert_eq!(f.changed, Changed::Large);
        assert_eq!(f.text, "x\ny\nz");
    }

    #[test]
    fn pages_are_tracked_separately() {
        let mut g = Guard::new();
        g.filter("a", "same");
        assert_eq!(g.filter("b", "same").changed, Changed::Large);
        assert_eq!(g.filter("a", "same").changed, Changed::Same);
        g.forget("a");
        assert_eq!(g.filter("a", "same").changed, Changed::Large);
    }

    #[test]
    fn truncates_on_char_boundary_with_note() {
        let mut g = Guard::with_limit(5);
        let f = g.filter("p", "ééééééééé");
        assert!(f.text.starts_with("ééééé\n[truncated: 4 more"), "{}", f.text);
    }

    #[test]
    fn short_text_is_not_truncated() {
        let mut g = Guard::with_limit(5);
        assert_eq!(g.filter("p", "12345").text, "12345");
    }

    #[test]
    fn masks_password_fields_and_codes() {
        let mut g = Guard::new();
        let f = g.filter("p", "textbox \"Password\" [value=\"hunter2\"]\nYour code is 482913\ntextbox \"Password\": s3cret");
        assert!(!f.text.contains("hunter2") && !f.text.contains("482913") && !f.text.contains("s3cret"), "{}", f.text);
        assert!(f.text.contains("Password"));
    }

    #[test]
    fn masked_secret_change_does_not_leak_through_diff() {
        let mut g = Guard::new();
        g.filter("p", "input type=password value=aaa\nrest");
        let f = g.filter("p", "input type=password value=bbb\nrest");
        assert_eq!(f.changed, Changed::Same);
    }

    #[test]
    fn detects_captchas() {
        for t in ["Please verify you are human", "div.g-recaptcha", "hCaptcha widget", "Cloudflare Turnstile", "Checking your browser before accessing"] {
            let mut g = Guard::new();
            assert!(g.filter("p", t).captcha, "{t}");
        }
        assert!(!Guard::new().filter("p", "A normal recipe page").captcha);
    }

    #[test]
    fn captcha_flag_survives_unchanged_note() {
        let mut g = Guard::new();
        g.filter("p", "verify you are human");
        let f = g.filter("p", "verify you are human");
        assert!(f.captcha && f.changed == Changed::Same);
    }

    #[test]
    fn read_page_strips_tree() {
        let tree = "- heading \"Shop\" [level=1] [ref=e1]\n  - link \"Home\" [ref=e2] [cursor=pointer]:\n    - /url: /home\n  - button \"Buy now\" [ref=e3]\n  - generic [ref=e4]:\n    - text: Only 3 left\n  - [12] textbox \"Email\"\n";
        assert_eq!(read_page(tree), "# Shop\nlink: Home\nbutton: Buy now\nOnly 3 left\ntextbox: Email");
    }

    #[test]
    fn read_page_drops_repeats_and_empty() {
        assert_eq!(read_page("- text: hi\n- text: hi\n\n- generic:\n"), "hi");
        assert_eq!(read_page(""), "");
    }
}
