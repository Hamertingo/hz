//! The answer side of a question request, for every harness that asks one.
//!
//! The sibling of [`permissions`](super::permissions), and kept apart from it
//! because the two answers are different shapes: a permission reply is an
//! outcome envelope carrying an option id, where a question reply is a form's
//! content keyed by field. Folding them together would mean one struct with a
//! field half its callers never set.
//!
//! **The answer is filed by the question's id**, which is the step id the agent
//! matches on. The card carries the id opaquely — it is the key here and the
//! name the answer comes back under, never something the reader reads.
//!
//! ([`Session`](crate::session::Session))
//!
//! [`Question`]: crate::events::Question

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use super::permissions::Reply;

/// Shared between the read loop, which registers requests, and
/// [`Session`](crate::session::Session), which answers them — the same
/// arrangement, and the same blocking `Mutex`, as
/// [`PendingPermissions`](super::permissions::PendingPermissions).
pub type PendingQuestions = Arc<Mutex<HashMap<String, PendingQuestion>>>;

/// One unanswered question, held from the moment it is read until a reply goes
/// out. Dropping an entry without replying leaves the agent waiting, exactly as
/// an unanswered permission does.
#[derive(Debug, Clone)]
pub struct PendingQuestion {
    /// Question id → the schema field it is answered into.
    pub fields: HashMap<String, PendingField>,
    /// Which channel the answer travels on. Held rather than recomputed,
    /// because only the reader that took the request knows the id.
    pub reply: Reply,
}

/// Where one question's answer goes, and in what shape.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingField {
    /// The schema property's key.
    pub field: String,
    /// The step takes several answers, so the wire wants an array and hz's card
    /// gives one comma-separated string.
    pub multiple: bool,
    /// The sibling property that carries this step's typed "other" answer, when
    /// the agent allocated one. `None` means a typed answer goes into `field`
    /// itself, which is the shape a step with no options has.
    pub other: Option<String>,
}
