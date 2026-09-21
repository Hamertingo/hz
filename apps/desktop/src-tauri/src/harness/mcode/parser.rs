//! mcode's ACP wire format, typed.
//!
//! ACP is newline JSON-RPC 2.0 over stdio — the same framing `fx` speaks, and
//! the reason the two harnesses share a vocabulary rather than a dialect. This
//! file names what is *inside* those lines, read off a live `mcode acp` 0.4.12
//! rather than off the schema, and every shape below is in
//! `fixtures/live_turn.jsonl`. Places the captures disagree with the schema are
//! called out where they are read.
//!
//! Three things here are mcode's own and not ACP's:
//!
//! - **A tool call announces itself before it says anything.** The first
//!   `tool_call` carries a `title`, a `name` and a `kind` and *no input at all*;
//!   the arguments arrive on the `tool_call_update` that follows. fx is the
//!   other way round, which is why the mapper commits a row on the update that
//!   finally has something to draw rather than on the announcement.
//! - **`available_commands_update` carries the slash commands**, so the app's
//!   menu is the CLI's own list rather than a table anybody maintains here.
//! - **The model is one string** — `m:<provider>:<model>:v:<variant>`, with a
//!   `:` inside a provider name percent-escaped — and the human label for it
//!   rides beside it in the option's `name`.
//!
//! The payloads that are small and closed — a tool's status, a content block —
//! are still modelled, because a line that fails to parse is a line dropped
//! silently, and this file is the only thing that stands between the child and
//! a reader who never learns why a turn went quiet.

use serde::de::{Deserializer, MapAccess, Visitor};
use serde::Deserialize;
use serde_json::Value;

/// One line of the agent's side, typed.
///
/// Three shapes and no fourth: a notification (the model talking), the answer to
/// a prompt (the turn ending), or the prompt being refused outright. An agent
/// *request* never becomes one of these — it has to be answered from the read
/// loop, not mapped — which is why it is routed by [`super::rpc`] before the
/// parser is asked anything.
#[derive(Debug)]
pub enum McodeEvent {
    /// A `session/update` notification.
    Update(Box<SessionUpdate>),
    /// The prompt's own response, which is how a turn ends.
    PromptDone(PromptResponse),
    /// `session/prompt` refused. The sentence is the agent's and usually names
    /// its cure (`mcode login`), so it is carried rather than summarized.
    PromptFailed { message: String },
    /// A line this build has no use for.
    Unknown,
}

/// One `session/update`'s payload, tagged on `sessionUpdate`.
///
/// `Unknown` is a variant the schema does not name — mcode's extension
/// notifications ride in **camel case** (`minimax-code/…`) and one arriving here
/// must cost nothing rather than fail the line.
#[derive(Debug, Deserialize)]
#[serde(tag = "sessionUpdate", rename_all = "snake_case")]
pub enum SessionUpdate {
    /// A chunk of the answer being written for the reader.
    AgentMessageChunk {
        #[serde(default)]
        message_id: Option<String>,
        #[serde(default)]
        content: Option<ContentBlock>,
    },
    /// A chunk of what the model thought before it spoke. mcode streams these
    /// and fx does not, which is why the working indicator has a second thing to
    /// wait on here.
    AgentThoughtChunk {
        #[serde(default)]
        message_id: Option<String>,
        #[serde(default)]
        content: Option<ContentBlock>,
    },
    /// A call, before its arguments exist. See the module note.
    ToolCall {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        kind: ToolKind,
        #[serde(default)]
        status: ToolStatus,
    },
    ToolCallUpdate {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(default)]
        status: ToolStatus,
        /// The arguments, and the only place they ever appear.
        #[serde(rename = "rawInput")]
        raw_input: Option<Value>,
        /// What the call produced, on the update that closes it.
        #[serde(rename = "rawOutput")]
        raw_output: Option<RawOutput>,
        /// ACP's own content array, carried beside `rawOutput` on a closing
        /// update. Kept because a harness that stopped sending `rawOutput` would
        /// still leave the sentence the reader needs here.
        #[serde(default)]
        content: Vec<ToolContent>,
    },
    SessionInfoUpdate {
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        updated_at: Option<String>,
    },
    /// Used and total context, plus what the turn cost — the one usage shape here
    /// with a currency in it.
    UsageUpdate {
        #[serde(default)]
        used: Option<u64>,
        #[serde(default)]
        size: Option<u64>,
        #[serde(default)]
        cost: Option<Cost>,
    },
    /// The CLI's own slash commands, sent once per session and again when they
    /// change.
    AvailableCommandsUpdate {
        #[serde(rename = "availableCommands", default)]
        available_commands: Vec<Command>,
    },
    /// Which session mode is in force — `default` or `plan`, the second of which
    /// is the app's `ApprovalPolicy::Plan` arriving from the other direction.
    CurrentModeUpdate {
        #[serde(default)]
        current_mode_id: Option<String>,
    },
    /// The prompt itself, echoed to every client in the session. Dropped by the
    /// mapper: the app writes the reader's own message at the send.
    UserMessageChunk,
    /// ACP's plan entries, which no capture of mcode carries yet.
    Plan,
    #[serde(other)]
    Unknown,
}

