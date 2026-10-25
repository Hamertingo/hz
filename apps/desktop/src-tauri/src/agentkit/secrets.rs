//! Named secrets: substitution into commands, scrubbing from output, masking in text.

use anyhow::{bail, Result};
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use regex::Regex;
use std::collections::BTreeMap;
use std::sync::OnceLock;

/// Where secret values live; the real keychain implements this later.
pub trait Store {
    /// Value stored under `name`, if any.
    fn get(&self, name: &str) -> Option<String>;
    /// Stores or replaces a value.
    fn set(&mut self, name: &str, value: &str) -> Result<()>;
    /// Removes a value; true when it existed.
    fn remove(&mut self, name: &str) -> bool;
    /// Every stored name, sorted.
    fn names(&self) -> Vec<String>;
}

/// In-memory store for tests and previews.
#[derive(Default, Debug)]
pub struct MemoryStore(BTreeMap<String, String>);

impl Store for MemoryStore {
    fn get(&self, name: &str) -> Option<String> {
        self.0.get(name).cloned()
    }
    fn set(&mut self, name: &str, value: &str) -> Result<()> {
        validate_name(name)?;
        if value.is_empty() {
            bail!("secret {name} has an empty value");
        }
        self.0.insert(name.to_string(), value.to_string());
        Ok(())
    }
    fn remove(&mut self, name: &str) -> bool {
        self.0.remove(name).is_some()
    }
    fn names(&self) -> Vec<String> {
        self.0.keys().cloned().collect()
    }
}

/// Names are capitals, digits, underscore and dot, at most 64 long.
pub fn validate_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 64 {
        bail!("secret name must be 1 to 64 characters");
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_' || c == '.')
    {
        bail!("secret name {name:?} may only use A-Z, 0-9, _ and .");
    }
    Ok(())
}

fn placeholder() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\{\{([A-Z0-9_.]+)\}\}").unwrap())
}

/// Replaces `{{NAME}}` with stored values in one pass; unknown names are an error naming all of them.
pub fn substitute(cmd: &str, store: &dyn Store) -> Result<(String, Vec<String>)> {
    let mut out = String::with_capacity(cmd.len());
    let mut used: Vec<String> = Vec::new();
    let mut unknown: Vec<String> = Vec::new();
    let mut last = 0;
    for c in placeholder().captures_iter(cmd) {
        let m = c.get(0).unwrap();
        let name = &c[1];
        out.push_str(&cmd[last..m.start()]);
        last = m.end();
        match store.get(name) {
            Some(v) => {
                out.push_str(&v);
                if !used.iter().any(|u| u == name) {
                    used.push(name.to_string());
                }
            }
            None => {
                if !unknown.iter().any(|u| u == name) {
                    unknown.push(name.to_string());
                }
            }
        }
    }
    if !unknown.is_empty() {
        bail!("unknown secret(s): {}", unknown.join(", "));
    }
    out.push_str(&cmd[last..]);
    Ok((out, used))
}

/// Pairs of (name, value) for the given names, skipping any the store lacks.
pub fn collect_values(store: &dyn Store, names: &[String]) -> Vec<(String, String)> {
    names
        .iter()
        .filter_map(|n| store.get(n).map(|v| (n.clone(), v)))
        .collect()
}

fn percent_encode(s: &str, space_plus: bool) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => o.push(b as char),
            b' ' if space_plus => o.push('+'),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}

fn variants(value: &str) -> Vec<String> {
    let mut v = vec![
        value.to_string(),
        STANDARD.encode(value),
        STANDARD_NO_PAD.encode(value),
        URL_SAFE.encode(value),
        URL_SAFE_NO_PAD.encode(value),
        percent_encode(value, false),
        percent_encode(value, true),
    ];
    v.sort();
    v.dedup();
    v
}

