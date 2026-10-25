//! Step lists for long work: ticked as done, closed when the run ends.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepState {
    Pending,
    Running,
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Step {
    pub text: String,
    pub state: StepState,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Plan {
    pub steps: Vec<Step>,
}

fn state_of(s: &str) -> StepState {
    match s.trim().to_lowercase().as_str() {
        "completed" | "complete" | "done" | "finished" => StepState::Done,
        "in_progress" | "in progress" | "running" | "active" | "doing" => StepState::Running,
        _ => StepState::Pending,
    }
}

impl Plan {
    /// Reads `[{content,status}]`, `[{text,done}]`, or either wrapped in `{todos|steps: [...]}`; bad input gives an empty plan.
    pub fn from_todos(json: &Value) -> Plan {
        let list = match json {
            Value::Array(a) => a,
            Value::Object(o) => match o.get("todos").or_else(|| o.get("steps")).and_then(Value::as_array) {
                Some(a) => a,
                None => return Plan::default(),
            },
            _ => return Plan::default(),
        };
        let steps = list
            .iter()
            .filter_map(|it| {
                let text = it
                    .get("content")
                    .or_else(|| it.get("text"))
                    .and_then(Value::as_str)?
                    .trim()
                    .to_string();
                if text.is_empty() {
                    return None;
                }
                let state = if let Some(s) = it.get("status").and_then(Value::as_str) {
                    state_of(s)
                } else if it.get("done").and_then(Value::as_bool) == Some(true) {
                    StepState::Done
                } else {
                    StepState::Pending
                };
                Some(Step { text, state })
            })
            .collect();
        Plan { steps }
    }

    /// Same as `from_todos` for a raw string; unparsable text gives an empty plan.
    pub fn from_json_str(s: &str) -> Plan {
        serde_json::from_str(s).map(|v| Plan::from_todos(&v)).unwrap_or_default()
    }

    /// Marks step `i` running and any earlier running step done; out-of-range is ignored.
    pub fn advance(&mut self, i: usize) {
        if i >= self.steps.len() {
            return;
        }
        for s in &mut self.steps {
            if s.state == StepState::Running {
                s.state = StepState::Done;
            }
        }
        self.steps[i].state = StepState::Running;
    }

    /// Marks step `i` done; out-of-range is ignored.
    pub fn complete(&mut self, i: usize) {
        if let Some(s) = self.steps.get_mut(i) {
            s.state = StepState::Done;
        }
    }

    /// Closes every running step at run end: done if `as_done`, else back to pending.
    pub fn close_all(&mut self, as_done: bool) {
        for s in &mut self.steps {
            if s.state == StepState::Running {
                s.state = if as_done { StepState::Done } else { StepState::Pending };
            }
        }
    }

    /// `(done, total)` for a progress badge.
    pub fn progress(&self) -> (usize, usize) {
        (self.steps.iter().filter(|s| s.state == StepState::Done).count(), self.steps.len())
    }

    /// A checklist: `[x]` done, `[~]` running, `[ ]` pending.
    pub fn render_markdown(&self) -> String {
        self.steps
            .iter()
            .map(|s| {
                let m = match s.state {
                    StepState::Done => "x",
                    StepState::Running => "~",
                    StepState::Pending => " ",
                };
                format!("- [{m}] {}", s.text)
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_content_status() {
        let p = Plan::from_todos(&json!([
            {"content":"a","status":"completed"},
            {"content":"b","status":"in_progress"},
            {"content":"c","status":"pending"}
        ]));
        assert_eq!(p.steps.len(), 3);
        assert_eq!(p.steps[0].state, StepState::Done);
        assert_eq!(p.steps[1].state, StepState::Running);
        assert_eq!(p.steps[2].state, StepState::Pending);
    }

    #[test]
    fn reads_text_done() {
        let p = Plan::from_todos(&json!([{"text":"a","done":true},{"text":"b","done":false},{"text":"c"}]));
        assert_eq!(p.progress(), (1, 3));
    }

    #[test]
    fn reads_wrapped() {
        let p = Plan::from_todos(&json!({"todos":[{"content":"a","status":"done"}]}));
        assert_eq!(p.steps.len(), 1);
    }

    #[test]
    fn malformed_is_empty() {
        for v in [json!(null), json!(5), json!("x"), json!({"a":1}), json!([1, null, {"content": 3}, {"content": "  "}])] {
            assert!(Plan::from_todos(&v).steps.is_empty());
        }
        assert!(Plan::from_json_str("not json").steps.is_empty());
    }

    #[test]
    fn advance_closes_previous() {
        let mut p = Plan::from_todos(&json!([{"text":"a"},{"text":"b"},{"text":"c"}]));
        p.advance(0);
        p.advance(1);
        assert_eq!(p.steps[0].state, StepState::Done);
        assert_eq!(p.steps[1].state, StepState::Running);
        p.advance(99);
        assert_eq!(p.steps[1].state, StepState::Running);
    }

    #[test]
    fn complete_and_bounds() {
        let mut p = Plan::from_todos(&json!([{"text":"a"}]));
        p.complete(0);
        p.complete(5);
        assert_eq!(p.progress(), (1, 1));
    }

    #[test]
    fn close_all_both_ways() {
        let mk = || {
            let mut p = Plan::from_todos(&json!([{"text":"a"},{"text":"b"}]));
            p.advance(1);
            p
        };
        let mut a = mk();
        a.close_all(true);
        assert_eq!(a.steps[1].state, StepState::Done);
        let mut b = mk();
        b.close_all(false);
        assert_eq!(b.steps[1].state, StepState::Pending);
        assert_eq!(b.steps[0].state, StepState::Pending);
    }

    #[test]
    fn markdown() {
        let mut p = Plan::from_todos(&json!([{"text":"a","done":true},{"text":"b"},{"text":"c"}]));
        p.advance(1);
        assert_eq!(p.render_markdown(), "- [x] a\n- [~] b\n- [ ] c");
        assert_eq!(Plan::default().render_markdown(), "");
    }

    #[test]
    fn unknown_status_is_pending() {
        let p = Plan::from_todos(&json!([{"content":"a","status":"weird"}]));
        assert_eq!(p.steps[0].state, StepState::Pending);
    }
}
