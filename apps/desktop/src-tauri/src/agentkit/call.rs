//! A voice call: its state, the splitter that turns streamed text into sentences to speak, the queue that plays them in order
//! (and drops them when you talk over it), and the summary posted when you hang up.

use std::collections::VecDeque;
use std::sync::Mutex;

use regex::Regex;

/// Where a call is in its life.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallState {
    Idle,
    Connecting,
    Live,
    Ended,
}

/// State plus the mute flag; every move returns whether it was allowed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Call {
    state: CallState,
    muted: bool,
}

impl Default for Call {
    fn default() -> Self {
        Self::new()
    }
}

impl Call {
    /// A call that has not started.
    pub fn new() -> Self {
        Self { state: CallState::Idle, muted: false }
    }

    /// Current state.
    pub fn state(&self) -> CallState {
        self.state
    }

    /// Whether the microphone is muted.
    pub fn is_muted(&self) -> bool {
        self.muted
    }

    /// Idle to Connecting.
    pub fn start(&mut self) -> bool {
        self.step(CallState::Idle, CallState::Connecting)
    }

    /// Connecting to Live.
    pub fn connected(&mut self) -> bool {
        self.step(CallState::Connecting, CallState::Live)
    }

    /// Ends the call from any state but Ended; the mute flag is cleared.
    pub fn end(&mut self) -> bool {
        if self.state == CallState::Ended {
            return false;
        }
        self.state = CallState::Ended;
        self.muted = false;
        true
    }

    /// Mutes or unmutes; only a live call has a microphone.
    pub fn set_muted(&mut self, muted: bool) -> bool {
        if self.state != CallState::Live {
            return false;
        }
        self.muted = muted;
        true
    }

    /// True when the agent should be hearing the user.
    pub fn is_listening(&self) -> bool {
        self.state == CallState::Live && !self.muted
    }

    fn step(&mut self, from: CallState, to: CallState) -> bool {
        if self.state != from {
            return false;
        }
        self.state = to;
        true
    }
}

const ABBREVIATIONS: [&str; 12] = ["mr", "mrs", "ms", "dr", "prof", "sr", "jr", "vs", "inc", "ltd", "st", "fig"];

fn is_abbreviation(token: &str) -> bool {
    let t = token.trim_start_matches(|c: char| !c.is_alphanumeric());
    if t.is_empty() {
        return false;
    }
    if ABBREVIATIONS.contains(&t.to_ascii_lowercase().as_str()) {
        return true;
    }
    t.split('.').all(|p| p.chars().count() == 1 && p.chars().all(|c| c.is_alphabetic()))
}

fn is_list_marker(before: &str, token: &str) -> bool {
    !token.is_empty() && token.chars().all(|c| c.is_ascii_digit()) && before.trim().is_empty()
}

/// Index just past the first sentence end in `s`, or None when more text is needed to decide.
fn find_boundary(s: &str) -> Option<usize> {
    let cs: Vec<(usize, char)> = s.char_indices().collect();
    let mut i = 0;
    while i < cs.len() {
        let (pos, c) = cs[i];
        if c == '\n' {
            return Some(pos + 1);
        }
        if !matches!(c, '.' | '!' | '?' | '…') {
            i += 1;
            continue;
        }
        let mut j = i;
        while j + 1 < cs.len() && matches!(cs[j + 1].1, '.' | '!' | '?' | '…') {
            j += 1;
        }
        let mut k = j;
        while k + 1 < cs.len() && matches!(cs[k + 1].1, '"' | '\'' | ')' | ']' | '*' | '_' | '”' | '’' | '`') {
            k += 1;
        }
        if k + 1 >= cs.len() {
            return None;
        }
        if !cs[k + 1].1.is_whitespace() {
            i = k + 1;
            continue;
        }
        let ellipsis = c == '…' || (c == '.' && j > i);
        if ellipsis {
            let mut m = k + 1;
            while m < cs.len() && cs[m].1.is_whitespace() {
                m += 1;
            }
            if m >= cs.len() {
                return None;
            }
            if cs[m].1.is_lowercase() {
                i = k + 1;
                continue;
            }
        } else if c == '.' {
            let start = s[..pos].rfind(char::is_whitespace).map(|p| p + 1).unwrap_or(0);
            let token = &s[start..pos];
            let line_start = s[..start].rfind('\n').map(|p| p + 1).unwrap_or(0);
            if is_abbreviation(token) || is_list_marker(&s[line_start..start], token) {
                i = k + 1;
                continue;
            }
        }
        return Some(cs[k].0 + cs[k].1.len_utf8());
    }
    None
}