/// Replaces secret values, and their base64 and url-encoded forms, with `{{NAME}}`.
pub fn scrub(output: &str, values: &[(String, String)]) -> String {
    let mut subs: Vec<(String, String)> = Vec::new();
    for (name, value) in values {
        if value.is_empty() {
            continue;
        }
        for v in variants(value) {
            subs.push((v, format!("{{{{{name}}}}}")));
        }
    }
    // Longest first, so an encoded form is never half-eaten by its shorter raw cousin.
    subs.sort_by_key(|s| std::cmp::Reverse(s.0.len()));
    let mut out = output.to_string();
    for (from, to) in &subs {
        if out.contains(from.as_str()) {
            out = out.replace(from.as_str(), to);
        }
    }
    out
}

struct Masks {
    kv: Regex,
    auth: Regex,
    bearer: Regex,
    code: Regex,
    card: Regex,
    hex: Regex,
    tok: Regex,
}

fn masks() -> &'static Masks {
    static M: OnceLock<Masks> = OnceLock::new();
    M.get_or_init(|| Masks {
        kv: Regex::new(r#"(?i)([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|otp|api[_-]?key|code)[A-Za-z0-9_.-]*["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)"#).unwrap(),
        auth: Regex::new(r"(?i)(authorization\s*[:=]\s*)[^\r\n]+").unwrap(),
        bearer: Regex::new(r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}").unwrap(),
        code: Regex::new(r"(?i)\b((?:code|otp|pin)\b\s*(?:is|:|=)?\s*)\d{4,8}\b").unwrap(),
        card: Regex::new(r"\b\d(?:[ -]?\d){12,18}\b").unwrap(),
        hex: Regex::new(r"\b[0-9a-fA-F]{32,}\b").unwrap(),
        tok: Regex::new(r"([^A-Za-z0-9+/_=.-]|^)([A-Za-z0-9+/_-]{32,}={0,2})").unwrap(),
    })
}

