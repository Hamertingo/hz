//! Sign in without the agent seeing the password. The app finds the login inputs on the page and types the secrets straight in;
//! the agent is only told that the page was filled.

use std::fmt;

use serde_json::{json, Value};

/// A value that must never be printed or logged. Debug and Display show a placeholder; the bytes are overwritten on drop.
pub struct Secret(Vec<u8>);

impl Secret {
    /// Wraps a secret.
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into().into_bytes())
    }

    /// The real value. Call only where it is typed into the page.
    pub fn expose(&self) -> &str {
        std::str::from_utf8(&self.0).unwrap_or("")
    }

    /// Length in characters, safe to show.
    pub fn len(&self) -> usize {
        self.expose().chars().count()
    }

    /// True when empty.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl Clone for Secret {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([redacted])")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[redacted]")
    }
}

impl Secret {
    fn wipe(&mut self) {
        for b in self.0.iter_mut() {
            // Volatile so the overwrite is not optimised away as a dead store.
            unsafe { std::ptr::write_volatile(b, 0) };
        }
        std::sync::atomic::compiler_fence(std::sync::atomic::Ordering::SeqCst);
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.wipe();
    }
}

/// What the user entered for a site.
#[derive(Debug, Clone)]
pub struct LoginFields {
    pub username: Secret,
    pub password: Secret,
}

/// A request to sign in somewhere. Everything the user typed is a `Secret`.
#[derive(Debug, Clone)]
pub struct LoginRequest {
    pub id: String,
    pub site: String,
    pub fields: LoginFields,
}

/// One browser action. Typed text is a `Secret`, so a step prints safely.
#[derive(Debug, Clone)]
pub enum FillStep {
    Focus { selector: String },
    Type { selector: String, text: Secret },
    Click { selector: String },
}

/// Why no steps could be planned.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanError {
    NoLoginFields,
}

/// How a fill attempt ended; carries no free text, so nothing from the page or the user can leak through it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FillResult {
    Filled { submitted: bool },
    FilledFirstStep,
    NoLoginFields,
    ElementMissing,
    Rejected,
}

fn text_of(f: &Value, key: &str) -> String {
    f.get(key).and_then(|v| v.as_str()).unwrap_or("").to_ascii_lowercase()
}

fn selector_of(f: &Value) -> Option<String> {
    if let Some(s) = f.get("selector").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        return Some(s.to_string());
    }
    let safe = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':' | '.'));
    if let Some(id) = f.get("id").and_then(|v| v.as_str()).filter(|s| safe(s)) {
        return Some(format!("[id=\"{id}\"]"));
    }
    f.get("name").and_then(|v| v.as_str()).filter(|s| safe(s)).map(|n| format!("[name=\"{n}\"]"))
}

fn is_visible(f: &Value) -> bool {
    f.get("visible").and_then(|v| v.as_bool()).unwrap_or(true) && text_of(f, "type") != "hidden"
}

fn hints(f: &Value) -> String {
    ["name", "id", "label", "placeholder", "aria_label", "autocomplete"].iter().map(|k| text_of(f, k)).collect::<Vec<_>>().join(" ")
}

fn password_score(f: &Value) -> u32 {
    let mut s: u32 = 0;
    if text_of(f, "type") == "password" {
        s += 10;
    }
    let ac = text_of(f, "autocomplete");
    if ac.contains("current-password") {
        s += 6;
    } else if ac.contains("password") {
        s += 3;
    }
    if hints(f).contains("pass") {
        s += 2;
    }
    if ac.contains("new-password") {
        s = s.saturating_sub(5);
    }
    s
}

fn username_score(f: &Value) -> u32 {
    let ty = text_of(f, "type");
    if !matches!(ty.as_str(), "" | "text" | "email" | "tel") || password_score(f) > 0 {
        return 0;
    }
    let mut s = 1;
    let ac = text_of(f, "autocomplete");
    if ac.contains("username") || ac.contains("email") {
        s += 8;
    }
    if ty == "email" {
        s += 6;
    }
    let h = hints(f);
    for w in ["email", "e-mail", "user", "login", "account", "phone"] {
        if h.contains(w) {
            s += 3;
        }
    }
    if h.contains("search") || h.contains("captcha") || h.contains("code") {
        s = 0;
    }
    s
}

fn is_submit(f: &Value) -> bool {
    let tag = text_of(f, "tag");
    let ty = text_of(f, "type");
    if !(tag == "button" || ty == "submit" || ty == "button") {
        return false;
    }
    let t = format!("{} {}", text_of(f, "text"), text_of(f, "label"));
    ty == "submit" || ["sign in", "log in", "login", "continue", "next", "submit", "sign-in"].iter().any(|w| t.contains(w))
}

fn best(fields: &[Value], score: fn(&Value) -> u32) -> Option<&Value> {
    fields.iter().filter(|f| is_visible(f)).map(|f| (score(f), f)).filter(|(s, f)| *s > 0 && selector_of(f).is_some()).max_by_key(|(s, _)| *s).map(|(_, f)| f)
}

