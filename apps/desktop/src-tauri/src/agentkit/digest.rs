//! One-line digest of several unread agent messages.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const MAX_LEN: usize = 120;
const MIN_MEANINGFUL: usize = 3;
const FILLER_CHARS: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Msg {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Digest {
    /// The newest message the line summarises; the digest lives on that message.
    pub newest_id: String,
    pub line: String,
}

/// Per-chat digests keyed by chat id.
pub type Store = HashMap<String, Digest>;

/// Short acknowledgements like "On it" or "I'll look" carry nothing worth summarising.
pub fn is_filler(text: &str) -> bool {
    let t = text.trim();
    if t.chars().count() > FILLER_CHARS {
        return false;
    }
    let l = t.trim_end_matches(['.', '!', '…']).to_lowercase();
    const STARTS: [&str; 10] = ["on it", "i'll look", "i will look", "ok", "okay", "sure", "got it", "looking", "one sec", "let me"];
    t.is_empty() || STARTS.iter().any(|s| l.starts_with(s))
}

fn meaningful(msgs: &[Msg]) -> Vec<&Msg> {
    msgs.iter().filter(|m| !is_filler(&m.text)).collect()
}

/// True when there are at least three meaningful unread messages.
pub fn needs_digest(msgs: &[Msg]) -> bool {
    meaningful(msgs).len() >= MIN_MEANINGFUL
}

/// Prompt for a small model: oldest first, fillers skipped, asks for a single line.
pub fn build_prompt(msgs: &[Msg]) -> String {
    let mut p = String::from(
        "Summarise these unread messages from an assistant in ONE line of at most 100 characters. \
         Say what matters most; no quotes, no preamble.\n\n",
    );
    for (i, m) in meaningful(msgs).iter().enumerate() {
        let t: String = m.text.trim().chars().take(600).collect();
        p.push_str(&format!("{}. {}\n", i + 1, t));
    }
    p.push_str("\nOne line:");
    p
}

/// Trims quotes and line breaks off model output and caps it at 120 chars on a char boundary.
pub fn clean_digest(out: &str) -> String {
    let first = out.trim().lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let t = first.trim_matches(|c: char| matches!(c, '"' | '\'' | '`' | '“' | '”' | '‘' | '’') || c.is_whitespace());
    if t.chars().count() <= MAX_LEN {
        return t.to_string();
    }
    let cut: String = t.chars().take(MAX_LEN - 1).collect();
    format!("{}…", cut.trim_end())
}

/// Stores `line` for a chat on its newest message; an empty cleaned line removes the digest.
pub fn apply(store: &mut Store, chat: &str, newest_id: &str, line: &str) {
    let line = clean_digest(line);
    if line.is_empty() {
        store.remove(chat);
    } else {
        store.insert(chat.into(), Digest { newest_id: newest_id.into(), line });
    }
}

/// The digest line only while its newest message is still unread.
pub fn visible<'a>(digest: &'a Digest, unread_ids: &[String]) -> Option<&'a str> {
    unread_ids.contains(&digest.newest_id).then_some(digest.line.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(id: &str, t: &str) -> Msg {
        Msg { id: id.into(), text: t.into() }
    }

    #[test]
    fn filler_detected() {
        assert!(is_filler("On it"));
        assert!(is_filler("I'll look into it."));
        assert!(is_filler("  "));
        assert!(!is_filler("The invoice for March is overdue by 12 days"));
    }

    #[test]
    fn long_text_starting_with_ok_is_not_filler() {
        assert!(!is_filler("Okay so here is the full report with all the numbers"));
    }

    #[test]
    fn needs_three() {
        let a = vec![m("1", "Report ready for review"), m("2", "Found two bugs in checkout flow")];
        assert!(!needs_digest(&a));
        let mut b = a.clone();
        b.push(m("3", "Deployed the fix to staging server"));
        assert!(needs_digest(&b));
    }

    #[test]
    fn fillers_do_not_count() {
        let a = vec![m("1", "On it"), m("2", "Report ready for review"), m("3", "Okay"), m("4", "Found two bugs in checkout flow")];
        assert!(!needs_digest(&a));
    }

    #[test]
    fn prompt_skips_filler_and_keeps_order() {
        let a = vec![m("1", "First thing happened here"), m("2", "On it"), m("3", "Second thing happened here")];
        let p = build_prompt(&a);
        assert!(p.contains("1. First"));
        assert!(p.contains("2. Second"));
        assert!(!p.contains("On it"));
        assert!(p.contains("ONE line"));
    }

    #[test]
    fn clean_trims_quotes_and_lines() {
        assert_eq!(clean_digest("\"Two bugs fixed.\"\nextra"), "Two bugs fixed.");
        assert_eq!(clean_digest("\n\n  “hi”  \n"), "hi");
        assert_eq!(clean_digest(""), "");
    }

    #[test]
    fn clean_caps_on_char_boundary() {
        let s = "é".repeat(300);
        let c = clean_digest(&s);
        assert_eq!(c.chars().count(), MAX_LEN);
        assert!(c.ends_with('…'));
        let exact = "a".repeat(120);
        assert_eq!(clean_digest(&exact), exact);
    }

    #[test]
    fn apply_and_visible() {
        let mut s = Store::new();
        apply(&mut s, "c", "m3", "\"Three updates\"");
        let d = &s["c"];
        assert_eq!(d.line, "Three updates");
        assert_eq!(visible(d, &["m3".into()]), Some("Three updates"));
        assert_eq!(visible(d, &["m1".into()]), None);
        assert_eq!(visible(d, &[]), None);
    }

    #[test]
    fn apply_empty_removes() {
        let mut s = Store::new();
        apply(&mut s, "c", "m3", "x");
        apply(&mut s, "c", "m4", "  ");
        assert!(s.is_empty());
    }

    #[test]
    fn apply_moves_to_newest() {
        let mut s = Store::new();
        apply(&mut s, "c", "m3", "old");
        apply(&mut s, "c", "m6", "new");
        assert_eq!(s["c"].newest_id, "m6");
    }
}
