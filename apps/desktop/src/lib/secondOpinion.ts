import type { AgentEvent } from "@/types/events";

/// The newest turn's two halves, which is everything the prompt above asks for.
///
/// Walked backwards from the end: an `assistant_text` counts only until the
/// first prompt behind it, because the answer *before* the newest prompt belongs
/// to a turn that is already finished with. Taking the last one wherever it fell
/// would hand a reviewer the previous turn's summary beside this turn's request,
/// which reads as a coherent brief and is about the wrong work.
export function lastTurn(events: readonly AgentEvent[]): { request: string; report: string } {
  let request = "";
  let report = "";

  for (let i = events.length - 1; i >= 0; i--) {
    const { payload } = events[i];
    if (payload.type === "assistant_text") {
      report ||= payload.text;
      continue;
    }
    if (payload.type === "user_message") {
      request = payload.text;
      break;
    }
  }

  return { request, report };
}

/// How long each quoted section may be.
///
/// The reviewer's prompt is a prompt like any other and the reader pays for it
/// in context. Four thousand characters is roughly a page of prose, which is far
/// more than a request or a summary needs and far less than a turn that dumped a
/// file into its answer — and the second is the case this cap exists for.
const SECTION_LIMIT = 4000;

/// Trims a quoted section and says so when it had to.
///
/// Marked rather than silently cut: a reviewer reading a summary that stops
/// mid-sentence will assume the agent stopped there.
function section(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SECTION_LIMIT) return trimmed;
  return `${trimmed.slice(0, SECTION_LIMIT).trimEnd()}\n\n…(truncated)`;
}

/// What a reviewing session is opened with.
///
/// **Three things and no more: what was asked, what the first agent said it did,
/// and the instruction to check rather than redo.** The files are deliberately
/// not listed — the reviewer runs in its own checkout seeded from the work, so
/// it can diff for itself, and a list copied out of the other session is the
/// copy that is stale by the time it is read.
///
/// `report` is the agent's *own* account of what it did, which is exactly the
/// thing worth a second look: a summary that overstates, or that quietly skips
/// what it could not get working, reads the same as one that does not. So the
/// prompt says out loud that the claim is not evidence.
export function secondOpinionPrompt({
  request,
  report,
}: {
  request: string;
  report: string;
}): string {
  const asked = request.trim();
  const said = report.trim();

  return [
    "Another agent did the work in this checkout and has stopped. You are the",
    "second pair of eyes on it.",
    "",
    "## What was asked",
    "",
    asked ? section(asked) : "(not recorded)",
    "",
    "## What that agent said it did",
    "",
    said ? section(said) : "(it gave no summary — judge the diff alone)",
    "",
    "## What to do",
    "",
    "Your checkout starts from that working tree as it was when the turn ended,",
    "so `git status` and `git diff` show exactly the work under review. Read it",
    "and judge it.",
    "",
    "- **Check the claims, do not repeat them.** The summary above is that agent's",
    "  account of itself, not evidence. Where it says something is fixed or works,",
    "  find the thing that makes that true, or say it does not.",
    "- **Look for what the change breaks**, not only for what it adds. A question",
    "  the reader never asked, a case the code stopped handling, a test that was",
    "  weakened to pass.",
    "- **Say so plainly when the work is right.** A review that cannot come back",
    "  clean is one nobody can act on, and inventing a finding to look thorough is",
    "  the same failure as missing one.",
    "",
    "Report what you find. **Fix only what is unambiguously wrong** — anything",
    "that is a judgement call is a finding for the reader to decide on, and",
    "changing it takes that decision away from them.",
  ].join("\n");
}
