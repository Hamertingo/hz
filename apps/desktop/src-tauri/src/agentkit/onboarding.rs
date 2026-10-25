//! A scripted first conversation with a new agent. It needs no engine: every line is written here.

use serde::{Deserialize, Serialize};

/// Longest name an agent can take.
pub const MAX_NAME: usize = 24;

const FOCUS_CHOICES: [&str; 4] = [
    "Inbox and calendar",
    "Research and reading",
    "Writing and content",
    "Code and projects",
];

/// Where the conversation is, and what has been learned so far.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum State {
    /// Greeting shown, waiting for the focus.
    Hello,
    /// Focus known, waiting for a name.
    FocusPicked { focus: String },
    /// Name known, waiting for the first task.
    Named { focus: String, name: String },
    /// Finished; `task` is what the reader chose to start with.
    Done { task: Option<String> },
}

/// A change the caller applies to the agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Effect {
    SetJob(String),
    SetLabel(String),
    SetName(String),
}

/// One turn of the script: what the agent says, buttons to offer, and what to apply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub agent_text: String,
    pub choices: Vec<String>,
    pub effects: Vec<Effect>,
    pub state: State,
}

/// The scripted conversation.
pub struct Onboarding;

fn clean(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn tasks_for(focus: &str) -> Vec<String> {
    let t: [&str; 3] = match focus {
        "Inbox and calendar" => [
            "Sort my unread mail into what needs me today",
            "Draft replies to my three oldest threads",
            "Plan my week around what is already booked",
        ],
        "Research and reading" => [
            "Find and summarize the best sources on a topic I name",
            "Compare three options and tell me which to pick",
            "Keep a reading list and brief me each morning",
        ],
        "Writing and content" => [
            "Turn my rough notes into a clean first draft",
            "Edit something I wrote to be shorter and clearer",
            "Come up with ten ideas for my next piece",
        ],
        "Code and projects" => [
            "Read my project and explain how it fits together",
            "Find the next bug worth fixing and propose a patch",
            "Write tests for the part of the code I trust least",
        ],
        _ => [
            "Tell me what you could take off my plate first",
            "Make a short plan for my week around this focus",
            "Find one thing in this area to improve today",
        ],
    };
    t.iter().map(|s| s.to_string()).collect()
}

fn label_for(focus: &str) -> String {
    let short: String = focus.chars().take(24).collect();
    short.trim().to_string()
}

impl Onboarding {
    /// The opening step: greeting plus the four focus choices.
    pub fn start() -> Step {
        Step {
            agent_text: "Hi, I'm new here. Before we start, what should I focus on for you? Pick one, or just tell me in your own words.".into(),
            choices: FOCUS_CHOICES.iter().map(|s| s.to_string()).collect(),
            effects: vec![],
            state: State::Hello,
        }
    }

    /// Moves the script on by one reader reply; an empty reply repeats the question.
    pub fn next(state: &State, user_input: &str) -> Step {
        let input = clean(user_input);
        match state {
            State::Hello => {
                if input.is_empty() {
                    return Self::start();
                }
                let focus = FOCUS_CHOICES
                    .iter()
                    .find(|c| c.eq_ignore_ascii_case(&input))
                    .map(|c| c.to_string())
                    .unwrap_or(input);
                Step {
                    agent_text: format!("Got it: {focus}. I'll work that way. What would you like to call me?"),
                    choices: vec![],
                    effects: vec![
                        Effect::SetJob(format!("Main focus: {focus}. Help the reader with this first, and ask before going outside it.")),
                        Effect::SetLabel(label_for(&focus)),
                    ],
                    state: State::FocusPicked { focus },
                }
            }
            State::FocusPicked { focus } => {
                let name: String = input.chars().take(MAX_NAME).collect::<String>().trim().to_string();
                if name.is_empty() {
                    return Step {
                        agent_text: "I need a name to answer to. What should I be called?".into(),
                        choices: vec![],
                        effects: vec![],
                        state: state.clone(),
                    };
                }
                Step {
                    agent_text: format!("{name} it is. Where shall we start? Pick a first task or give me your own."),
                    choices: tasks_for(focus),
                    effects: vec![Effect::SetName(name.clone())],
                    state: State::Named { focus: focus.clone(), name },
                }
            }
            State::Named { name, .. } => {
                if input.is_empty() {
                    return Step {
                        agent_text: "Tell me what to start with, or pick one of the ideas.".into(),
                        choices: vec![],
                        effects: vec![],
                        state: state.clone(),
                    };
                }
                Step {
                    agent_text: format!("Starting now: {input}. I'm {name}, and I'm here whenever you need me."),
                    choices: vec![],
                    effects: vec![],
                    state: State::Done { task: Some(input) },
                }
            }
            State::Done { .. } => Step {
                agent_text: String::new(),
                choices: vec![],
                effects: vec![],
                state: state.clone(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_offers_four_choices() {
        let s = Onboarding::start();
        assert_eq!(s.choices.len(), 4);
        assert_eq!(s.state, State::Hello);
        assert!(s.effects.is_empty());
    }

    #[test]
    fn picked_focus_sets_job_and_label() {
        let s = Onboarding::next(&State::Hello, "  code and projects ");
        assert_eq!(s.state, State::FocusPicked { focus: "Code and projects".into() });
        assert!(matches!(&s.effects[0], Effect::SetJob(j) if j.contains("Code and projects")));
        assert_eq!(s.effects[1], Effect::SetLabel("Code and projects".into()));
        assert!(s.agent_text.contains("call me"));
    }

    #[test]
    fn free_text_focus_is_kept() {
        let s = Onboarding::next(&State::Hello, "bookkeeping for my bakery");
        assert_eq!(s.state, State::FocusPicked { focus: "bookkeeping for my bakery".into() });
    }

    #[test]
    fn long_label_is_capped() {
        let s = Onboarding::next(&State::Hello, &"w".repeat(100));
        match &s.effects[1] {
            Effect::SetLabel(l) => assert_eq!(l.chars().count(), 24),
            _ => panic!(),
        }
    }

    #[test]
    fn empty_focus_repeats_the_question() {
        let s = Onboarding::next(&State::Hello, "   ");
        assert_eq!(s.state, State::Hello);
        assert_eq!(s.choices.len(), 4);
    }

    #[test]
    fn name_is_trimmed_and_offers_three_tasks() {
        let st = State::FocusPicked { focus: "Writing and content".into() };
        let s = Onboarding::next(&st, "  Nova \n");
        assert_eq!(s.effects, vec![Effect::SetName("Nova".into())]);
        assert_eq!(s.choices.len(), 3);
        assert!(matches!(s.state, State::Named { .. }));
    }

    #[test]
    fn empty_name_is_rejected() {
        let st = State::FocusPicked { focus: "x".into() };
        let s = Onboarding::next(&st, " \t ");
        assert_eq!(s.state, st);
        assert!(s.effects.is_empty());
    }

    #[test]
    fn long_name_is_capped_and_controls_dropped() {
        let st = State::FocusPicked { focus: "x".into() };
        let s = Onboarding::next(&st, &format!("A\u{7}{}", "b".repeat(60)));
        match &s.effects[0] {
            Effect::SetName(n) => {
                assert_eq!(n.chars().count(), MAX_NAME);
                assert!(!n.contains('\u{7}'));
            }
            _ => panic!(),
        }
    }

    #[test]
    fn custom_focus_gets_generic_tasks() {
        let st = State::FocusPicked { focus: "bees".into() };
        assert_eq!(Onboarding::next(&st, "Bo").choices.len(), 3);
    }

    #[test]
    fn full_run_reaches_done() {
        let s1 = Onboarding::next(&Onboarding::start().state, "Research and reading");
        let s2 = Onboarding::next(&s1.state, "Ada");
        let task = s2.choices[0].clone();
        let s3 = Onboarding::next(&s2.state, &task);
        assert_eq!(s3.state, State::Done { task: Some(task) });
        let s4 = Onboarding::next(&s3.state, "more");
        assert_eq!(s4.state, s3.state);
        assert!(s4.agent_text.is_empty());
    }

    #[test]
    fn empty_task_asks_again() {
        let st = State::Named { focus: "x".into(), name: "Ada".into() };
        assert_eq!(Onboarding::next(&st, "").state, st);
    }
}