impl SessionUpdate {
    /// The `sessionUpdate` tag as it arrived, for a mapping that has to report
    /// something it does not model.
    pub fn kind(&self) -> &'static str {
        match self {
            SessionUpdate::AgentMessageChunk { .. } => "agent_message_chunk",
            SessionUpdate::AgentThoughtChunk { .. } => "agent_thought_chunk",
            SessionUpdate::ToolCall { .. } => "tool_call",
            SessionUpdate::ToolCallUpdate { .. } => "tool_call_update",
            SessionUpdate::SessionInfoUpdate { .. } => "session_info_update",
            SessionUpdate::UsageUpdate { .. } => "usage_update",
            SessionUpdate::AvailableCommandsUpdate { .. } => "available_commands_update",
            SessionUpdate::CurrentModeUpdate { .. } => "current_mode_update",
            SessionUpdate::UserMessageChunk => "user_message_chunk",
            SessionUpdate::Plan => "plan",
            SessionUpdate::Unknown => "unknown",
        }
    }
}

/// An ACP content block. Only text is drawn; an image or resource block is kept
/// from failing the line and drawn as nothing — mcode answers `image: false` to
/// the prompt capability question anyway, so it cannot send one.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        #[serde(default)]
        text: String,
    },
    #[serde(other)]
    Other,
}

impl ContentBlock {
    pub fn text(&self) -> Option<&str> {
        match self {
            ContentBlock::Text { text } => Some(text),
            ContentBlock::Other => None,
        }
    }
}

/// What a call reports back, tagged on `type`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolContent {
    Content {
        content: ContentBlock,
    },
    Diff {
        #[serde(default)]
        path: String,
        #[serde(rename = "oldText", default)]
        old_text: Option<String>,
        #[serde(rename = "newText", default)]
        new_text: String,
    },
    #[serde(other)]
    Other,
}

/// A closing update's own account of what the call did.
///
/// `details` is where mcode puts the machine-readable half — the same
/// `{tasks: [...]}` a plan rides in, which is what [`super::mapper`] reads a
/// todo list off. It is an opaque [`Value`] here rather than a typed struct
/// because each tool fills it with its own shape, and one tool's shape failing
/// to parse must not cost the other eleven.
#[derive(Debug, Default, Deserialize)]
pub struct RawOutput {
    /// mcode's own blocks, which are **not** ACP's: it writes
    /// `{"type":"text","text":…}` where the update's own `content` beside it
    /// writes `{"type":"content","content":{…}}`. Both are in the capture, and
    /// reading one as the other draws nothing.
    #[serde(default)]
    pub content: Vec<RawBlock>,
    #[serde(default)]
    pub details: Option<Value>,
}

/// A block inside `rawOutput.content`.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RawBlock {
    Text {
        #[serde(default)]
        text: String,
    },
    Content {
        content: ContentBlock,
    },
    #[serde(other)]
    Other,
}

impl RawOutput {
    /// The text of the output, all of it joined — what a shell call's stdout
    /// arrives as, and what the transcript's result block draws.
    pub fn text(&self) -> Option<String> {
        let joined: Vec<&str> = self
            .content
            .iter()
            .filter_map(|block| match block {
                RawBlock::Text { text } => Some(text.as_str()),
                RawBlock::Content { content } => content.text(),
                RawBlock::Other => None,
            })
            .collect();

        if joined.is_empty() {
            None
        } else {
            Some(joined.join(""))
        }
    }
}