/// Removes markdown so what is left can be spoken; empty when nothing speakable remains.
pub fn strip_markdown(s: &str) -> String {
    let link = Regex::new(r"!?\[([^\]]*)\]\([^)]*\)").expect("static pattern");
    let lead = Regex::new(r"^\s*(?:#{1,6}\s*|[-*+•]\s+|\d+[.)]\s+|>\s?)").expect("static pattern");
    let under = Regex::new(r"(^|[^A-Za-z0-9])_+|_+([^A-Za-z0-9]|$)").expect("static pattern");
    let mut t = link.replace_all(s, "$1").into_owned();
    t = lead.replace(&t, "").into_owned();
    t = t.replace(['*', '`', '~'], "");
    t = under.replace_all(&t, "$1$2").into_owned();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.chars().any(|c| c.is_alphanumeric()) { t } else { String::new() }
}

/// Turns streamed text deltas into whole sentences, in order. Nothing partial comes out before `flush`.
#[derive(Debug, Default)]
pub struct SentenceSplitter {
    buf: String,
}

impl SentenceSplitter {
    /// An empty splitter.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a delta and returns the sentences it completed.
    pub fn push(&mut self, delta: &str) -> Vec<String> {
        self.buf.push_str(delta);
        self.drain(false)
    }

    /// The stream ended: returns what is left as a last sentence (or nothing).
    pub fn flush(&mut self) -> Option<String> {
        self.drain(true).into_iter().next()
    }

    fn drain(&mut self, last: bool) -> Vec<String> {
        let mut out = vec![];
        loop {
            // A fence is dropped whole; one still open holds back everything after it.
            let limit = match self.buf.find("```") {
                Some(open) => match self.buf[open + 3..].find("```") {
                    Some(rel) => {
                        let close = open + 3 + rel + 3;
                        self.buf.replace_range(open..close, "\n");
                        continue;
                    }
                    None if last => {
                        self.buf.truncate(open);
                        open
                    }
                    None => open,
                },
                None => self.buf.len(),
            };
            match find_boundary(&self.buf[..limit]) {
                Some(end) => {
                    let sentence = strip_markdown(&self.buf[..end]);
                    self.buf.drain(..end);
                    if !sentence.is_empty() {
                        out.push(sentence);
                    }
                }
                None => break,
            }
        }
        if last {
            let rest = strip_markdown(&self.buf);
            self.buf.clear();
            if !rest.is_empty() {
                out.push(rest);
            }
        }
        out
    }
}

/// One sentence waiting for, or in, playback. `generation` ties it to the barge-in that may cancel it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Utterance {
    pub id: u64,
    pub text: String,
    pub generation: u64,
}

/// What `cancel_all` threw away.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cancelled {
    pub dropped: usize,
    /// The sentence that was playing; the player must stop it.
    pub stopped: Option<u64>,
}

/// Sentences play one at a time in the order they were added.
#[derive(Debug, Default)]
pub struct SpeakQueue {
    queue: VecDeque<Utterance>,
    playing: Option<Utterance>,
    next_id: u64,
    generation: u64,
}

impl SpeakQueue {
    /// An empty queue.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a sentence and returns its id.
    pub fn enqueue(&mut self, text: &str) -> u64 {
        self.next_id += 1;
        self.queue.push_back(Utterance { id: self.next_id, text: text.to_string(), generation: self.generation });
        self.next_id
    }

    /// The next sentence to play, or None when one is already playing or none are left.
    pub fn next_to_play(&mut self) -> Option<Utterance> {
        if self.playing.is_some() {
            return None;
        }
        let u = self.queue.pop_front()?;
        self.playing = Some(u.clone());
        Some(u)
    }

    /// The player finished sentence `id`.
    pub fn finished(&mut self, id: u64) {
        if self.playing.as_ref().is_some_and(|u| u.id == id) {
            self.playing = None;
        }
    }