/// Luhn checksum, the test every real card number passes.
pub fn luhn_valid(digits: &str) -> bool {
    let mut sum = 0;
    for (i, c) in digits.chars().rev().enumerate() {
        let Some(mut d) = c.to_digit(10) else { return false };
        if i % 2 == 1 {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
    }
    sum % 10 == 0
}

/// Hides passwords, one-time codes, auth headers, long tokens and card-like numbers in free text.
pub fn mask_sensitive(text: &str) -> String {
    let m = masks();
    let s = m.kv.replace_all(text, "${1}[hidden]");
    let s = m.auth.replace_all(&s, "${1}[hidden]");
    let s = m.bearer.replace_all(&s, "${1}[hidden]");
    let s = m.code.replace_all(&s, "${1}[hidden]");
    let s = m.card.replace_all(&s, |c: &regex::Captures| {
        let raw = &c[0];
        let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
        let separated = raw.len() != digits.len();
        if (13..=19).contains(&digits.len()) && (separated || luhn_valid(&digits)) {
            "[card hidden]".to_string()
        } else {
            raw.to_string()
        }
    });
    let s = m.hex.replace_all(&s, "[hidden]");
    let s = m.tok.replace_all(&s, |c: &regex::Captures| {
        let t = &c[2];
        let mixed = t.chars().any(|c| c.is_ascii_uppercase())
            && t.chars().any(|c| c.is_ascii_lowercase())
            && t.chars().any(|c| c.is_ascii_digit());
        if mixed && !t.starts_with('/') {
            format!("{}[hidden]", &c[1])
        } else {
            c[0].to_string()
        }
    });
    s.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> MemoryStore {
        let mut s = MemoryStore::default();
        s.set("GH.TOKEN", "ghp_abc123XYZ").unwrap();
        s.set("DB_PASS", "p@ss word").unwrap();
        s
    }

    #[test]
    fn names_are_validated() {
        for ok in ["A", "GH.TOKEN", "A_1"] {
            assert!(validate_name(ok).is_ok(), "{ok}");
        }
        for bad in ["", "lower", "A-B", "A B", "É", &"A".repeat(65)] {
            assert!(validate_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn store_rejects_bad_name_and_empty_value() {
        let mut s = MemoryStore::default();
        assert!(s.set("bad", "x").is_err());
        assert!(s.set("OK", "").is_err());
        assert!(s.set("OK", "v").is_ok());
        assert_eq!(s.names(), vec!["OK"]);
        assert!(s.remove("OK"));
        assert!(!s.remove("OK"));
    }

    #[test]
    fn substitutes_and_lists_used() {
        let (c, used) = substitute("curl -H 'x: {{GH.TOKEN}}' {{GH.TOKEN}} {{DB_PASS}}", &store()).unwrap();
        assert_eq!(c, "curl -H 'x: ghp_abc123XYZ' ghp_abc123XYZ p@ss word");
        assert_eq!(used, vec!["GH.TOKEN", "DB_PASS"]);
    }

    #[test]
    fn unknown_names_are_listed() {
        let e = substitute("{{NOPE}} {{ALSO}} {{NOPE}}", &store()).unwrap_err().to_string();
        assert!(e.contains("NOPE") && e.contains("ALSO"));
        assert_eq!(e.matches("NOPE").count(), 1);
    }

    #[test]
    fn substitution_is_single_pass() {
        let mut s = MemoryStore::default();
        s.set("A", "{{B}}").unwrap();
        s.set("B", "boom").unwrap();
        assert_eq!(substitute("{{A}}", &s).unwrap().0, "{{B}}");
    }

    #[test]
    fn non_placeholders_are_left_alone() {
        let (c, u) = substitute("echo {{lower}} {{ }} {A}", &store()).unwrap();
        assert_eq!(c, "echo {{lower}} {{ }} {A}");
        assert!(u.is_empty());
    }

    #[test]
    fn scrub_removes_raw_base64_and_urlencoded() {
        let v = vec![("DB_PASS".to_string(), "p@ss word".to_string())];
        let b64 = STANDARD.encode("p@ss word");
        let out = scrub(&format!("a p@ss word b {b64} c p%40ss%20word d p%40ss+word"), &v);
        assert_eq!(out, "a {{DB_PASS}} b {{DB_PASS}} c {{DB_PASS}} d {{DB_PASS}}");
    }

    #[test]
    fn scrub_ignores_empty_values_and_handles_none() {
        let v = vec![("X".to_string(), String::new())];
        assert_eq!(scrub("keep", &v), "keep");
        assert_eq!(scrub("keep", &[]), "keep");
    }

    #[test]
    fn collect_values_skips_missing() {
        let got = collect_values(&store(), &["DB_PASS".into(), "NOPE".into()]);
        assert_eq!(got.len(), 1);
    }

    #[test]
    fn masks_key_value_pairs() {
        let t = mask_sensitive("user=bob password=hunter2 TOKEN: abc123 {\"api_key\": \"sk-9\"}");
        assert!(!t.contains("hunter2") && !t.contains("abc123") && !t.contains("sk-9"), "{t}");
        assert!(t.contains("user=bob"));
    }

    #[test]
    fn masks_codes_after_the_word_code() {
        let t = mask_sensitive("Your verification code is 482913. Order 123456 shipped.");
        assert!(!t.contains("482913"));
        assert!(t.contains("123456"));
    }

    #[test]
    fn masks_auth_headers() {
        let t = mask_sensitive("Authorization: Bearer abcdefghij123\nX-A: 1\nsent Bearer zzzzzzzzzz9");
        assert!(!t.contains("abcdefghij123") && !t.contains("zzzzzzzzzz9"), "{t}");
        assert!(t.contains("X-A: 1"));
    }

    #[test]
    fn masks_cards_and_tokens() {
        let t = mask_sensitive("card 4111 1111 1111 1111 and 4111111111111111 hex deadbeefdeadbeefdeadbeefdeadbeef b64 Zm9vYmFyQmF6MTIzNDU2Nzg5MEFCQ0RFRkdISUo");
        assert!(!t.contains("4111") && !t.contains("deadbeef") && !t.contains("Zm9v"), "{t}");
    }

    #[test]
    fn leaves_plain_numbers_paths_and_words_alone() {
        let t = "ts 1700000000000 path /usr/local/lib/python3/site-packages/very-long-name-1 slug my-long-lowercase-branch-name-for-the-feature";
        assert_eq!(mask_sensitive(t), t);
    }

    #[test]
    fn masking_is_idempotent() {
        let once = mask_sensitive("password=abc code: 123456");
        assert_eq!(mask_sensitive(&once), once);
    }
}