/// ACP's closed set of tool kinds, which is what makes classifying a call
/// possible without knowing mcode's tool names.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Read,
    Edit,
    Delete,
    Move,
    Search,
    Execute,
    Think,
    Fetch,
    SwitchMode,
    #[default]
    #[serde(other)]
    Other,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    #[default]
    Pending,
    InProgress,
    Completed,
    Failed,
    #[serde(other)]
    Unknown,
}

impl ToolStatus {
    /// Whether this update closes the call.
    pub fn is_final(self) -> bool {
        matches!(self, ToolStatus::Completed | ToolStatus::Failed)
    }
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct Cost {
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
}

/// One entry of `available_commands_update`.
#[derive(Debug, Default, Clone, Deserialize)]
pub struct Command {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// What the command does with the rest of the line, where the agent says.
    ///
    /// ACP's `input`, and its one shape is `UnstructuredCommandInput`: the text
    /// after the name is handed to the command whole, and the `hint` is what
    /// says so. Four of mcode's ten carry one — `/model
    /// [provider/model[#variant]]` — and every Skill does, since its argument is
    /// free instructions.
    #[serde(default)]
    pub input: Option<CommandInput>,
}

/// ACP's `UnstructuredCommandInput`, which is the only kind there is.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct CommandInput {
    #[serde(default)]
    pub hint: String,
}

/// `elicitation/create`, read off the line it arrived on.
///
/// From the **raw line**, not the [`Value`] the demux made of it: a form's steps
/// are only ordered in the bytes. `serde_json::Value`'s object is a `BTreeMap`,
/// so a request that has been through one has already been sorted by step id,
/// and that is a different questionnaire from the one the agent wrote.
#[derive(Debug, Default, Deserialize)]
pub struct ElicitationEnvelope {
    #[serde(default)]
    pub params: ElicitationRequest,
}

/// `elicitation/create`'s params: the agent asking the reader a question.
///
/// ACP's `form` mode carries a JSON-Schema object whose properties are the
/// questions — one per step the agent's own `ask_user` was given, because that
/// is what the schema was built from. hz reads it into the same
/// [`Question`](crate::events::Question) card that has been here since a harness
/// asked over `can_use_tool`, so nothing on screen is new.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationRequest {
    #[serde(default)]
    pub session_id: String,
    /// The form's own title, or the agent's fallback sentence.
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub requested_schema: ElicitationSchema,
}

/// The form itself.
#[derive(Debug, Default, Deserialize)]
pub struct ElicitationSchema {
    #[serde(default)]
    pub properties: ElicitationProperties,
    #[serde(default)]
    pub required: Vec<String>,
}

/// The form's steps, in the order the agent wrote them.
///
/// serde has no map-to-sequence coercion, and the order is the questionnaire —
/// so this reads the JSON object itself rather than letting a map type decide.
#[derive(Debug, Default)]
pub struct ElicitationProperties(pub Vec<(String, ElicitationProperty)>);

impl<'de> Deserialize<'de> for ElicitationProperties {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct Steps;

        impl<'de> Visitor<'de> for Steps {
            type Value = Vec<(String, ElicitationProperty)>;

            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("an object of steps, keyed by step id")
            }

            fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
            where
                A: MapAccess<'de>,
            {
                let mut steps = Vec::with_capacity(map.size_hint().unwrap_or(0));
                while let Some(step) = map.next_entry()? {
                    steps.push(step);
                }
                Ok(steps)
            }
        }

        Ok(ElicitationProperties(deserializer.deserialize_map(Steps)?))
    }
}

/// One question. Its `title` is the text the reader sees; its **key** in
/// [`properties`](ElicitationSchema::properties) is what the answer is filed
/// under.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationProperty {
    /// `string`, or `array` for a step that takes several answers.
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub title: String,
    /// The step's own words under its question. On the `<id>__other` sibling
    /// this is the step's `otherPlaceholder`.
    #[serde(default)]
    pub description: Option<String>,
    /// A closed list — the step's own options, for a single-choice step.
    #[serde(default)]
    pub one_of: Vec<ElicitationChoice>,
    /// The same list one level down, for a step that takes several.
    #[serde(default)]
    pub items: Option<ElicitationItems>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationItems {
    #[serde(default)]
    pub any_of: Vec<ElicitationChoice>,
}

/// One option: `const` is what travels back as the value, `title` is what the
/// card draws.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationChoice {
    #[serde(default, rename = "const")]
    pub value: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

