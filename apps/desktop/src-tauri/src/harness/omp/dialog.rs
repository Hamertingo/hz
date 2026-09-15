//! omp's dialogs, turned into the card Dray already draws.
//!
//! **This is where omp's permission gate lives, and it is not an extension's.**
//! pi has no gate at all — every approval in pi comes from a package the reader
//! installs — which is why the pi harness embeds an extension of Dray's own.
//! omp builds one in: with `--approval-mode always-ask` it raises the approval
//! itself, on the *same* `extension_ui_request` channel, captured as
//!
//! ```json
//! {"type":"extension_ui_request","id":"…","method":"select",
//!  "title":"Allow tool: bash\nCommand: echo dray-omp-probe",
//!  "options":["Approve","Deny"]}
//! ```
//!
//! So nothing is embedded here, and the reader-facing surface is this module
//! unchanged from pi's: the same four blocking methods, the same reply shapes,
//! the same card. The one thing that differs is *who* asks.
//!
//! Nine methods reach the wire. Four block until they are answered and are what
//! this module builds a card for; the rest are announcements omp registers no
//! waiter for.
//!
//! Which is which is read off `docs/rpc.md` and stated here in two lists rather
//! than inferred, because both ways of being wrong are silent: omp drops a reply
//! nobody is waiting for without complaining, and a blocking method mistaken for
//! an announcement hangs the tool call that raised it.
//!
//! The card is [`QuestionsAsked`](crate::events::AgentEventPayload::QuestionsAsked),
//! not a permission request, and that is the honest reading rather than a reuse
//! of convenience: nothing is being consented to by Dray, the call runs either
//! way, and the answer *is* the reply. An Allow/Deny pair of Dray's own over
//! omp's `select` would describe the wrong act — omp composes its own labels and
//! decides what each means.

use serde_json::{json, Value};
use std::collections::HashMap;

use super::parser::OmpEvent;
use crate::events::{Question, QuestionOption};
use crate::harness::claude_code::permissions::{PendingRequest, Reply};

/// The methods that block. Kept as one list because the read loop and this
/// module have to agree on which lines get a card and which get dropped, and
/// disagreeing either hangs a turn or files an announcement as a coverage gap.
///
/// `editor` is the one with no deadline of its own, exactly as in pi — see this
/// module's own header for why the pi list transfers verbatim.
pub const BLOCKING: [&str; 4] = ["select", "confirm", "input", "editor"];

/// The methods omp sends and registers no waiter for. A reply to one of these is
/// dropped, so refusing them would file ordinary UI messages as coverage gaps
/// and tell the reader they were refused something they were only being told.
///
/// **`cancel` is here rather than with the four, and that is a reading of its
/// shape rather than of the doc.** `docs/rpc.md` lists it in the same block as
/// `select` and `confirm`, but its frame is `{method: "cancel", targetId}` — it
/// names *another* dialog to withdraw, and carries no question for a reader to
/// answer. Drawing a card for it would put a question on screen that omp is
/// taking one away.
///
/// Known cost, stated rather than hidden: the card it targets is **not** retired
/// here, so a withdrawn request leaves its card up until the reader answers it —
/// and the answer is then dropped, because the dialog it belonged to is gone.
/// Wiring it to retire the target needs the same path
/// `control_cancel_request` uses for Claude Code, and is not built.
pub const ANNOUNCEMENTS: [&str; 7] = [
    "notify",
    "setStatus",
    "setWidget",
    "setTitle",
    "set_editor_text",
    "cancel",
    "open_url",
];

/// omp's own wording for a yes/no. `confirm` carries no labels on the wire — it
/// resolves to a boolean — so these are Dray's, and they are what maps back.
const YES: &str = "Yes";
const NO: &str = "No";