    /// Barge-in: unplayed sentences are dropped and the playing one is reported so it can be stopped.
    pub fn cancel_all(&mut self) -> Cancelled {
        let dropped = self.queue.len();
        self.queue.clear();
        self.generation += 1;
        Cancelled { dropped, stopped: self.playing.take().map(|u| u.id) }
    }

    /// False for audio that belongs to a generation cancelled while it was being made.
    pub fn is_current(&self, u: &Utterance) -> bool {
        u.generation == self.generation
    }

    /// Sentences not yet started.
    pub fn pending(&self) -> usize {
        self.queue.len()
    }

    /// Whether something is playing now.
    pub fn is_playing(&self) -> bool {
        self.playing.is_some()
    }
}

/// Turns text into audio bytes.
pub trait Voice: Send + Sync {
    /// Speaks `text`; the bytes are whatever format the player expects.
    fn synth(&self, text: &str) -> anyhow::Result<Vec<u8>>;
}

/// Delivers what the user said, one transcript at a time.
pub trait Listener: Send + Sync {
    /// The next thing the user said, or None when nothing is waiting.
    fn next_transcript(&self) -> anyhow::Result<Option<String>>;
}

/// A voice for tests: records what it was asked and returns the text as bytes.
#[derive(Default)]
pub struct FakeVoice {
    pub spoken: Mutex<Vec<String>>,
    pub fail_on: Option<String>,
}

impl Voice for FakeVoice {
    fn synth(&self, text: &str) -> anyhow::Result<Vec<u8>> {
        if self.fail_on.as_deref() == Some(text) {
            anyhow::bail!("voice failed");
        }
        self.spoken.lock().expect("fake lock").push(text.to_string());
        Ok(text.as_bytes().to_vec())
    }
}

/// A listener for tests: hands out the lines it was given.
pub struct FakeListener {
    lines: Mutex<VecDeque<String>>,
}

impl FakeListener {
    /// A listener that will report `lines` in order.
    pub fn new(lines: &[&str]) -> Self {
        Self { lines: Mutex::new(lines.iter().map(|s| s.to_string()).collect()) }
    }
}

impl Listener for FakeListener {
    fn next_transcript(&self) -> anyhow::Result<Option<String>> {
        Ok(self.lines.lock().expect("fake lock").pop_front())
    }
}

/// Takes the next sentence off the queue and makes its audio, with the text prepared for speech first.
/// Returns None if nothing is due, or if a barge-in cancelled the sentence while it was being made.
pub fn synthesize_next(queue: &mut SpeakQueue, voice: &dyn Voice) -> anyhow::Result<Option<(Utterance, Vec<u8>)>> {
    let Some(u) = queue.next_to_play() else {
        return Ok(None);
    };
    match voice.synth(&super::speech::prepare(&u.text)) {
        Ok(audio) if queue.is_current(&u) => Ok(Some((u, audio))),
        Ok(_) => Ok(None),
        Err(e) => {
            queue.finished(u.id);
            Err(e)
        }
    }
}

/// True when the user's words are a command to stop talking, not something to answer.
pub fn is_stop_word(transcript: &str) -> bool {
    let t: String = transcript.to_lowercase().chars().filter(|c| c.is_alphabetic() || c.is_whitespace()).collect();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    matches!(t.as_str(), "stop" | "stop talking" | "wait" | "hold on" | "be quiet" | "quiet" | "okay stop" | "ok stop" | "shut up")
}

/// Who said a line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Speaker {
    User,
    Agent,
}

/// One line of the call transcript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Turn {
    pub speaker: Speaker,
    pub text: String,
}

const MAX_TRANSCRIPT_CHARS: usize = 12_000;

/// The request that asks the model to write the call's summary; long calls keep their most recent part.
pub fn summary_prompt(transcript: &[Turn]) -> String {
    let mut lines: Vec<String> = transcript
        .iter()
        .map(|t| format!("{}: {}", if t.speaker == Speaker::User { "User" } else { "Agent" }, t.text.trim()))
        .collect();
    let mut total: usize = lines.iter().map(|l| l.chars().count() + 1).sum();
    while total > MAX_TRANSCRIPT_CHARS && lines.len() > 1 {
        total -= lines.remove(0).chars().count() + 1;
    }
    format!(
        "The voice call just ended. Summarise it in a few short plain sentences: what was decided, what you will do next, and anything the user must do. \
         No greeting, no headings, no markdown.\n\nTranscript:\n{}",
        lines.join("\n")
    )
}

