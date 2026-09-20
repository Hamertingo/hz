//! The answer side of a permission request, for every harness that asks one.
//!
//! ACP blocks the agent's turn until a reply carrying the request's id comes
//! back, so this module exists to make sure one always does. It turns the
//! agent's own options into the buttons a reader sees, remembers which button
//! carried which decision, and builds the reply.
//!
//! **The decision never leaves Rust.** An option travels to the frontend as an
//! id and a label; the frontend answers with the id. That way the envelope sent
//! back — the one shape the agent will accept — is only ever composed from what
//! the agent itself offered, and a card cannot be answered with something no
//! protocol has a field for.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::events::PermissionOption;

/// Shared between the read loop, which registers requests, and [`Session`],
/// which answers them.
///
/// A blocking `Mutex` rather than tokio's: every critical section here is a
/// hash lookup with no await in it, and the read loop registers from inside a
/// synchronous `map`.
///
/// ([`Session`](crate::session::Session))
pub type PendingPermissions = Arc<Mutex<HashMap<String, PendingRequest>>>;

/// One unanswered request, held from the moment it is read until a reply goes
/// out. Dropping an entry without replying leaves the agent waiting.
#[derive(Debug, Clone)]
pub struct PendingRequest {
    pub tool_use_id: String,
    /// Keyed by [`PermissionOption::id`].
    pub options: HashMap<String, ResolvedOption>,
    /// Which channel the answer travels on, and so what shape it takes. Held
    /// here rather than worked out at reply time because only the reader that
    /// took the request knows — and an answer aimed at the wrong id is ignored
    /// in silence on every protocol.
    pub reply: Reply,
}

/// How a request is answered. One shape, because one protocol asks: ACP names
/// the request with an id, and the answer is `result` under it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reply {
    /// The JSON-RPC id the request arrived under.
    Rpc(i64),
}

/// One button: what the card draws, and the whole of what is sent back if it is
/// pressed.
#[derive(Debug, Clone)]
pub struct ResolvedOption {
    pub option: PermissionOption,
    /// `None` for a button that means an outage rather than a decision — there
    /// is no such button yet, and the field is the shape that keeps one from
    /// being invented as an empty object at the reply site.
    pub decision: Option<Value>,
}
