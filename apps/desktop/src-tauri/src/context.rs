//! What the app knows about a session's context window, in the app's own words.
//!
//! **[`harness::mcode::context`](crate::harness::mcode::context) is the reader;
//! this is the shape.** The two are split because they answer to different
//! owners: a wire format belongs to the agent that wrote it and moves whenever it
//! does, while what the composer's panel draws — a window, a list of labelled
//! token counts — is this app's vocabulary. A second harness parses its own
//! format into these same rows; nothing above the parser knows which one spoke.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One line of a reading's breakdown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ContextComponent {
    /// The agent's own words — `System prompt`, `Tools`, `Skills`, `Messages`,
    /// `Memory`, `Other`. Carried verbatim rather than mapped onto an enum of
    /// ours: the list is the agent's, and a category added after this build
    /// should draw as itself rather than as nothing.
    pub label: String,
    pub tokens: u64,
}

/// One reading of a session's context: what the agent counted, and how large the
/// window it counted against was.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshot {
    /// The agent's own word for whether this is the running session or its last
    /// completed run.
    pub live: bool,
    /// The model the snapshot was taken on, as the agent spells it.
    pub model: String,
    /// What the runtime counts in the window, and how large the window is.
    /// `None` on a line that did not parse, which is the only pair that can be
    /// missing without the block being unusable.
    pub used: Option<u64>,
    pub max: Option<u64>,
    /// When compaction last ran, in the agent's words.
    pub compaction: Option<String>,
    /// The breakdown, in the order the agent wrote it.
    pub components: Vec<ContextComponent>,
}

/// A snapshot **with when it was taken**, which is what makes it storable.
///
/// The pair is the whole reason this type exists: a snapshot on its own is a
/// reading of a moment, and a reading outlives the moment — the app keeps the
/// newest one per session (see `SessionIndexItem::context_reading`) so a session
/// reopened with no child still shows the agent's own rows instead of the
/// composer's estimate. `Context: live` in the snapshot is the agent's word
/// about its own runtime and says nothing about whether *this* copy is still
/// current; the stamp is what does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "events.ts")]
#[serde(rename_all = "camelCase")]
pub struct ContextReading {
    /// When the agent answered, in the app's own stamp format — the same one
    /// `SessionIndexItem::created` carries, so the frontend formats the two the
    /// same way.
    pub ts: String,
    pub snapshot: ContextSnapshot,
}