/// Builds the card a dialog is drawn as, or `None` where the line is not one
/// that blocks.
///
/// The dialog's own id becomes the request id, so the map entry is already filed
/// under the id the answer has to name and nothing extra has to be remembered to
/// address the reply.
pub fn for_request(event: &OmpEvent) -> Option<(String, PendingRequest, Vec<Question>)> {
    let OmpEvent::ExtensionUiRequest {
        id,
        method,
        title,
        message,
        options,
        ..
    } = event
    else {
        return None;
    };

    if !BLOCKING.contains(&method.as_str()) {
        return None;
    }

    // Both go in the question, and neither in `header`. The card does not draw
    // headers — that slot is a chip-sized label `AskUserQuestion`'s model writes,
    // and it says nothing the question doesn't — so a title put there is a title
    // nobody sees.
    //
    // Which of the two carries the substance is not knowable, and omp uses both
    // shapes: its approval card puts everything in the title
    // (`Allow tool: bash\nCommand: …`), while a `confirm` often asks in its
    // title and explains in its message. So both are shown, as two lines rather
    // than one sentence, since running them together reads as one long question
    // with a fragment on the end.
    let question = match (title, message) {
        (Some(title), Some(message)) => format!("{title}\n\n{message}"),
        (Some(text), None) | (None, Some(text)) => text.clone(),
        (None, None) => format!("omp is asking for a {method}"),
    };

    let choices: Vec<QuestionOption> = match method.as_str() {
        "select" => options
            .iter()
            .flatten()
            .map(|option| QuestionOption {
                // An option is a bare string on the wire, and a non-string is
                // rendered rather than dropped: losing one silently would offer
                // a list omp will not recognise an answer from — and for the
                // approval card, whose two labels are the whole interface,
                // losing one would leave nothing to press.
                label: match option {
                    Value::String(text) => text.clone(),
                    other => other.to_string(),
                },
                description: None,
                preview: None,
            })
            .collect(),
        "confirm" => [YES, NO]
            .into_iter()
            .map(|label| QuestionOption {
                label: label.to_string(),
                description: None,
                preview: None,
            })
            .collect(),
        // `input` and `editor` both take an answer that is not on a list. The
        // difference is only how much of one: `editor` opens a text area with
        // `prefill` in it, and neither the area nor the prefill has anywhere to
        // go on this card yet — so it draws as a plain box, which takes the
        // answer even where it flatters the question.
        _ => Vec::new(),
    };

    let pending = PendingRequest {
        // No tool call to hang this off: a dialog may be raised from a tool
        // gate, from a command, or from nothing at all, and the wire carries no
        // correlation to one. The dialog's own id stands in, so the retiring
        // `PermissionDecided` still names something real.
        tool_use_id: id.clone(),
        tool_name: method.clone(),
        input: Value::Null,
        options: HashMap::new(),
        reply: Reply::PiDialog(method.clone()),
    };

    let questions = vec![Question {
        question,
        header: None,
        multi_select: false,
        // A box beside a `select` would let the reader send omp a sentence
        // where it expects one of its own options — which on the approval card
        // means a reply omp cannot match to either button.
        free_text: choices.is_empty(),
        options: choices,
    }];

    Some((id.clone(), pending, questions))
}