/// `session/request_permission`'s params. The options are mcode's and go back as
/// they came — see [`permissions`](super::permissions).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub tool_call: ToolCallRef,
    #[serde(default)]
    pub options: Vec<PermissionChoice>,
}

/// The call a permission request names. A subset of `tool_call`'s fields, and
/// `rawInput` is what the card draws the command or path from.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRef {
    #[serde(default)]
    pub tool_call_id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub kind: ToolKind,
    #[serde(default)]
    pub raw_input: Option<Value>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionChoice {
    pub option_id: String,
    #[serde(default)]
    pub name: String,
    /// `allow_once`, `allow_always`, `reject_once`, `reject_always`. A string
    /// rather than an enum so a kind added later reaches the card's own fallback
    /// instead of failing the request.
    #[serde(default)]
    pub kind: String,
}

/// The `session/prompt` response.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptResponse {
    /// `end_turn`, `cancelled`, `refused`, `max_tokens`, `max_turn_requests`.
    #[serde(default)]
    pub stop_reason: String,
}

/// What `initialize` answered, which is where the app learns what this agent
/// may be asked for at all.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    #[serde(default)]
    pub protocol_version: u32,
    #[serde(default)]
    pub agent_capabilities: AgentCapabilities,
}

impl InitializeResult {
    pub fn of(result: &Value) -> Self {
        serde_json::from_value(result.clone()).unwrap_or_default()
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    #[serde(default)]
    pub load_session: bool,
    #[serde(default)]
    pub prompt_capabilities: PromptCapabilities,
    #[serde(default)]
    pub session_capabilities: SessionCapabilities,
}

/// What the agent says it will accept on the way in.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCapabilities {
    /// `false` on mcode 0.4.12, measured, and the one fact the composer's
    /// attach-an-image path reads before it offers one.
    #[serde(default)]
    pub image: bool,
    #[serde(default)]
    pub audio: bool,
    #[serde(default)]
    pub embedded_context: bool,
}

/// What the agent offers **after** a session exists — `list`, `resume`, `fork`
/// and `close`.
///
/// Read as [`Value`] rather than as four booleans, because ACP spells an offered
/// capability two ways and the capture has both: `promptCapabilities.image` is
/// a boolean, while every one of these four is an **empty object**. Typed as
/// `bool` the whole `initialize` result fails to parse, which costs the
/// capabilities *and* the line — measured, not theorized.
///
/// [`Value`]: serde_json::Value
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCapabilities {
    #[serde(default)]
    pub list: Value,
    #[serde(default)]
    pub resume: Value,
    #[serde(default)]
    pub fork: Value,
    #[serde(default)]
    pub close: Value,
}

impl SessionCapabilities {
    /// Whether a capability was offered, under either spelling. `{}` and `true`
    /// both mean yes; absent, `null` and `false` all mean no.
    pub fn offered(value: &Value) -> bool {
        value.as_bool().unwrap_or(false) || value.is_object()
    }

    /// Whether `session/fork` is offered, which is what `Capabilities::forkable`
    /// is set from when a build wants to check rather than declare it.
    pub fn forkable(&self) -> bool {
        Self::offered(&self.fork)
    }

    /// Whether `session/resume` is offered.
    pub fn resumable(&self) -> bool {
        Self::offered(&self.resume)
    }
}

