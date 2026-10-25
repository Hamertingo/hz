/// The mark on the one prompt an agent is sent when it is made, so it can greet
/// before anyone has said anything.
///
/// The model reads the whole thing; the transcript draws nothing for it. A mark in
/// the text rather than a flag on the event, because the event is how every turn
/// is opened and a second kind of user message would be a second thing every
/// reader of the log has to know about.
export const INTRO_MARK = "<hz-intro/>";

/// What a new agent is asked to do first. Its briefing — name, role, instructions
/// and memory — is put in front of this by the backend, so this only has to say
/// what to do with it.
export const INTRO_PROMPT = `${INTRO_MARK}Say hello. In one or two short sentences, say who you are and what you can do for me, in the language your instructions imply. Use no tools, and then wait for me.`;

export function isIntro(text: string): boolean {
  return text.startsWith(INTRO_MARK);
}

/// The mark on the hidden prompt that asks an agent to tidy its memory. Kept in
/// step with `TIDY_MARK` in `agent_profile.rs`.
export const TIDY_MARK = "<hz-tidy/>";

/// Prompts hz sends on the reader's behalf that the transcript draws nothing for:
/// the greeting and the memory tidy. The agent's reply to either is still shown.
export function isHiddenPrompt(text: string): boolean {
  return text.startsWith(INTRO_MARK) || text.startsWith(TIDY_MARK);
}
