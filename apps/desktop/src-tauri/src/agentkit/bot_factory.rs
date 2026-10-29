//! Lets the main agent create new agents, with a per-request cap so one message cannot spawn a crowd.

use std::collections::HashMap;

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

/// New agents one request may create.
pub const MAX_PER_REQUEST: u32 = 5;
pub const MAX_NAME: usize = 24;
pub const MAX_ROLE: usize = 40;
pub const MAX_JOB: usize = 4000;

/// What the main agent asks for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewAgentSpec {
    pub name: String,
    pub role: String,
    pub job: String,
}

/// Checks lengths and control characters; the name must be 1 to 24 characters after trimming.
pub fn validate(spec: &NewAgentSpec) -> Result<()> {
    let name = spec.name.trim();
    let n = name.chars().count();
    if n == 0 || n > MAX_NAME {
        bail!("name must be 1 to {MAX_NAME} characters");
    }
    if name.chars().any(char::is_control) {
        bail!("name must not contain control characters");
    }
    if spec.role.trim().chars().count() > MAX_ROLE {
        bail!("role must be at most {MAX_ROLE} characters");
    }
    if spec.job.chars().count() > MAX_JOB {
        bail!("job must be at most {MAX_JOB} characters");
    }
    Ok(())
}

/// Counts agents created per request id.
#[derive(Debug, Default)]
pub struct Quota {
    used: HashMap<String, u32>,
}

impl Quota {
    /// Takes one slot for this request, or errors once it already made five.
    pub fn take(&mut self, request_id: &str) -> Result<()> {
        let n = self.used.entry(request_id.to_string()).or_insert(0);
        if *n >= MAX_PER_REQUEST {
            bail!("one request may create at most {MAX_PER_REQUEST} agents");
        }
        *n += 1;
        Ok(())
    }

    /// Slots left for this request.
    pub fn remaining(&self, request_id: &str) -> u32 {
        MAX_PER_REQUEST - self.used.get(request_id).copied().unwrap_or(0).min(MAX_PER_REQUEST)
    }
}

/// Validates the spec and returns it cleaned, with a name no existing agent has.
pub fn make(spec: &NewAgentSpec, existing_names: &[String]) -> Result<NewAgentSpec> {
    validate(spec)?;
    let base = spec.name.trim();
    let taken = |s: &str| existing_names.iter().any(|e| e.trim().eq_ignore_ascii_case(s));
    let mut name = base.to_string();
    let mut i = 2u32;
    while taken(&name) {
        let suffix = format!(" {i}");
        let keep = MAX_NAME - suffix.chars().count();
        let stem: String = base.chars().take(keep).collect();
        name = format!("{}{suffix}", stem.trim_end());
        i += 1;
    }
    Ok(NewAgentSpec { name, role: spec.role.trim().to_string(), job: spec.job.trim().to_string() })
}

/// The first line a new agent posts, so the room knows who joined.
pub fn intro_message(spec: &NewAgentSpec) -> String {
    let role = spec.role.trim();
    if role.is_empty() {
        format!("Hi, I'm {}. I just joined.", spec.name.trim())
    } else {
        format!("Hi, I'm {}, the new {}. I just joined.", spec.name.trim(), role)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(name: &str) -> NewAgentSpec {
        NewAgentSpec { name: name.into(), role: "Researcher".into(), job: "Find things".into() }
    }

    #[test]
    fn valid_spec_passes() {
        assert!(validate(&spec("Nova")).is_ok());
    }

    #[test]
    fn rejects_empty_and_long_names() {
        assert!(validate(&spec("   ")).is_err());
        assert!(validate(&spec(&"a".repeat(25))).is_err());
        assert!(validate(&spec(&"a".repeat(24))).is_ok());
    }

    #[test]
    fn rejects_control_chars() {
        assert!(validate(&spec("No\nva")).is_err());
    }

    #[test]
    fn role_and_job_limits() {
        let mut s = spec("A");
        s.role = "r".repeat(41);
        assert!(validate(&s).is_err());
        s.role = "r".repeat(40);
        s.job = "j".repeat(4001);
        assert!(validate(&s).is_err());
        s.job = "j".repeat(4000);
        assert!(validate(&s).is_ok());
    }

    #[test]
    fn quota_caps_per_request_only() {
        let mut q = Quota::default();
        for _ in 0..5 {
            q.take("r1").unwrap();
        }
        assert!(q.take("r1").is_err());
        assert_eq!(q.remaining("r1"), 0);
        assert!(q.take("r2").is_ok());
        assert_eq!(q.remaining("r2"), 4);
    }

    #[test]
    fn dedups_names_case_insensitively() {
        let ex = vec!["Nova".to_string(), "nova 2".to_string()];
        assert_eq!(make(&spec("nova"), &ex).unwrap().name, "nova 3");
        assert_eq!(make(&spec("Leo"), &ex).unwrap().name, "Leo");
    }

    #[test]
    fn dedup_respects_name_cap() {
        let long = "a".repeat(24);
        let out = make(&spec(&long), std::slice::from_ref(&long)).unwrap();
        assert_eq!(out.name.chars().count(), 24);
        assert!(out.name.ends_with(" 2"));
    }

    #[test]
    fn make_trims_fields() {
        let s = NewAgentSpec { name: " Ada ".into(), role: " Dev ".into(), job: " x \n".into() };
        let m = make(&s, &[]).unwrap();
        assert_eq!((m.name.as_str(), m.role.as_str(), m.job.as_str()), ("Ada", "Dev", "x"));
    }

    #[test]
    fn make_rejects_invalid() {
        assert!(make(&spec(""), &[]).is_err());
    }

    #[test]
    fn intro_mentions_name_and_role() {
        assert!(intro_message(&spec("Nova")).contains("Nova, the new Researcher"));
        let mut s = spec("Nova");
        s.role = String::new();
        assert_eq!(intro_message(&s), "Hi, I'm Nova. I just joined.");
    }
}