/// Finds the username and password inputs on a page description (an array of fields, or `{"fields": [...]}`) and plans the typing.
/// A page that shows only the username gets just that step plus its Next button; plan again once the password field appears.
pub fn plan_fill(page_fields_json: &Value, fields: &LoginFields) -> Result<Vec<FillStep>, PlanError> {
    let list: Vec<Value> = match page_fields_json {
        Value::Array(a) => a.clone(),
        v => v.get("fields").and_then(|f| f.as_array()).cloned().unwrap_or_default(),
    };
    let user = best(&list, username_score);
    let pass = best(&list, password_score);
    let submit = list.iter().find(|f| is_visible(f) && is_submit(f) && selector_of(f).is_some());
    if user.is_none() && pass.is_none() {
        return Err(PlanError::NoLoginFields);
    }
    let mut steps = vec![];
    if let Some(u) = user {
        let sel = selector_of(u).unwrap_or_default();
        steps.push(FillStep::Focus { selector: sel.clone() });
        steps.push(FillStep::Type { selector: sel, text: fields.username.clone() });
    }
    if let Some(p) = pass {
        let sel = selector_of(p).unwrap_or_default();
        steps.push(FillStep::Focus { selector: sel.clone() });
        steps.push(FillStep::Type { selector: sel, text: fields.password.clone() });
    }
    if let Some(s) = submit {
        steps.push(FillStep::Click { selector: selector_of(s).unwrap_or_default() });
    }
    Ok(steps)
}

/// Steps as log lines: what was done and how many characters, never the characters.
pub fn redacted(steps: &[FillStep]) -> Vec<String> {
    steps
        .iter()
        .map(|s| match s {
            FillStep::Focus { selector } => format!("focus {selector}"),
            FillStep::Type { selector, text } => format!("type {} characters into {selector}", text.len()),
            FillStep::Click { selector } => format!("click {selector}"),
        })
        .collect()
}

/// The DevTools message for a step. A Type step carries the secret: send it to the browser and nowhere else.
pub fn to_cdp(step: &FillStep) -> Value {
    let js = |sel: &str, action: &str| {
        let q = serde_json::to_string(sel).unwrap_or_default();
        json!({"method": "Runtime.evaluate", "params": {"expression": format!("document.querySelector({q}).{action}()")}})
    };
    match step {
        FillStep::Focus { selector } => js(selector, "focus"),
        FillStep::Click { selector } => js(selector, "click"),
        FillStep::Type { text, .. } => json!({"method": "Input.insertText", "params": {"text": text.expose()}}),
    }
}

/// What the agent is told. Never a value.
pub fn outcome_text(result: &FillResult) -> String {
    match result {
        FillResult::Filled { submitted: true } => "The sign-in form was filled and submitted. Check the page to see whether it worked.".into(),
        FillResult::Filled { submitted: false } => "The sign-in form was filled. Press the sign-in button yourself.".into(),
        FillResult::FilledFirstStep => "The first step of the sign-in was filled. Look at the page for the next step.".into(),
        FillResult::NoLoginFields => "No sign-in fields were found on this page.".into(),
        FillResult::ElementMissing => "A field disappeared from the page before it could be filled.".into(),
        FillResult::Rejected => "The page did not accept the sign-in. Ask the user to take over.".into(),
    }
}

