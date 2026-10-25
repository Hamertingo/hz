//! Group chat triage: decide who answers a message that names nobody with @.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub name: String,
    pub role: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pick {
    Everyone,
    Some(Vec<String>),
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Byte offsets in `hay` where `needle` occurs as a whole word (both already lowercase).
fn word_hits(hay: &str, needle: &str) -> Vec<usize> {
    if needle.is_empty() {
        return vec![];
    }
    hay.match_indices(needle)
        .map(|(i, _)| i)
        .filter(|&i| {
            let before = hay[..i].chars().next_back().is_none_or(|c| !is_word(c));
            let after = hay[i + needle.len()..].chars().next().is_none_or(|c| !is_word(c));
            before && after
        })
        .collect()
}

/// Names a member can be called: the full name, plus the first word when it is not shared with another member.
fn aliases(m: &Member, all: &[Member]) -> Vec<String> {
    let full = m.name.trim().to_lowercase();
    let mut v = vec![full.clone()];
    if let Some(first) = full.split_whitespace().next() {
        let shared = all.iter().filter(|o| o.name.trim().to_lowercase().split_whitespace().next() == Some(first)).count();
        if first != full && shared == 1 {
            v.push(first.to_string());
        }
    }
    v
}

/// Members written as "@Name" anywhere in the text, case-insensitive, in member order.
pub fn mentions(text: &str, members: &[Member]) -> Vec<String> {
    let t = text.to_lowercase();
    members
        .iter()
        .filter(|m| aliases(m, members).iter().any(|a| !word_hits(&t, &format!("@{a}")).is_empty()))
        .map(|m| m.name.clone())
        .collect()
}

const ADDRESS_LEADS: [&str; 9] = ["hey", "hi", "hello", "oi", "ola", "olá", "ei", "what about", "how about"];

/// Members addressed by name without @: "Davi, ...", "and you, Julia?", "hey Davi", or a trailing "Julia?".
pub fn named_as_words(text: &str, members: &[Member]) -> Vec<String> {
    let t = text.to_lowercase();
    members
        .iter()
        .filter(|m| {
            aliases(m, members).iter().any(|a| {
                word_hits(&t, a).into_iter().any(|i| {
                    let before = t[..i].trim_end();
                    let after = t[i + a.len()..].trim_start();
                    let sentence_start = before.is_empty() || before.ends_with(['.', '!', '?', '\n']);
                    let vocative = after.starts_with([',', ':']) && sentence_start;
                    let lead = before.ends_with("you,")
                        || before.ends_with("and you")
                        || ADDRESS_LEADS.iter().any(|l| before.strip_suffix(l).is_some_and(|r| r.chars().next_back().is_none_or(|c| !is_word(c))));
                    let asking = after.starts_with('?') && after[1..].trim().is_empty();
                    vocative || lead || asking
                })
            })
        })
        .map(|m| m.name.clone())
        .collect()
}

fn is_greeting(text: &str) -> bool {
    const G: [&str; 14] = [
        "hi", "hello", "hey", "good morning", "good evening", "good afternoon", "oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "everyone", "pessoal",
    ];
    let t = text.to_lowercase();
    let words = t.split(|c: char| !is_word(c)).filter(|w| !w.is_empty()).count();
    words <= 4 && G.iter().any(|g| !word_hits(&t, g).is_empty())
}

const STOP: [&str; 12] = ["the", "and", "for", "with", "that", "this", "from", "manager", "assistant", "agent", "team", "lead"];

/// "logo"/"logos", "design"/"designer": a shared prefix of 4+ chars covering all but one char of the shorter word.
fn near_form(a: &str, b: &str) -> bool {
    let p = a.chars().zip(b.chars()).take_while(|(x, y)| x == y).count();
    let short = a.chars().count().min(b.chars().count());
    p >= 4 && p + 1 >= short
}

fn role_score(text: &str, role: &str) -> usize {
    let tw: Vec<String> = text.to_lowercase().split(|c: char| !is_word(c)).filter(|w| !w.is_empty()).map(String::from).collect();
    role.to_lowercase()
        .split(|c: char| !is_word(c))
        .filter(|w| w.chars().count() >= 4 && !STOP.contains(w))
        .filter(|rw| tw.iter().any(|w| w == rw || near_form(w, rw)))
        .count()
}

/// Chooses who answers: @mentions, names as words, a pure greeting (everyone), the member being replied to, then role-keyword fit; anything else is everyone.
pub fn pick(text: &str, members: &[Member], reply_to: Option<&str>) -> Pick {
    if members.is_empty() {
        return Pick::Everyone;
    }
    let m = mentions(text, members);
    if !m.is_empty() {
        return Pick::Some(m);
    }
    let w = named_as_words(text, members);
    if !w.is_empty() {
        return Pick::Some(w);
    }
    if is_greeting(text) {
        return Pick::Everyone;
    }
    if let Some(r) = reply_to {
        if let Some(mem) = members.iter().find(|x| x.name.eq_ignore_ascii_case(r)) {
            return Pick::Some(vec![mem.name.clone()]);
        }
    }
    let scores: Vec<usize> = members.iter().map(|x| role_score(text, &x.role)).collect();
    let best = scores.iter().copied().max().unwrap_or(0);
    if best == 0 {
        return Pick::Everyone;
    }
    let names: Vec<String> = members.iter().zip(&scores).filter(|(_, s)| **s == best).map(|(m, _)| m.name.clone()).collect();
    if names.len() == members.len() {
        Pick::Everyone
    } else {
        Pick::Some(names)
    }
}

/// Prompt for the quick-model variant: names the members and asks for a comma list or ALL.
pub fn build_prompt(text: &str, members: &[Member]) -> String {
    let roster: Vec<String> = members.iter().map(|m| format!("- {}: {}", m.name, m.role)).collect();
    format!(
        "A message was posted in a group chat. Decide who should answer it.\nMembers:\n{}\n\nMessage: {}\n\n\
         Reply with only the names of the members who should answer, separated by commas, or ALL if everyone should or you cannot tell.",
        roster.join("\n"),
        text.trim()
    )
}

/// Reads the model's answer; junk, empty or unknown names fall back to everyone.
pub fn parse_model_pick(output: &str, members: &[Member]) -> Pick {
    let o = output.to_lowercase();
    let found: Vec<String> = members
        .iter()
        .filter(|m| aliases(m, members).iter().any(|a| !word_hits(&o, a).is_empty()))
        .map(|m| m.name.clone())
        .collect();
    if found.is_empty() || found.len() == members.len() {
        Pick::Everyone
    } else {
        Pick::Some(found)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn team() -> Vec<Member> {
        [("Davi", "designer, logos and branding"), ("Julia", "accountant, taxes and invoices"), ("Ana Maria", "developer, backend code")]
            .iter()
            .map(|(n, r)| Member { name: n.to_string(), role: r.to_string() })
            .collect()
    }

    #[test]
    fn at_mentions_case_insensitive() {
        assert_eq!(mentions("hey @davi and @JULIA look", &team()), vec!["Davi", "Julia"]);
        assert!(mentions("email me at x@davi.com", &team()).is_empty());
        assert!(mentions("no mention here", &team()).is_empty());
    }

    #[test]
    fn mention_needs_word_end() {
        assert!(mentions("@Davidson is here", &team()).is_empty());
        assert_eq!(mentions("@ana maria please", &team()), vec!["Ana Maria"]);
        assert_eq!(mentions("@ana please", &team()), vec!["Ana Maria"]);
    }

    #[test]
    fn vocative_forms() {
        assert_eq!(named_as_words("Davi, can you make a logo?", &team()), vec!["Davi"]);
        assert_eq!(named_as_words("I did the taxes. And you, Julia?", &team()), vec!["Julia"]);
        assert_eq!(named_as_words("what do you think, Julia?", &team()), vec!["Julia"]);
        assert_eq!(named_as_words("hey davi", &team()), vec!["Davi"]);
    }

    #[test]
    fn name_mid_sentence_is_not_addressing() {
        assert!(named_as_words("Davi sent the file yesterday", &team()).is_empty());
        assert!(named_as_words("tell me about Julia's trip", &team()).is_empty());
    }

    #[test]
    fn pick_prefers_mentions_over_words() {
        assert_eq!(pick("Davi, ask @Julia about it", &team(), None), Pick::Some(vec!["Julia".into()]));
    }

    #[test]
    fn pick_words_then_reply_to() {
        assert_eq!(pick("Davi, a logo please", &team(), None), Pick::Some(vec!["Davi".into()]));
        assert_eq!(pick("and what about the deadline", &team(), Some("julia")), Pick::Some(vec!["Julia".into()]));
        assert_eq!(pick("whatever", &team(), Some("Nobody")), Pick::Everyone);
    }

    #[test]
    fn pick_by_role() {
        assert_eq!(pick("I need a new logo for the site", &team(), None), Pick::Some(vec!["Davi".into()]));
        assert_eq!(pick("when are my taxes due?", &team(), None), Pick::Some(vec!["Julia".into()]));
        assert_eq!(pick("the backend code is crashing", &team(), None), Pick::Some(vec!["Ana Maria".into()]));
    }

    #[test]
    fn greetings_go_to_everyone_even_with_reply_to() {
        assert_eq!(pick("Good morning!", &team(), Some("Davi")), Pick::Everyone);
        assert_eq!(pick("hi", &team(), None), Pick::Everyone);
    }

    #[test]
    fn cannot_tell_is_everyone() {
        assert_eq!(pick("what is the weather like", &team(), None), Pick::Everyone);
        assert_eq!(pick("anything", &[], None), Pick::Everyone);
    }

    #[test]
    fn prompt_lists_roster() {
        let p = build_prompt("who does taxes?", &team());
        assert!(p.contains("- Julia: accountant"));
        assert!(p.contains("who does taxes?"));
        assert!(p.contains("ALL"));
    }

    #[test]
    fn parse_model_variants() {
        let t = team();
        assert_eq!(parse_model_pick("Julia", &t), Pick::Some(vec!["Julia".into()]));
        assert_eq!(parse_model_pick("  davi, julia.\n", &t), Pick::Some(vec!["Davi".into(), "Julia".into()]));
        assert_eq!(parse_model_pick("ALL", &t), Pick::Everyone);
        assert_eq!(parse_model_pick("", &t), Pick::Everyone);
        assert_eq!(parse_model_pick("I think nobody known?!", &t), Pick::Everyone);
        assert_eq!(parse_model_pick("Davi, Julia, Ana Maria", &t), Pick::Everyone);
    }
}