/// The line that answers one, in the shape its own method reads.
///
/// A dialog is answered in its own shape rather than through one envelope, so
/// this is where the four diverge: `confirm` reads `confirmed`, the other three
/// read `value`. A reply in the wrong shape is dropped in silence and the turn
/// stays blocked, which is why the method is remembered rather than guessed at
/// from what came back.
///
/// No answer is `cancelled`, which every dialog understands and resolves to the
/// default it was constructed with. That is the truthful answer to a skip: the
/// alternative is sending an empty string, which `confirm` would read as `false`
/// and `select` would hand omp as a choice nobody made.
pub fn response(method: &str, id: &str, answers: &HashMap<String, String>) -> Value {
    let Some(answer) = answers.values().next() else {
        return json!({"type": "extension_ui_response", "id": id, "cancelled": true});
    };

    match method {
        "confirm" => json!({
            "type": "extension_ui_response",
            "id": id,
            "confirmed": answer == YES,
        }),
        _ => json!({"type": "extension_ui_response", "id": id, "value": answer}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, title: Option<&str>, options: Option<Vec<&str>>) -> OmpEvent {
        OmpEvent::ExtensionUiRequest {
            id: "d-1".to_string(),
            method: method.to_string(),
            title: title.map(str::to_string),
            message: None,
            options: options.map(|o| o.into_iter().map(|s| json!(s)).collect()),
            option_details: None,
        }
    }

    fn answers(text: &str, question: &str) -> HashMap<String, String> {
        HashMap::from([(question.to_string(), text.to_string())])
    }

    /// The one that matters most, because it is omp's own gate rather than an
    /// extension's: the approval card is a `select` carrying two labels, and
    /// both have to reach the reader as presses.
    #[test]
    fn omps_own_approval_card_is_a_select_with_both_labels() {
        let event = request(
            "select",
            Some("Allow tool: bash\nCommand: echo hi"),
            Some(vec!["Approve", "Deny"]),
        );

        let (id, pending, questions) = for_request(&event).expect("an approval blocks");
        assert_eq!(id, "d-1");
        assert_eq!(pending.reply.dialog_method(), Some("select"));
        assert_eq!(
            questions[0]
                .options
                .iter()
                .map(|o| o.label.as_str())
                .collect::<Vec<_>>(),
            ["Approve", "Deny"]
        );
        assert!(
            questions[0].question.contains("Allow tool: bash"),
            "the card has to say what it is allowing: {}",
            questions[0].question
        );
        // No free-text box beside a fixed choice.
        assert!(!questions[0].free_text);
    }

    /// A `select` draws exactly what omp listed and nothing beside it.
    #[test]
    fn a_select_offers_exactly_what_omp_listed() {
        let event = request("select", Some("Pick one"), Some(vec!["a", "b", "c"]));

        let (_, _, questions) = for_request(&event).expect("a select blocks");
        assert_eq!(questions[0].options.len(), 3);
    }

    /// The answer is the label, which is what omp's `select` resolves to — and
    /// on the approval card, what it matches its own buttons by.
    #[test]
    fn a_select_answers_with_the_label_that_was_picked() {
        let sent = response("select", "d-1", &answers("Approve", "Allow tool: bash?"));

        assert_eq!(
            sent,
            json!({"type": "extension_ui_response", "id": "d-1", "value": "Approve"})
        );
    }

    /// `confirm` resolves to a boolean, so its two buttons map back to one.
    #[test]
    fn a_confirm_answers_with_a_boolean_and_not_a_label() {
        let event = request("confirm", Some("Confirm?"), None);
        let (_, _, questions) = for_request(&event).expect("a confirm blocks");
        assert_eq!(questions[0].options.len(), 2);

        assert_eq!(
            response("confirm", "d-1", &answers(YES, "Confirm?")),
            json!({"type": "extension_ui_response", "id": "d-1", "confirmed": true})
        );
        assert_eq!(
            response("confirm", "d-1", &answers(NO, "Confirm?")),
            json!({"type": "extension_ui_response", "id": "d-1", "confirmed": false})
        );
    }

    /// An unanswered dialog is `cancelled`, which every method understands —
    /// rather than an empty string, which `select` would hand omp as a choice
    /// nobody made.
    #[test]
    fn skipping_sends_a_cancel_rather_than_an_empty_answer() {
        let sent = response("select", "d-1", &HashMap::new());

        assert_eq!(
            sent,
            json!({"type": "extension_ui_response", "id": "d-1", "cancelled": true})
        );
    }

    /// `input` and `editor` take an answer that is not on a list, so they draw
    /// a box and no choices.
    #[test]
    fn a_free_text_dialog_draws_a_box_and_no_choices() {
        for method in ["input", "editor"] {
            let event = request(method, Some("Branch name"), None);
            let (_, _, questions) = for_request(&event).expect("both block");

            assert!(questions[0].options.is_empty(), "{method}");
            assert!(questions[0].free_text, "{method}");
        }
    }

    /// The two lists have to partition the methods omp sends. A method in both
    /// is a card nobody answers, and one in neither is filed as a coverage gap
    /// every time it is used.
    #[test]
    fn the_two_lists_do_not_overlap() {
        for method in BLOCKING {
            assert!(
                !ANNOUNCEMENTS.contains(&method),
                "{method} is in both lists"
            );
        }

        for method in [
            "select",
            "confirm",
            "input",
            "editor",
            "notify",
            "setStatus",
            "setWidget",
            "setTitle",
            "set_editor_text",
            "cancel",
            "open_url",
        ] {
            assert!(
                BLOCKING.contains(&method) || ANNOUNCEMENTS.contains(&method),
                "{method} reaches the wire and neither list claims it"
            );
        }
    }

    /// `cancel` names another dialog rather than asking a question, so it must
    /// not draw a card — that would put a question on screen while omp is taking
    /// one away.
    #[test]
    fn a_cancel_is_an_announcement_and_draws_nothing() {
        let event = OmpEvent::ExtensionUiRequest {
            id: "d-2".to_string(),
            method: "cancel".to_string(),
            title: None,
            message: None,
            options: None,
            option_details: None,
        };

        assert!(for_request(&event).is_none());
    }

    /// A method that is not a dialog at all draws nothing.
    #[test]
    fn something_that_is_not_an_extension_request_draws_nothing() {
        assert!(for_request(&OmpEvent::AgentStart).is_none());
    }

    /// An option that is not a string is rendered rather than dropped: losing
    /// one silently offers a list omp will not recognise an answer from.
    #[test]
    fn a_non_string_option_is_rendered_rather_than_lost() {
        let event = OmpEvent::ExtensionUiRequest {
            id: "d-1".to_string(),
            method: "select".to_string(),
            title: Some("Pick".to_string()),
            message: None,
            options: Some(vec![json!("ok"), json!({"label": "structured"})]),
            option_details: None,
        };

        let (_, _, questions) = for_request(&event).expect("a select blocks");
        assert_eq!(questions[0].options.len(), 2);
        assert!(questions[0].options[1].label.contains("structured"));
    }
}
