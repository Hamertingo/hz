//! mcode's `elicitation/create` onto hz's question card.
//!
//! ACP's `form` elicitation carries a JSON-Schema object, one property per step
//! the agent's `ask_user` was given; hz's card draws [`Question`]s. The two map
//! cleanly because the schema was built *from* those steps: a property's `title`
//! is the step's question, an enum's `const` is the value the step's own option
//! carries back, and a property with no enum is a step that wants text.
//!
//! One shape needs undoing. A step that takes a typed answer *beside* its
//! options gets a second property, `<step>__other`, because a form has no other
//! place to put it — the agent folds it back into the step when it reads the
//! reply. The card never sees it: [`pending_for`] folds it in the same way, so
//! the reader is asked once. Drawn, it read as a second question and the agent
//! preferred its text to the option the reader had picked.
//!
//! **The reply is the reader's own answer, filed by step id.** An option travels
//! back as the `const` the agent matches on, never as the label the reader read;
//! a typed answer goes to whichever of the step's two properties carries it.
//! Nothing here composes an answer the agent did not offer.

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::events::{Question, QuestionOption};
use crate::harness::permissions::Reply;
use crate::harness::questions::{PendingField, PendingQuestion};

use super::parser::{ElicitationChoice, ElicitationProperty, ElicitationRequest};

/// One step's answer, as the card hands it back.
///
/// Picked and typed are **two fields**, not one string: the agent reads them
/// apart, and a single key holding both would be an answer neither shape.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionAnswer {
    /// The step id the question was drawn under.
    pub id: String,
    /// The `const` of each option picked. One entry for a single-select step.
    #[serde(default)]
    pub selected: Vec<String>,
    /// What the reader typed in the step's own box, when they typed anything.
    #[serde(default)]
    pub other: Option<String>,
}

/// Builds the held request and the questions the card draws, in one pass.
pub fn pending_for(request: &ElicitationRequest, rpc_id: i64) -> (PendingQuestion, Vec<Question>) {
    let properties = &request.requested_schema.properties.0;
    let required = &request.requested_schema.required;

    let mut fields = HashMap::new();
    let mut questions = Vec::new();

    for (field, property) in properties {
        // The typed-answer sibling is folded into the question it belongs to.
        if other_parent(properties, field).is_some() {
            continue;
        }

        let other = other_field(properties, field);
        let drawn = question_of(
            field,
            property,
            other.map(|(_, p)| p),
            required.contains(field),
        );

        // A property with no title has no question to draw, and the reader
        // would have nothing to read. Keyed by id now, dropping it costs a
        // question rather than an answer that can never be matched to one.
        if drawn.question.trim().is_empty() {
            continue;
        }

        fields.insert(
            field.clone(),
            PendingField {
                field: field.clone(),
                multiple: drawn.multi_select,
                other: other.map(|(id, _)| id.to_string()),
            },
        );
        questions.push(drawn);
    }

    (
        PendingQuestion {
            fields,
            reply: Reply::Rpc(rpc_id),
        },
        questions,
    )
}

/// One schema property, as the card draws it.
fn question_of(
    field: &str,
    property: &ElicitationProperty,
    other: Option<&ElicitationProperty>,
    required: bool,
) -> Question {
    let options: Vec<QuestionOption> = choices(property)
        .iter()
        .map(|choice| QuestionOption {
            // The `const` is what the agent matches on; the title is what it
            // drew. Both survive, because an option whose label matched
            // nothing was an answer the agent could not take.
            value: choice.value.clone(),
            label: choice
                .title
                .clone()
                .unwrap_or_else(|| choice.value.clone()),
            description: choice.description.clone(),
            preview: None,
        })
        .collect();

    // A box beside options, or a step that is nothing but a box. Both take a
    // typed answer; only a closed list does not.
    let free_text = options.is_empty() || other.is_some();

    Question {
        id: field.to_string(),
        question: property.title.clone(),
        // Neither the form's own title nor a property's description is the short
        // chip `header` is for, so no chip is drawn rather than a long one.
        header: None,
        required,
        multi_select: property.kind == "array",
        options,
        free_text,
        // The agent's own wording lives on the sibling it allocated.
        other_placeholder: other.and_then(|p| p.description.clone()),
    }
}

/// The `<step>__other` sibling the agent allocated to `field`, and its id.
fn other_field<'a>(
    properties: &'a [(String, ElicitationProperty)],
    field: &str,
) -> Option<(&'a str, &'a ElicitationProperty)> {
    properties
        .iter()
        .find(|(id, _)| other_parent_of(id) == Some(field))
        .map(|(id, p)| (id.as_str(), p))
}

/// The step an other-field was allocated to — `step_1__other` names `step_1`.
/// `None` for an ordinary property, since the suffix is the whole marker.
fn other_parent_of(field: &str) -> Option<&str> {
    let (parent, suffix) = field.split_once("__other")?;
    if parent.is_empty() || !suffix.chars().all(|c| c == '_') {
        return None;
    }
    Some(parent)
}

