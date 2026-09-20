//! What the agent's own `/context` command answers, read into rows.
//!
//! **The breakdown the CLI draws for itself does not cross ACP as data** — the
//! only context figures on the wire are `usage_update`'s `used`, `size` and
//! `cost`, and the six categories its TUI shows are computed inside the runtime
//! from state no client is sent. What *is* available is the command: `/context`
//! sent as a prompt is intercepted by the agent's own ACP layer (it never
//! reaches a model — the turn ends in about a second with `end_turn`), and its
//! answer is this block, one field per line.
//!
//! So this module is that answer's reader, and it is deliberately the *only*
//! place that knows the format. A shape this build cannot read answers `None`
//! rather than a half-filled snapshot, which leaves the composer's panel on its
//! own estimate instead of drawing numbers from a format that moved.
//!
//! **Only the reading of it lives here.** The rows it produces are
//! [`crate::context`]'s — this app's vocabulary, what the panel draws and what
//! the index stores — because the format belongs to the agent and the vocabulary
//! belongs to us.

use crate::context::{ContextComponent, ContextSnapshot};

/// Whether a block of text is a context report at all.
///
/// Used to tell the answer apart from everything else a child can say, and to
/// recognise one already sitting in a transcript. Cheap on purpose — two heading
/// lines, no parse — and **both of them**: one of these words on its own turns up
/// in ordinary prose about a project's components, and a report the agent cannot
/// state a budget for is still a report, so the budget line is deliberately not
/// part of the test.
pub fn is_report(text: &str) -> bool {
    text.lines().any(|line| line.starts_with("Context:"))
        && text.lines().any(|line| line.trim() == "Components:")
}

/// Reads the agent's answer, or `None` where it is not one.
///
/// The format is one field per line and the components are a list of
/// `- Label: 1,234 tokens` — so this walks lines rather than parsing a grammar,
/// and a line it does not know is skipped rather than fatal. The header fields
/// are required; the component list may be empty, which is an agent that counts
/// nothing yet.
pub fn parse(text: &str) -> Option<ContextSnapshot> {
    if !is_report(text) {
        return None;
    }

    let mut live = false;
    let mut model = String::new();
    let mut used = None;
    let mut max = None;
    let mut compaction = None;
    let mut components = Vec::new();
    let mut in_components = false;

    for line in text.lines().map(str::trim) {
        if let Some(value) = line.strip_prefix("- ") {
            if !in_components {
                continue;
            }
            // `Label: 1,234 tokens` — the count is the last number on the line,
            // and the label may hold a colon of its own.
            if let Some((label, rest)) = value.rsplit_once(':') {
                if let Some(tokens) = number(rest) {
                    components.push(ContextComponent {
                        label: label.trim().to_string(),
                        tokens,
                    });
                }
            }
            continue;
        }

        if line == "Components:" {
            in_components = true;
            continue;
        }

        let Some((key, rest)) = line.split_once(':') else {
            continue;
        };
        let rest = rest.trim();

        match key {
            "Context" => live = rest.eq_ignore_ascii_case("live"),
            "Model" => model = rest.to_string(),
            "Compaction" => compaction = Some(rest.to_string()),
            // `21,243 / 1,000,000 tokens (2%)` — the budget is the first number
            // and the window the second, and the share in brackets is the
            // agent's own rounding of the same two.
            "Budget" => {
                let mut numbers = rest.split('/').flat_map(split_numbers);
                used = numbers.next();
                max = numbers.next();
            }
            _ => {}
        }
    }

    // A block with no model line is not the report — it is some other prose that
    // happens to hold the words, which is the case the header check is for.
    if model.is_empty() {
        return None;
    }

    Some(ContextSnapshot {
        live,
        model,
        used,
        max,
        compaction,
        components,
    })
}

/// The first number in a fragment, thousands separators and all removed.
fn number(text: &str) -> Option<u64> {
    split_numbers(text).next()
}

/// Every run of digits in a fragment, longest-matching, as numbers.
fn split_numbers(text: &str) -> impl Iterator<Item = u64> + '_ {
    text.split(|c: char| !c.is_ascii_digit() && c != ',' && c != '_')
        .filter_map(|token| {
            let digits: String = token.chars().filter(char::is_ascii_digit).collect();
            (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real answer, captured from `mcode acp` by sending `/context` as a
    /// prompt. See `fixtures/README.md`.
    const REPORT: &str = include_str!("fixtures/context_report.txt");

    #[test]
    fn a_real_report_reads_into_its_rows() {
        let snapshot = parse(REPORT).expect("the capture is a report");

        assert!(snapshot.live);
        assert_eq!(snapshot.model, "custom_provider:opencode-go/deepseek-v4.1-flash");
        assert_eq!(snapshot.used, Some(21_243));
        assert_eq!(snapshot.max, Some(1_000_000));
        assert_eq!(snapshot.compaction.as_deref(), Some("never"));
        assert_eq!(
            snapshot.components,
            vec![
                ContextComponent { label: "System prompt".into(), tokens: 1_720 },
                ContextComponent { label: "Memory".into(), tokens: 0 },
                ContextComponent { label: "Tools".into(), tokens: 8_458 },
                ContextComponent { label: "Skills".into(), tokens: 2_486 },
                ContextComponent { label: "Messages".into(), tokens: 194 },
                ContextComponent { label: "Other".into(), tokens: 8_385 },
            ]
        );
    }

    /// The agent's answer when the runtime has nothing to count yet — the state
    /// a brand-new session is in, and the one a panel would otherwise read as an
    /// empty report.
    #[test]
    fn the_refusal_answers_nothing_rather_than_an_empty_report() {
        assert_eq!(parse("No Runtime context snapshot is available for this session yet."), None);
    }

    /// Ordinary prose that happens to hold the words is not a report, and neither
    /// is a block with the list but no header.
    #[test]
    fn prose_is_not_a_report() {
        assert!(!is_report("I looked at the Components: of your project and…"));
        assert!(!is_report("Components:\n- Tools: 10 tokens\n"));
        assert_eq!(parse("Components:\n- Tools: 10 tokens\n"), None);
    }

    /// A category this build has never heard of draws as itself: the list is the
    /// agent's, and a vendor that adds one should not lose a row.
    #[test]
    fn an_unknown_category_is_kept() {
        let text = "Context: live\nModel: m\nComponents:\n- Prompt cache: 12 tokens\n";
        let snapshot = parse(text).expect("a report");

        assert_eq!(snapshot.components[0].label, "Prompt cache");
    }

    /// Nothing about the block is fatal except the model line: a line that moved
    /// costs its own field and no more.
    #[test]
    fn a_line_that_moved_costs_only_itself() {
        let text = "Context: live\nModel: m\nBudget: unavailable\nComponents:\n- Tools: 1,200 tokens\n";
        let snapshot = parse(text).expect("a report");

        assert_eq!(snapshot.used, None);
        assert_eq!(snapshot.max, None);
        assert_eq!(snapshot.components[0].tokens, 1_200);
    }
}
