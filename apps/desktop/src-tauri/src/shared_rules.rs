//! The rules both languages state for themselves, read out of one table —
//! `harness/mcode/fixtures/shared_rules.json`.
//!
//! Four rules exist twice in this app because neither side can call the other:
//! [`crate::store::session_branch`] and `sessionBranch` in `src/lib/pr.ts`,
//! [`crate::harness::FastMode`] and `FAST_MODE_BY_HARNESS` in
//! `src/lib/fastMode.ts`, `permission_value_for`/`acp_mode_for` in
//! `harness/mcode/mcode.rs` and `honoursMode` in `src/lib/permission.ts`, and
//! [`crate::issues::parse_identifier`]/`tag_text` and `parseIdentifier`/
//! `issueTag` in `src/lib/issue.ts`. Each is pinned by a test on its own side,
//! and two hand-written sets of cases is exactly how the copies come to differ
//! — quietly, in the direction of a tag that links nothing or a switch that
//! does nothing.
//!
//! So the cases live in the fixture and both suites read it: this crate through
//! [`rules`], the frontend through the same file by path. A row that disagrees
//! with an implementation is then a real disagreement rather than a stale copy,
//! which is the whole point — report it, do not round the row to fit.
//!
//! Test-only. Nothing the app runs reads this, which is why the module is
//! `#[cfg(test)]` at its declaration in `lib.rs`.

use serde::Deserialize;

/// One row of the session-branch rule: what the index record holds, what git
/// says, and the branch both readers answer.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBranchRow {
    /// What the record holds — for a worktree session, the name the CLI minted,
    /// which [`SessionIndexItem::new`] wrote into the field at creation. The
    /// frontend's session object can predate that write, which is the one shape
    /// it rebuilds from the worktree name and this side has no case for.
    ///
    /// [`SessionIndexItem::new`]: crate::store::SessionIndexItem::new
    pub branch: Option<String>,
    /// Whether the tree was relocated, which is the one case `observed` loses.
    pub worktree_removed: bool,
    /// Git's reading of HEAD. Absent, or empty, where there is none to read —
    /// both spellings are rows, because both sides skip it the same way.
    #[serde(default)]
    pub observed: Option<String>,
    pub expected: Option<String>,
}

/// One row of the fast-mode rule: where a harness's fast mode can be reached
/// from, if anywhere.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FastModeRow {
    /// A harness's wire spelling, as [`crate::harness::Harness`] writes it.
    pub harness: String,
    /// [`crate::harness::FastMode`] in the frontend's own words
    /// (`FastModeSupport` in `src/lib/fastMode.ts`).
    pub support: String,
    /// Whether the reader is offered the switch at all, which is
    /// [`crate::harness::FastMode::offered`].
    pub offered: bool,
}

/// One row of the stance rule: a stance, whether mcode runs it, and what it
/// names on the wire.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StanceRow {
    /// [`crate::events::ApprovalPolicy`]'s wire spelling.
    pub stance: String,
    /// Whether mcode has it — the frontend's `HONOURED` list, and the same fact
    /// as `permission_value_for` answering `Ok`.
    pub honoured: bool,
    /// The `permissionMode` value, or `None` where the stance is refused. Read
    /// by this crate alone: the frontend never names mcode's own permission
    /// strings, it hands over `ApprovalPolicy` and this side maps it.
    pub permission_value: Option<String>,
    /// The ACP session mode, for the stance that is a mode rather than a
    /// permission.
    pub acp_mode: Option<String>,
}

/// One row of the identifier shape: the word after the `#`, and the identifier
/// both readers make of it.
#[derive(Debug, Deserialize)]
pub struct IdentifierRow {
    pub text: String,
    pub expected: Option<String>,
}

/// One row of the tag text: an identifier and a title, and the string both
/// writers make of them.
#[derive(Debug, Deserialize)]
pub struct TagRow {
    pub identifier: String,
    pub title: String,
    pub expected: String,
}

/// The whole fixture.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    pub session_branch: Vec<SessionBranchRow>,
    pub fast_mode: Vec<FastModeRow>,
    pub stance: Vec<StanceRow>,
    pub identifier: Vec<IdentifierRow>,
    pub tag: Vec<TagRow>,
}

/// The fixture, parsed. Panics on a malformed one: every caller is a test, and
/// a test that cannot read its own rows has nothing to say.
pub fn rules() -> Rules {
    serde_json::from_str(include_str!("harness/mcode/fixtures/shared_rules.json"))
        .expect("shared rules fixture parses")
}

/// A stance by its wire spelling, through `ApprovalPolicy`'s own
/// `Deserialize` — so the row's spelling is checked against the enum rather
/// than matched by a second list here. An unknown one has no variant, and a row
/// nothing can answer is a failure rather than a skip.
fn stance_named(name: &str) -> crate::events::ApprovalPolicy {
    serde_json::from_value(serde_json::Value::String(name.to_string()))
        .unwrap_or_else(|error| panic!("fixture names a stance with no variant: {name} ({error})"))
}

/// The stance rows against this side's half of the mapping.
///
/// Here rather than beside the functions it names — [`acp_mode_for`] and
/// [`permission_value_for`], both in `harness/mcode/mcode.rs` — because that
/// file has other work in flight and its test area is not this change's to
/// touch. The rows are the frontend's too: `src/lib/mcode.test.ts` reads the
/// same `honoured` column and `permission_value_for` is its `HONOURED` list
/// spelled the other way, so the two statements of one fact cannot come apart
/// without a suite saying so.
///
/// [`acp_mode_for`]: crate::harness::mcode::acp_mode_for
/// [`permission_value_for`]: crate::harness::mcode::permission_value_for
#[test]
fn the_stance_rows_are_the_ones_the_frontend_offers() {
    use crate::harness::mcode::{acp_mode_for, permission_value_for};

    for row in rules().stance {
        let policy = stance_named(&row.stance);

        assert_eq!(
            permission_value_for(policy).ok(),
            row.permission_value.as_deref(),
            "{} as a permissionMode value",
            row.stance
        );
        assert_eq!(
            permission_value_for(policy).is_ok(),
            row.honoured,
            "{} honoured, which is the frontend's own column",
            row.stance
        );
        assert_eq!(
            acp_mode_for(policy),
            row.acp_mode.as_deref(),
            "{} as an ACP session mode",
            row.stance
        );
    }
}
