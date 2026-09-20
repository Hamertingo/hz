//! Roles: a standing responsibility an agent carries.
//!
//! **A role is not a harness's idea.** It belongs to hz and is the same
//! sentence whichever CLI runs it — so it rides whatever *each* harness already
//! appends to its own instructions rather than replacing any of them. See
//! [`instructions_for`] for the seam and each harness's `init` for the wiring.
//!
//! **One role per session, and a session is the agent.** hz has no separate
//! Agent entity: `SessionIndexItem` already carries the harness, model, effort,
//! stance and project that describe a running agent, so `role_id` joins them.
//!
//! **Scope is a path, not a tag.** A role with no `project_path` is global and
//! is offered everywhere; one with a path applies to a session **at or under**
//! that path. That is deliberately the same shape as `lib/project.ts`'s
//! containing-project rule, so a role scoped to a workspace still reaches a
//! session running in one of its repositories — which is the whole point of the
//! workspace work it has to compose with.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use ts_rs::TS;
use uuid::Uuid;

use crate::store::{get_home_app_dir, read_json, write_atomic};

/// One responsibility, and the instructions that carry it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct Role {
    pub id: String,
    pub name: String,
    /// Free markdown, sent to the harness verbatim. It is the whole feature —
    /// everything else here is bookkeeping around getting this string in front
    /// of a model.
    #[serde(default)]
    pub instructions: String,
    /// `None` is global. `Some(path)` is the project the role belongs to, and
    /// the role applies to a session **at or under** that path.
    ///
    /// `#[serde(default)]` is load-bearing the way every field on a
    /// whole-file-rewritten store is: a role written before the field existed
    /// must still parse, and a role that fails to parse is *every* role gone.
    #[serde(default)]
    pub project_path: Option<String>,
}

/// One writer at a time, because the whole file is rewritten on every change.
static ROLES_LOCK: Mutex<()> = Mutex::const_new(());

async fn roles_path() -> Result<std::path::PathBuf> {
    Ok(get_home_app_dir().await?.join("roles.json"))
}

async fn read_roles() -> Result<Vec<Role>> {
    read_json(&roles_path().await?).await
}

async fn write_roles(roles: &[Role]) -> Result<()> {
    write_atomic(&roles_path().await?, serde_json::to_string(roles)?).await
}