/// Tidies the model's summary: drops a wrapping fence, a lead-in line and markdown, and squeezes blank lines.
pub fn clean_summary(raw: &str) -> String {
    let mut t = raw.trim().to_string();
    if t.starts_with("```") {
        t = t.trim_start_matches('`').trim_start_matches(|c: char| c.is_alphabetic()).trim().to_string();
        t = t.trim_end_matches('`').trim().to_string();
    }
    let lead = Regex::new(r"(?i)^(here('s| is)|sure|certainly|summary)[^\n]*:\s*\n").expect("static pattern");
    t = lead.replace(&t, "").into_owned();
    let lines: Vec<String> = t
        .lines()
        .map(|l| {
            let m = strip_markdown(l);
            if m.is_empty() { String::new() } else { m }
        })
        .collect();
    let mut out = vec![];
    for l in lines {
        if l.is_empty() && out.last().is_none_or(|p: &String| p.is_empty()) {
            continue;
        }
        out.push(l);
    }
    out.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(chunks: &[&str]) -> Vec<String> {
        let mut s = SentenceSplitter::new();
        let mut out = vec![];
        for c in chunks {
            out.extend(s.push(c));
        }
        out.extend(s.flush());
        out
    }

    #[test]
    fn call_state_machine() {
        let mut c = Call::new();
        assert!(!c.connected());
        assert!(c.start());
        assert!(!c.start());
        assert!(!c.set_muted(true));
        assert!(c.connected());
        assert!(c.is_listening());
        assert!(c.set_muted(true));
        assert!(!c.is_listening());
        assert!(c.end());
        assert!(!c.is_muted());
        assert!(!c.end());
        assert_eq!(c.state(), CallState::Ended);
    }

    #[test]
    fn can_end_before_connecting() {
        let mut c = Call::new();
        c.start();
        assert!(c.end());
    }

    #[test]
    fn splits_in_order_and_holds_partials() {
        let mut s = SentenceSplitter::new();
        assert!(s.push("Hello the").is_empty());
        assert_eq!(s.push("re. How are"), vec!["Hello there."]);
        assert_eq!(s.push(" you? Fine"), vec!["How are you?"]);
        assert_eq!(s.flush().as_deref(), Some("Fine"));
        assert_eq!(s.flush(), None);
    }

    #[test]
    fn terminator_at_end_waits_for_next_char() {
        let mut s = SentenceSplitter::new();
        assert!(s.push("It costs 3.").is_empty());
        assert!(s.push("5 dollars. ").len() == 1);
    }

    #[test]
    fn abbreviations_and_decimals_do_not_split() {
        assert_eq!(feed(&["Use tools, e.g. a hammer. Next, call Dr. Smith. Pay 3.5 now. Done."]), vec![
            "Use tools, e.g. a hammer.",
            "Next, call Dr. Smith.",
            "Pay 3.5 now.",
            "Done.",
        ]);
    }

    #[test]
    fn ellipsis_only_splits_before_a_capital() {
        assert_eq!(feed(&["Well... maybe so. Hmm... Okay then."]), vec!["Well... maybe so.", "Hmm...", "Okay then."]);
        assert_eq!(feed(&["Wait… what. Yes"]), vec!["Wait… what.", "Yes"]);
    }

    #[test]
    fn markdown_is_stripped() {
        assert_eq!(feed(&["**Done.** Now see [docs](http://x.y) and `code`."]), vec!["Done.", "Now see docs and code."]);
        assert_eq!(feed(&["# Title\n- first item\n- second item\n"]), vec!["Title", "first item", "second item"]);
    }

    #[test]
    fn code_fences_are_dropped_even_across_deltas() {
        let out = feed(&["Look: ```py\nprint(1", ".5)\n```", " Then this. Ok"]);
        assert_eq!(out, vec!["Look:", "Then this.", "Ok"]);
    }

    #[test]
    fn unclosed_fence_is_dropped_on_flush() {
        assert_eq!(feed(&["Before. ```\nnever closes"]), vec!["Before."]);
    }

    #[test]
    fn numbered_list_markers_are_not_sentences() {
        assert_eq!(feed(&["Steps:\n1. Open it\n2. Close it\n"]), vec!["Steps:", "Open it", "Close it"]);
    }

    #[test]
    fn queue_plays_in_order_one_at_a_time() {
        let mut q = SpeakQueue::new();
        let a = q.enqueue("one");
        q.enqueue("two");
        assert_eq!(q.next_to_play().unwrap().text, "one");
        assert!(q.next_to_play().is_none());
        q.finished(a);
        assert_eq!(q.next_to_play().unwrap().text, "two");
        assert!(q.next_to_play().is_none());
    }

    #[test]
    fn barge_in_drops_queue_and_stops_playing() {
        let mut q = SpeakQueue::new();
        let a = q.enqueue("one");
        q.enqueue("two");
        q.enqueue("three");
        q.next_to_play();
        assert_eq!(q.cancel_all(), Cancelled { dropped: 2, stopped: Some(a) });
        assert!(!q.is_playing());
        assert!(q.next_to_play().is_none());
        q.enqueue("fresh");
        assert_eq!(q.next_to_play().unwrap().text, "fresh");
        assert_eq!(q.cancel_all(), Cancelled { dropped: 0, stopped: Some(4) });
    }

    #[test]
    fn synthesis_prepares_text_and_respects_cancel() {
        let voice = FakeVoice::default();
        let mut q = SpeakQueue::new();
        q.enqueue("It costs $5.");
        let (u, audio) = synthesize_next(&mut q, &voice).unwrap().unwrap();
        assert_eq!(String::from_utf8(audio).unwrap(), "It costs five dollars.");
        q.finished(u.id);
        assert!(synthesize_next(&mut q, &voice).unwrap().is_none());
    }

    #[test]
    fn synth_error_frees_the_player() {
        let voice = FakeVoice { fail_on: Some("bad.".into()), ..Default::default() };
        let mut q = SpeakQueue::new();
        q.enqueue("bad");
        assert!(synthesize_next(&mut q, &voice).is_err());
        assert!(!q.is_playing());
    }

    #[test]
    fn stale_audio_after_cancel_is_not_current() {
        let mut q = SpeakQueue::new();
        q.enqueue("one");
        let u = q.next_to_play().unwrap();
        assert!(q.is_current(&u));
        q.cancel_all();
        assert!(!q.is_current(&u));
    }

    #[test]
    fn stop_words() {
        assert!(is_stop_word("Stop!"));
        assert!(is_stop_word("  hold on. "));
        assert!(!is_stop_word("don't stop the music please"));
        assert!(!is_stop_word(""));
    }

    #[test]
    fn fake_listener_hands_out_in_order() {
        let l = FakeListener::new(&["a", "b"]);
        assert_eq!(l.next_transcript().unwrap().as_deref(), Some("a"));
        assert_eq!(l.next_transcript().unwrap().as_deref(), Some("b"));
        assert_eq!(l.next_transcript().unwrap(), None);
    }

    #[test]
    fn summary_prompt_labels_and_truncates() {
        let t = vec![
            Turn { speaker: Speaker::User, text: " hi ".into() },
            Turn { speaker: Speaker::Agent, text: "hello".into() },
        ];
        let p = summary_prompt(&t);
        assert!(p.contains("User: hi\nAgent: hello"));
        let long: Vec<Turn> = (0..400).map(|i| Turn { speaker: Speaker::User, text: format!("line {i} {}", "x".repeat(60)) }).collect();
        let p = summary_prompt(&long);
        assert!(p.contains("line 399"));
        assert!(!p.contains("line 0 "));
    }

    #[test]
    fn clean_summary_tidies() {
        assert_eq!(clean_summary("Here is the summary:\n**We agreed** to ship.\n\n\n- Send the file"), "We agreed to ship.\n\nSend the file");
        assert_eq!(clean_summary("```text\nShip it.\n```"), "Ship it.");
        assert_eq!(clean_summary("   "), "");
    }
}