/// Whether `field` is an other-field, which needs the id it names to be a real
/// property — a question that happens to be called `x__other` is still a
/// question.
fn other_parent<'a>(
    properties: &[(String, ElicitationProperty)],
    field: &'a str,
) -> Option<&'a str> {
    let parent = other_parent_of(field)?;
    properties
        .iter()
        .any(|(id, _)| id == parent)
        .then_some(parent)
}

/// A step's options, wherever the schema put them: `oneOf` for one answer,
/// `items.anyOf` for several.
fn choices(property: &ElicitationProperty) -> &[ElicitationChoice] {
    match property.items.as_ref() {
        Some(items) => &items.any_of,
        None => &property.one_of,
    }
}

/// The reply `elicitation/create` wants for a form the reader filled in.
///
/// Keyed by **field id**, not by question text: the agent indexes its own steps
/// by id. A question the reader left alone is simply absent, which the agent
/// reads as skipped — so an untouched form is still an answer.
pub fn accepted(pending: &PendingQuestion, answers: &[QuestionAnswer]) -> Value {
    let mut content = serde_json::Map::new();

    for answer in answers {
        // A question this form never asked is dropped rather than sent under a
        // field the agent has no step for.
        let Some(target) = pending.fields.get(&answer.id) else {
            continue;
        };

        if !answer.selected.is_empty() {
            content.insert(target.field.clone(), value_of(target, &answer.selected));
        }

        // A typed answer and a picked one are both kept: the agent reads the
        // typed text as the step's other answer and the selection as its
        // option, which is what it does when the field exists — see
        // `interactions.ts`'s `questionnaireAnswers`.
        if let Some(typed) = answer.other.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
            let key = target
                .other
                .clone()
                .unwrap_or_else(|| target.field.clone());
            content.insert(key, Value::String(typed.to_string()));
        }
    }

    json!({"action": "accept", "content": Value::Object(content)})
}

/// The reply for a form the reader took back. The only non-accept the wire has,
/// and the close of the card — the agent reads it as "not continued".
pub fn declined() -> Value {
    json!({"action": "decline"})
}