/// Maps the plan to the result the agent hears: a form with no password field was only a first step.
pub fn result_for(steps: &[FillStep]) -> FillResult {
    let typed = steps.iter().filter(|s| matches!(s, FillStep::Type { .. })).count();
    let clicked = steps.iter().any(|s| matches!(s, FillStep::Click { .. }));
    match (typed, clicked) {
        (0, _) => FillResult::NoLoginFields,
        (1, true) => FillResult::FilledFirstStep,
        (_, c) => FillResult::Filled { submitted: c },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PW: &str = "s3cret-Pa$$w0rd";
    const USER: &str = "ana@example.com";

    fn fields() -> LoginFields {
        LoginFields { username: Secret::new(USER), password: Secret::new(PW) }
    }
    fn page() -> Value {
        json!([
            {"tag":"input","type":"text","name":"q","placeholder":"Search"},
            {"tag":"input","type":"email","id":"email","autocomplete":"username"},
            {"tag":"input","type":"password","name":"pw","autocomplete":"current-password"},
            {"tag":"button","type":"submit","text":"Sign in","selector":"button[type=submit]"}
        ])
    }

    #[test]
    fn secret_never_prints() {
        let s = Secret::new(PW);
        assert!(!format!("{s:?}").contains(PW));
        assert!(!format!("{s}").contains(PW));
        assert_eq!(s.expose(), PW);
        assert_eq!(s.len(), PW.len());
    }

    #[test]
    fn drop_overwrites_bytes() {
        let mut s = Secret::new("abcd");
        s.wipe();
        assert_eq!(s.0, vec![0u8; 4]);
    }

    #[test]
    fn debug_of_every_public_type_hides_secrets() {
        let f = fields();
        let req = LoginRequest { id: "1".into(), site: "a.com".into(), fields: f.clone() };
        let steps = plan_fill(&page(), &f).unwrap();
        let all = format!("{req:?} {f:?} {steps:?} {:?}", redacted(&steps));
        assert!(!all.contains(PW));
        assert!(!all.contains(USER));
        assert!(all.contains("redacted"));
    }

    #[test]
    fn plans_full_form() {
        let steps = plan_fill(&page(), &fields()).unwrap();
        assert_eq!(steps.len(), 5);
        assert!(matches!(&steps[0], FillStep::Focus { selector } if selector == "[id=\"email\"]"));
        assert!(matches!(&steps[3], FillStep::Type { selector, .. } if selector == "[name=\"pw\"]"));
        assert!(matches!(&steps[4], FillStep::Click { .. }));
        assert_eq!(result_for(&steps), FillResult::Filled { submitted: true });
    }

    #[test]
    fn search_box_is_not_the_username() {
        let p = json!([{"tag":"input","type":"text","name":"q","placeholder":"Search"},{"tag":"input","type":"password","name":"p"}]);
        let steps = plan_fill(&p, &fields()).unwrap();
        assert_eq!(steps.len(), 2);
        assert!(matches!(&steps[0], FillStep::Focus { selector } if selector == "[name=\"p\"]"));
    }

    #[test]
    fn two_step_login_fills_username_and_next() {
        let p = json!({"fields":[{"tag":"input","type":"text","name":"login"},{"tag":"button","text":"Next","selector":"#next"}]});
        let steps = plan_fill(&p, &fields()).unwrap();
        assert_eq!(steps.len(), 3);
        assert_eq!(result_for(&steps), FillResult::FilledFirstStep);
    }

    #[test]
    fn hidden_fields_are_skipped_and_new_password_demoted() {
        let p = json!([
            {"tag":"input","type":"password","name":"decoy","visible":false},
            {"tag":"input","type":"password","name":"real"},
            {"tag":"input","type":"hidden","name":"user"}
        ]);
        let steps = plan_fill(&p, &fields()).unwrap();
        assert!(matches!(&steps[0], FillStep::Focus { selector } if selector.contains("real")));
        let reg = json!([{"type":"password","name":"a","autocomplete":"new-password"},{"type":"password","name":"b","autocomplete":"current-password"}]);
        assert!(matches!(&plan_fill(&reg, &fields()).unwrap()[0], FillStep::Focus { selector } if selector.contains("\"b\"")));
    }

    #[test]
    fn no_fields_is_an_error() {
        assert_eq!(plan_fill(&json!([]), &fields()).unwrap_err(), PlanError::NoLoginFields);
        assert!(plan_fill(&json!({"nope":1}), &fields()).is_err());
        assert!(plan_fill(&json!([{"type":"text","name":"q","placeholder":"Search"}]), &fields()).is_err());
    }

    #[test]
    fn redacted_log_shows_lengths_only() {
        let lines = redacted(&plan_fill(&page(), &fields()).unwrap());
        assert!(lines.iter().any(|l| l == &format!("type {} characters into [name=\"pw\"]", PW.len())));
        assert!(lines.iter().all(|l| !l.contains(PW) && !l.contains(USER)));
    }

    #[test]
    fn cdp_messages() {
        let steps = plan_fill(&page(), &fields()).unwrap();
        let typed = to_cdp(&steps[3]);
        assert_eq!(typed["method"], "Input.insertText");
        assert_eq!(typed["params"]["text"], PW);
        let f = to_cdp(&steps[0]);
        assert!(f["params"]["expression"].as_str().unwrap().contains("focus()"));
    }

    #[test]
    fn selectors_with_quotes_cannot_break_out() {
        let step = FillStep::Click { selector: "a\"); alert(1); (\"".into() };
        let expr = to_cdp(&step)["params"]["expression"].as_str().unwrap().to_string();
        assert!(expr.contains("\\\""));
    }

    #[test]
    fn unsafe_ids_are_not_turned_into_selectors() {
        let p = json!([{"type":"password","id":"x\"] , body [a=\""}]);
        assert!(plan_fill(&p, &fields()).is_err());
    }

    #[test]
    fn outcome_texts_never_hold_values() {
        for r in [
            FillResult::Filled { submitted: true },
            FillResult::Filled { submitted: false },
            FillResult::FilledFirstStep,
            FillResult::NoLoginFields,
            FillResult::ElementMissing,
            FillResult::Rejected,
        ] {
            let t = outcome_text(&r);
            assert!(!t.contains(PW) && !t.contains(USER));
        }
        assert!(outcome_text(&FillResult::Filled { submitted: false }).contains("was filled"));
    }
}