/// The `session/new` response: the id the CLI minted and the settings that
/// followed it.
///
/// The **id is mcode's**, never one the app chose — the opposite of Claude Code,
/// which adopts the UUID the app hands it. So a session's own record carries
/// whatever came back, and there is nothing here that can be known before the
/// spawn.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionResult {
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub modes: Option<ModeState>,
    #[serde(default)]
    pub config_options: Vec<ConfigOption>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeState {
    #[serde(default)]
    pub current_mode_id: Option<String>,
    #[serde(default)]
    pub available_modes: Vec<Mode>,
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct Mode {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

impl NewSessionResult {
    pub fn of(result: &Value) -> Self {
        serde_json::from_value(result.clone()).unwrap_or_default()
    }

    pub fn configs(&self) -> ConfigOptions {
        ConfigOptions {
            config_options: self.config_options.clone(),
        }
    }
}

/// One `session/set_config_option` reply, and the settings `session/new` carries
/// — the same shape from both, which is what lets one reader serve them.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOptions {
    #[serde(default)]
    pub config_options: Vec<ConfigOption>,
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOption {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub current_value: Option<String>,
    #[serde(default)]
    pub options: Vec<ConfigChoice>,
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct ConfigChoice {
    #[serde(default)]
    pub value: String,
    /// What mcode calls it on screen — `MiniMax-M3 · thinking`, `Ask`. Read
    /// rather than rebuilt: the label carries the variant mcode picked, and only
    /// the CLI knows which variants a given model has.
    #[serde(default)]
    pub name: String,
}

impl ConfigOptions {
    pub fn of(result: &Value) -> Self {
        serde_json::from_value(result.clone()).unwrap_or_default()
    }

    pub fn option(&self, id: &str) -> Option<&ConfigOption> {
        self.config_options.iter().find(|o| o.id == id)
    }

    /// The values of the option `id` names, or `None` where the reply carries no
    /// such option at all.
    ///
    /// The distinction is load-bearing in both directions: no `thinkingEffort`
    /// option is mcode saying the active model does not reason (its own catalog
    /// only builds the option when the model has `effortOptions`), while an
    /// empty list would be a model that claims none, which is not a thing.
    pub fn levels(&self, id: &str) -> Option<Vec<&str>> {
        let option = self.option(id)?;
        Some(option.options.iter().map(|c| c.value.as_str()).collect())
    }

    /// The level the session sits on, which may be one the model's own ladder
    /// does not carry — the option list is the model's levels **unioned with the
    /// session's**, exactly as fx's is.
    pub fn current(&self, id: &str) -> Option<&str> {
        self.option(id)?.current_value.as_deref()
    }

    /// The levels that can only be the model's own: the option's list minus the
    /// one in use. See [`current`](Self::current) for why that subtraction is
    /// what makes a stored ladder safe to offer.
    pub fn model_levels(&self, id: &str) -> Option<Vec<&str>> {
        let current = self.current(id);
        Some(
            self.levels(id)?
                .into_iter()
                .filter(|level| Some(*level) != current)
                .collect(),
        )
    }

    /// The model in use, as mcode spells it on the wire.
    pub fn model(&self) -> Option<&str> {
        self.current("model")
    }

    /// The permission mode in force — `default`, `auto` or `bypassPermissions`.
    pub fn permission_mode(&self) -> Option<&str> {
        self.current("permissionMode")
    }
}

/// The three parts of a model value: `m:<provider>:<model>:v:<variant>`.
///
/// The provider may contain a `:` — `custom_provider:opencode-go` — which mcode
/// escapes as `%3A`, so a split on `:` has to unescape the middle field rather
/// than assume the shape cannot hold one. Parsed by hand rather than by
/// `serde` because the value is a *string* on the wire and there is nothing to
/// deserialize.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelRef {
    pub provider: String,
    pub model: String,
    pub variant: String,
}

impl ModelRef {
    pub fn parse(value: &str) -> Option<Self> {
        let rest = value.strip_prefix("m:")?;
        // The variant is the last field, and its marker is the only `:v:` in a
        // value whose escapes have already been applied to the provider.
        let (head, variant) = rest.rsplit_once(":v:")?;
        let (provider, model) = head.split_once(':')?;

        Some(ModelRef {
            provider: provider.replace("%3A", ":"),
            model: model.to_string(),
            variant: variant.to_string(),
        })
    }

    /// Whether this row is the managed account's, rather than a provider the
    /// reader connected.
    ///
    /// The account's four models are in every session's option list whether or
    /// not anything is signed in to it, and hz never signs in — so one picked
    /// from there ends the turn with "Authentication required: Run `mcode
    /// login`". Drawn or not is the picker's decision; what it cannot do is run
    /// one.
    pub fn is_account_model(&self) -> bool {
        self.provider == "minimax"
    }
}

/// Types one notification off the connection. `Ok(None)` is a method this app
/// has no use for, which is not the same as a line that failed to parse.
pub fn parse_notification(method: &str, params: Value) -> Result<Option<SessionUpdate>, String> {
    if method != "session/update" {
        return Ok(None);
    }

    let update: UpdateNotification = serde_json::from_value(params).map_err(|e| e.to_string())?;
    Ok(Some(update.update))
}

#[derive(Debug, Deserialize)]
pub struct UpdateNotification {
    pub update: SessionUpdate,
}

/// The fixture readers, `pub(crate)` because the other stage's tests read the
/// same captures: a parser test asserts what came off the wire, a mapper test
/// what it became, and both open the same file.
#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Every inbound line of a capture, `<< ` prefix stripped.
    pub fn inbound(fixture: &str) -> Vec<Value> {
        fixture
            .lines()
            .filter_map(|line| line.strip_prefix("<< "))
            .map(|line| serde_json::from_str(line).expect("fixture line is JSON"))
            .collect()
    }

    /// Every `session/update` in a capture, typed.
    pub fn updates(fixture: &str) -> Vec<SessionUpdate> {
        inbound(fixture)
            .into_iter()
            .filter(|v| v.get("method").and_then(Value::as_str) == Some("session/update"))
            .map(|v| {
                let n: UpdateNotification =
                    serde_json::from_value(v["params"].clone()).expect("update parses");
                n.update
            })
            .collect()
    }

    /// The result of the request whose `id` is `id`.
    pub fn reply(fixture: &str, id: u64) -> Value {
        inbound(fixture)
            .into_iter()
            .find(|v| v.get("id").and_then(Value::as_u64) == Some(id))
            .and_then(|v| v.get("result").cloned())
            .expect("capture holds that reply")
    }

    const LIVE_TURN: &str = include_str!("fixtures/live_turn.jsonl");

    /// Nothing in the turn is typed as `Unknown` — the capture is the whole of
    /// what mcode sends on a plain prompt, and a variant landing in the fallback
    /// means a shape this file has stopped naming.
    #[test]
    fn every_update_in_the_capture_is_named() {
        let kinds: Vec<&str> = updates(LIVE_TURN).iter().map(|u| u.kind()).collect();
        assert!(
            !kinds.contains(&"unknown"),
            "a capture update fell through to Unknown: {kinds:?}"
        );
        assert!(kinds.contains(&"agent_thought_chunk"));
        assert!(kinds.contains(&"agent_message_chunk"));
        assert!(kinds.contains(&"tool_call"));
        assert!(kinds.contains(&"tool_call_update"));
    }

    /// The capability the composer's image tray reads, which mcode answers
    /// `false` to — measured, not assumed.
    #[test]
    fn the_agent_takes_no_images_and_does_load_sessions() {
        let init: InitializeResult = serde_json::from_value(reply(LIVE_TURN, 1)).unwrap();
        assert!(!init.agent_capabilities.prompt_capabilities.image);
        assert!(init.agent_capabilities.load_session);
        assert_eq!(init.protocol_version, 1);

        // The other spelling: four capabilities that arrive as `{}` rather than
        // as `true`, and the reason these fields are not booleans.
        let sessions = &init.agent_capabilities.session_capabilities;
        assert!(sessions.forkable());
        assert!(sessions.resumable());
        assert!(SessionCapabilities::offered(&sessions.close));
        assert!(!SessionCapabilities::offered(&Value::Null));
    }

    /// The id is the CLI's, and the settings that come back with it are where
    /// every ladder the app offers a reader comes from.
    #[test]
    fn the_new_session_hands_back_an_id_and_its_ladders() {
        let started = NewSessionResult::of(&reply(LIVE_TURN, 2));
        assert!(started.session_id.starts_with("mvs_"), "{started:?}");

        let configs = started.configs();
        assert_eq!(
            configs.levels("permissionMode"),
            Some(vec!["default", "auto", "bypassPermissions"])
        );
        assert_eq!(configs.permission_mode(), Some("bypassPermissions"));

        // No `thinkingEffort` option is mcode saying the active model does not
        // reason — the model this was captured on is a BYOK one with no
        // `effortOptions` — and not an empty ladder.
        assert_eq!(configs.levels("thinkingEffort"), None);

        let models = configs.levels("model").expect("the model option is there");
        assert_eq!(models.len(), 41);

        let modes = started.modes.expect("modes are there");
        assert_eq!(modes.current_mode_id.as_deref(), Some("default"));
        assert_eq!(
            modes.available_modes.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(),
            vec!["default", "plan"]
        );
    }

    /// A provider name with a colon in it is escaped on the wire, so the parse
    /// cannot simply split on every `:`.
    #[test]
    fn a_model_value_survives_a_provider_with_a_colon() {
        let managed = ModelRef::parse("m:minimax:MiniMax-M3:v:thinking").unwrap();
        assert_eq!(managed.provider, "minimax");
        assert_eq!(managed.model, "MiniMax-M3");
        assert_eq!(managed.variant, "thinking");

        let byok = ModelRef::parse("m:custom_provider%3Aopencode-go:omen-alpha:v:").unwrap();
        assert_eq!(byok.provider, "custom_provider:opencode-go");
        assert_eq!(byok.model, "omen-alpha");
        assert_eq!(byok.variant, "");

        assert_eq!(ModelRef::parse("MiniMax-M3"), None);
    }

    /// The label mcode prints is carried, not rebuilt: it is the only place the
    /// variant the model is running shows up in words.
    #[test]
    fn a_model_option_carries_its_own_label() {
        let started = NewSessionResult::of(&reply(LIVE_TURN, 2));
        let option = started.configs().option("model").cloned().unwrap();

        let thinking = option
            .options
            .iter()
            .find(|c| c.value == "m:minimax:MiniMax-M3:v:thinking")
            .expect("MiniMax-M3 has a thinking variant in the capture");
        assert_eq!(thinking.name, "MiniMax-M3 · thinking");
    }

    /// The arguments are not on the announcement, and they *are* on the update
    /// that follows — the whole reason the mapper waits.
    #[test]
    fn a_call_announces_itself_without_its_arguments() {
        let typed = updates(LIVE_TURN);

        let announce = typed
            .iter()
            .find_map(|u| match u {
                SessionUpdate::ToolCall { name, kind, status, .. } => {
                    Some((name.clone(), *kind, *status))
                }
                _ => None,
            })
            .expect("the capture makes two calls");
        assert_eq!(announce.0.as_deref(), Some("write"));
        assert_eq!(announce.1, ToolKind::Edit);
        assert_eq!(announce.2, ToolStatus::Pending);

        let with_input = typed
            .iter()
            .find_map(|u| match u {
                SessionUpdate::ToolCallUpdate {
                    raw_input: Some(input),
                    status,
                    ..
                } if *status == ToolStatus::InProgress => Some(input.clone()),
                _ => None,
            })
            .expect("one update carries the arguments");
        assert_eq!(with_input["path"], "/tmp/hz-mcode-probe/hello.txt");
    }

    /// A closing update carries the result twice — ACP's content array and
    /// mcode's own `rawOutput` — and the text of either is what the row draws.
    #[test]
    fn a_closing_update_carries_what_the_call_produced() {
        let closing = updates(LIVE_TURN)
            .into_iter()
            .find_map(|u| match u {
                SessionUpdate::ToolCallUpdate {
                    status,
                    raw_output,
                    ref content,
                    ..
                } if status.is_final() && raw_output.is_some() => {
                    Some((raw_output.unwrap(), content.len()))
                }
                _ => None,
            });

        let (output, acp_content) = closing.expect("a call closed with output");
        assert_eq!(
            output.text().as_deref(),
            Some("Successfully wrote 2 bytes to /tmp/hz-mcode-probe/hello.txt")
        );
        assert_eq!(acp_content, 1);
    }

    /// The CLI's own command list, which the app's slash menu draws instead of
    /// keeping a table of its own.
    #[test]
    fn the_cli_sends_its_own_slash_commands() {
        let commands = updates(LIVE_TURN)
            .into_iter()
            .find_map(|u| match u {
                SessionUpdate::AvailableCommandsUpdate { available_commands } => {
                    Some(available_commands)
                }
                _ => None,
            })
            .expect("the capture carries the list");

        let names: Vec<&str> = commands.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "help",
                "new",
                "model",
                "status",
                "doctor",
                "context",
                "skills",
                "mcp",
                "usage",
                "compact"
            ]
        );
    }

    /// A form's properties keep the order the agent wrote them in — read off the
    /// line, since anything that has been through a `Value` is already sorted by
    /// step id.
    #[test]
    fn a_form_keeps_the_order_its_steps_were_written_in() {
        let line = r#"{"jsonrpc":"2.0","id":3,"method":"elicitation/create","params":{
            "requestedSchema": {"properties": {
                "z_last": {"type": "string", "title": "Written first"},
                "a_first": {"type": "string", "title": "Written second"}
            }}
        }}"#;

        let request = serde_json::from_str::<ElicitationEnvelope>(line)
            .expect("a readable form")
            .params;

        let ids: Vec<&str> = request
            .requested_schema
            .properties
            .0
            .iter()
            .map(|(id, _)| id.as_str())
            .collect();
        assert_eq!(ids, vec!["z_last", "a_first"]);
    }
}