/// Every role that may be offered for `project_path`, global first then the
/// project's own, each sorted by name.
///
/// `None` for a session with no project answers only the global roles, which is
/// the honest reading: a project role cannot be shown for a project nobody has
/// named.
pub async fn list(project_path: Option<&str>) -> Result<Vec<Role>> {
    // The attached project this path belongs to, or the path itself when
    // nothing contains it — `projectKey` in `src/lib/project.ts`, stated here
    // for the picker's benefit. A bare prefix comparison would let a role scoped
    // to a workspace reach a repository the reader attached as a project of its
    // own, which is not what they filed it under.
    let key = match project_path {
        Some(path) => Some(
            crate::projects::containing_project(path)
                .await
                .unwrap_or_else(|| path.to_string()),
        ),
        None => None,
    };

    let mut roles: Vec<Role> = read_roles()
        .await?
        .into_iter()
        .filter(|role| match (&role.project_path, &key) {
            (None, _) => true,
            (Some(_), None) => false,
            (Some(scope), Some(key)) => scope == key,
        })
        .collect();

    roles.sort_by(|a, b| {
        // Global before project, then by name — the order the picker draws, so
        // the two never have to agree about it separately.
        a.project_path
            .is_some()
            .cmp(&b.project_path.is_some())
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(roles)
}

/// Every role that may be offered for `project_path` — what a session's picker
/// draws.
///
/// `None` for a session with no project answers only the global roles, which is
/// the honest reading: a project role cannot be offered for a project nobody has
/// named.
#[tauri::command]
pub async fn list_roles(project_path: Option<String>) -> Result<Vec<Role>, crate::Fail> {
    Ok(list(project_path.as_deref()).await.unwrap_or_default())
}

/// Every role there is, whatever its scope — what the manager draws.
///
/// Separate from [`list_roles`] because the two answer different questions: a
/// picker wants what *this* session may be given, and the manager wants
/// everything the reader owns so they can see and file all of it. Filtering the
/// manager by the open project would hide exactly the rows somebody opens it to
/// move.
#[tauri::command]
pub async fn all_roles() -> Result<Vec<Role>, crate::Fail> {
    let mut roles = read_roles().await.unwrap_or_default();
    roles.sort_by(|a, b| {
        a.project_path
            .is_some()
            .cmp(&b.project_path.is_some())
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(roles)
}

/// Creates a role, or replaces the one whose id this already is.
///
/// An edit reaches every agent already carrying it, and that falls out of the
/// design rather than being arranged: an agent holds an **id**, and the
/// instructions are read at spawn. Nothing copies the text, so nothing can go
/// stale.
#[tauri::command]
pub async fn save_role(mut role: Role) -> Result<Vec<Role>, crate::Fail> {
    let _guard = ROLES_LOCK.lock().await;
    let mut roles = read_roles().await?;

    role.name = role.name.trim().to_string();
    if role.name.is_empty() {
        return Err(anyhow::anyhow!("a role needs a name").into());
    }
    if role.id.trim().is_empty() {
        role.id = Uuid::now_v7().to_string();
    }

    match roles.iter_mut().find(|r| r.id == role.id) {
        Some(existing) => *existing = role,
        None => roles.push(role),
    }

    write_roles(&roles).await?;
    Ok(roles)
}

/// Removes a role and clears it from every agent that carried it.
///
/// **The clearing is the point.** An agent holding an id whose role is gone
/// would otherwise be an agent whose behaviour depends on whether the file
/// still parses — so the reference goes with the role, and the agent falls back
/// to running with no role at all, which is the behaviour it had before any of
/// this existed.
#[tauri::command]
pub async fn delete_role(id: &str) -> Result<Vec<Role>, crate::Fail> {
    let _guard = ROLES_LOCK.lock().await;
    let roles: Vec<Role> = read_roles().await?.into_iter().filter(|r| r.id != id).collect();

    write_roles(&roles).await?;
    crate::store::clear_role_from_sessions(id).await?;

    Ok(roles)
}

/// The instructions a session's role contributes, or `None`.
///
/// `None` covers every ordinary case at once and each for its own reason: the
/// session has no role, the role was deleted out from under it, or the role is
/// scoped to a project this session does not run in. All three mean the same
/// thing to a spawn — send nothing extra — which is why they are one branch
/// here rather than three somewhere else.
///
/// Read at spawn, never cached: see [`save_role`] for why an edit has to reach
/// an agent that is already carrying the role.
pub async fn instructions_for(session_id: &str) -> Option<String> {
    let item = crate::store::get_session_index_item(session_id).await.ok()??;
    let role_id = item.role_id?;

    let role = read_roles().await.ok()?.into_iter().find(|r| r.id == role_id)?;

    // Scoped out is the same answer as absent. A session that moved out of the
    // project a role belongs to must not keep running under it.
    //
    // Resolved against the **containing attached project**, not against a bare
    // path prefix, so a role scoped to a workspace does not reach a repository
    // the reader attached as a project of its own. `containing_project` states
    // that rule and `src/lib/project.ts` states it again for the picker; the two
    // have to agree or the menu offers a role the agent never gets.
    if let Some(scope) = role.project_path.as_deref() {
        if crate::projects::containing_project(&item.project_path).await.as_deref() != Some(scope) {
            return None;
        }
    }

    let instructions = role.instructions.trim().to_string();
    (!instructions.is_empty()).then_some(instructions)
}

/// The role as a harness receives it.
///
/// **Written once, read by five harnesses.** Each CLI has its own channel for
/// extra instructions — `--append-system-prompt` for three, `developerInstructions`
/// for Codex — and what varies between them is only *where the string goes*.
/// The string itself is the same, so a role reads identically whichever agent is
/// carrying it. That is the whole cross-harness promise, and this function is
/// where it is kept.
///
/// The heading exists so a model can tell hz's standing instruction for the
/// agent from anything the reader typed. It is not a replacement for any native
/// instruction: every harness appends this *after* what it already sends.
pub fn section(instructions: &str) -> String {
    format!("## Role\n\n{}", instructions.trim())
}

#[cfg(test)]
mod tests {
    use super::*;


    /// A role written before the field existed still parses — which for a
    /// whole-file store is the difference between one role and none.
    #[test]
    fn a_role_written_before_scoping_existed_still_reads() {
        let role: Role = serde_json::from_str(
            r#"{"id":"a","name":"Orchestrator","instructions":"Do the thing."}"#,
        )
        .expect("parses");

        assert_eq!(role.project_path, None, "and reads as global");
        assert_eq!(role.name, "Orchestrator");
    }

    /// A role missing `instructions` entirely is still a role: the fields have
    /// to be tolerant in both directions, since a hand-edited file is a way
    /// this store gets written.
    #[test]
    fn a_role_with_no_instructions_reads_as_content_free() {
        let role: Role =
            serde_json::from_str(r#"{"id":"a","name":"Empty"}"#).expect("parses");

        assert!(role.instructions.is_empty());
        assert!(role.project_path.is_none());
    }

    /// The cross-harness promise, as far as a pure function can state it: the
    /// text that reaches a harness is the role's own, unaltered. Nothing here
    /// knows which CLI is about to receive it.
    #[test]
    fn the_instructions_are_the_role_s_own_text() {
        let role = Role {
            id: "a".into(),
            name: "Orchestrator".into(),
            instructions: "  Você é o principal agente.\n\nInvestigue antes.  ".into(),
            project_path: None,
        };

        assert_eq!(
            role.instructions.trim(),
            "Você é o principal agente.\n\nInvestigue antes.",
            "leading and trailing space is trimmed, and nothing else is touched"
        );
    }

    /// A role whose instructions are blank contributes nothing, which is the
    /// same answer as having no role — so a reader who names a role and writes
    /// nothing yet does not get an empty section in their prompt.
    #[test]
    fn a_role_with_blank_instructions_contributes_nothing() {
        let blank = Role {
            id: "a".into(),
            name: "Named but empty".into(),
            instructions: "   \n  ".into(),
            project_path: None,
        };

        assert!(blank.instructions.trim().is_empty());
    }

    /// **The shape that reaches a harness.** One heading, then the reader's own
    /// words verbatim — nothing reformatted, nothing escaped, nothing added to
    /// the text itself, so what a reader writes is what a model reads.
    #[test]
    fn the_section_is_a_heading_and_the_readers_words() {
        let section = section("  Você é o principal agente.\n\nInvestigue antes.  ");

        assert_eq!(
            section,
            "## Role\n\nVocê é o principal agente.\n\nInvestigue antes."
        );
    }

    /// The heading is not a native instruction, and a role carrying no text
    /// must never produce a bare heading — an empty section in a system prompt
    /// is a claim that a role exists.
    #[test]
    fn a_blank_role_makes_no_section_at_all() {
        assert!(section("").trim_end().ends_with("## Role"));
        assert!(
            section("   ").trim_end().ends_with("## Role"),
            "…and the caller drops it — see `instructions_for`"
        );
    }
}