/// One step's selection, in the shape the property's `type` asked for.
fn value_of(target: &PendingField, selected: &[String]) -> Value {
    if !target.multiple {
        // The card is single-select; a second value would be a card bug, and
        // the wire wants one string either way.
        return Value::String(selected[0].clone());
    }

    Value::Array(selected.iter().cloned().map(Value::String).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The four steps `ask_user` really sends: a single choice, a choice with a
    /// typed answer beside it, a multi choice, and a box. Off the shapes
    /// `packages/tui/src/acp/interactions.ts` builds, as the bytes that carry
    /// them — a form's order lives in the text, not in a parsed object.
    fn request() -> ElicitationRequest {
        serde_json::from_str(
            r#"{
                "sessionId": "s",
                "message": "Which way?",
                "requestedSchema": {
                    "type": "object",
                    "properties": {
                        "step_1": {
                            "type": "string",
                            "title": "Which database?",
                            "oneOf": [
                                {"const": "postgres", "title": "Postgres", "description": "The boring one"},
                                {"const": "sqlite", "title": "SQLite"}
                            ]
                        },
                        "step_2": {
                            "type": "string",
                            "title": "Which runner?",
                            "oneOf": [
                                {"const": "jest", "title": "Jest"},
                                {"const": "vitest", "title": "Vitest"}
                            ]
                        },
                        "step_2__other": {
                            "type": "string",
                            "title": "Which runner? — Other",
                            "description": "Name it"
                        },
                        "step_3": {
                            "type": "array",
                            "title": "Which checks?",
                            "items": {
                                "anyOf": [
                                    {"const": "lint", "title": "Lint"},
                                    {"const": "test", "title": "Tests"}
                                ]
                            }
                        },
                        "step_4": {"type": "string", "title": "Anything else?"}
                    },
                    "required": ["step_1"]
                }
            }"#,
        )
        .expect("a readable form")
    }

    fn answer(id: &str, selected: &[&str], other: Option<&str>) -> QuestionAnswer {
        QuestionAnswer {
            id: id.to_string(),
            selected: selected.iter().map(|s| s.to_string()).collect(),
            other: other.map(str::to_string),
        }
    }

    /// The card's questions are the agent's steps, in the order the schema wrote
    /// them — and each carries what the reader needs: the drawn label, the
    /// description, whether it is required, and whether it takes typed text.
    #[test]
    fn a_form_becomes_one_question_per_step_in_schema_order() {
        let (_, questions) = pending_for(&request(), 7);

        let ids: Vec<&str> = questions.iter().map(|q| q.id.as_str()).collect();
        assert_eq!(ids, vec!["step_1", "step_2", "step_3", "step_4"]);

        let database = &questions[0];
        assert_eq!(database.question, "Which database?");
        assert!(database.required);
        assert!(!database.free_text);
        assert_eq!(database.options[0].value, "postgres");
        assert_eq!(database.options[0].label, "Postgres");
        assert_eq!(
            database.options[0].description.as_deref(),
            Some("The boring one")
        );

        // A box, and only a box.
        let other = &questions[3];
        assert!(other.free_text);
        assert!(other.options.is_empty());
        assert!(!other.required);
    }

    /// The `<step>__other` sibling folds into its question: no second card, the
    /// step takes a typed answer, and the agent's own wording survives as the
    /// box's placeholder. The step's `const` values still come off the enum.
    #[test]
    fn a_typed_answer_sibling_folds_into_its_question() {
        let (pending, questions) = pending_for(&request(), 7);

        assert_eq!(questions.len(), 4, "the sibling is not a question");

        let runner = &questions[1];
        assert_eq!(runner.question, "Which runner?");
        assert!(runner.free_text);
        assert_eq!(runner.other_placeholder.as_deref(), Some("Name it"));
        assert_eq!(
            pending.fields["step_2"].other.as_deref(),
            Some("step_2__other")
        );

        // The step that allocated none keeps its box shut.
        assert!(pending.fields["step_1"].other.is_none());
        assert!(!questions[0].free_text);
    }

    /// What travels back is the option's `const`, not the label the reader read
    /// — the label was decoration, and an answer filed under it is one the agent
    /// cannot match.
    #[test]
    fn a_pick_travels_back_as_its_value() {
        let (pending, _) = pending_for(&request(), 7);
        let answers = vec![answer("step_1", &["sqlite"], None), answer("step_3", &["lint", "test"], None)];

        assert_eq!(
            accepted(&pending, &answers),
            json!({
                "action": "accept",
                "content": {"step_1": "sqlite", "step_3": ["lint", "test"]}
            })
        );
    }

    /// A typed answer goes to the step's other field, and a pick beside it goes
    /// to the step's own — two keys, because the agent reads them apart.
    #[test]
    fn a_typed_answer_and_a_pick_land_in_two_places() {
        let (pending, _) = pending_for(&request(), 7);
        let answers = vec![answer("step_2", &["vitest"], Some("bun test"))];

        assert_eq!(
            accepted(&pending, &answers),
            json!({
                "action": "accept",
                "content": {"step_2": "vitest", "step_2__other": "bun test"}
            })
        );
    }

    /// A step with no options has no sibling to file under, so its text goes
    /// into the step itself.
    #[test]
    fn a_box_with_no_options_files_under_its_own_step() {
        let (pending, _) = pending_for(&request(), 7);
        let answers = vec![answer("step_4", &[], Some("yes, one thing"))];

        assert_eq!(
            accepted(&pending, &answers),
            json!({
                "action": "accept",
                "content": {"step_4": "yes, one thing"}
            })
        );
    }

    /// An untouched question is left out, which the agent reads as skipped — so
    /// an empty form is still an answer, and a question this form never asked is
    /// not one, since sending it would name a step the agent does not have.
    #[test]
    fn an_unanswered_question_is_omitted() {
        let (pending, _) = pending_for(&request(), 1);

        assert_eq!(
            accepted(&pending, &[]),
            json!({"action": "accept", "content": {}})
        );
        assert_eq!(
            accepted(&pending, &[answer("Nobody asked this", &["x"], None)]),
            json!({"action": "accept", "content": {}})
        );
    }

    /// Whitespace in the box is not typed text, so it does not overwrite the
    /// pick the reader made.
    #[test]
    fn a_blank_typed_answer_is_not_one() {
        let (pending, _) = pending_for(&request(), 7);
        let answers = vec![answer("step_2", &["jest"], Some("   "))];

        assert_eq!(
            accepted(&pending, &answers),
            json!({"action": "accept", "content": {"step_2": "jest"}})
        );
    }

    /// Cancelling is the wire's own non-accept, and it carries no content.
    #[test]
    fn a_cancelled_form_declines() {
        assert_eq!(declined(), json!({"action": "decline"}));
    }

    /// The card draws the steps in the order the agent wrote them — the whole
    /// reason the form is read off the line rather than off a parsed `Value`.
    #[test]
    fn the_card_draws_the_steps_in_the_order_they_were_written() {
        let request: ElicitationRequest = serde_json::from_str(
            r#"{"requestedSchema": {"properties": {
                "zzz": {"type": "string", "title": "Asked first"},
                "aaa": {"type": "string", "title": "Asked second"}
            }}}"#,
        )
        .expect("a readable form");

        let (_, questions) = pending_for(&request, 1);
        let ids: Vec<&str> = questions.iter().map(|q| q.id.as_str()).collect();
        assert_eq!(ids, vec!["zzz", "aaa"]);
    }

    /// A property with no title cannot be drawn, and a question the reader never
    /// saw is one they must not be charged for answering.
    #[test]
    fn a_question_with_no_text_is_dropped() {
        let request: ElicitationRequest = serde_json::from_value(json!({
            "requestedSchema": {"properties": {"step_1": {"type": "string"}}}
        }))
        .expect("a readable form");

        let (pending, questions) = pending_for(&request, 1);
        assert!(questions.is_empty());
        assert!(pending.fields.is_empty());
    }
}
