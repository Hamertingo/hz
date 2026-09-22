/// A pull request named in prose, and where the reader goes when they press it.
///
/// **`#7`, which is GitHub's own rule.** A message that has just opened a pull
/// request names it that way, and so does every comment on one — but nothing
/// carries the repository with it, because in GitHub's world the page you are
/// reading *is* the repository. Here the repository is the session's, which is
/// the one thing the chip has to be told.
///
/// The number alone is what is matched, not a `PR` in front of it: the words
/// before a reference are prose, and requiring them would miss `opened #7`,
/// `#7 is up`, and every sentence that names the thing on the second mention.
/// The cost is stated — `step #7` is drawn as a reference that opens nothing,
/// which is the same coin GitHub spends.
import { OPENERS } from "@/lib/issue";

/// A reference and the run of text it occupies.
export type PrRef = {
  /// The number as written, without the `#`.
  number: number;
  start: number;
  /// One past the last digit.
  end: number;
};

const SPACE = /\s/;
const DIGITS = "0123456789";

/// Whether `text[i]` ends a word rather than continuing it.
///
/// The whole reason a colour stays prose: `#7f7f7f` opens with a digit and this
/// is what refuses it, and `#7abc` with it. A letter after the number is a
/// longer word, not a reference.
function endsTheRun(text: string, i: number): boolean {
  if (i >= text.length) return true;
  return !/[A-Za-z0-9]/.test(text[i]);
}

/// Every pull request a message names.
///
/// The `#` has to open a word, the same rule [issue.ts](./issue.ts) states for a
/// tag and for the same reason: an email, a colour and a markdown heading are
/// all a `#` in the middle of something else. Bracketing punctuation counts as
/// opening one, so `(#7)` is a reference inside a sentence.
export function findPrRefs(text: string): PrRef[] {
  const out: PrRef[] = [];

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "#") continue;

    const previous = i > 0 ? text[i - 1] : " ";
    if (!SPACE.test(previous) && !OPENERS.includes(previous)) continue;

    let end = i + 1;
    while (end < text.length && DIGITS.includes(text[end])) end += 1;
    // A lone `#` is a word, not a reference, and `#fff` is a colour.
    if (end === i + 1) continue;
    if (!endsTheRun(text, end)) continue;

    out.push({ number: Number(text.slice(i + 1, end)), start: i, end });
    i = end - 1;
  }

  return out;
}

/// Where a chip goes when it is pressed.
///
/// A module-level opener rather than a prop, for [openLink](../components/chat/LinkDialog)'s
/// reason: the chip is drawn from inside a message's markdown, and the thing
/// that can open the pull-requests page and select one is `App` — four
/// components up and across a `memo` boundary that exists so a delta does not
/// re-parse every message in the transcript.
///
/// It takes the *session* rather than a repository, because only `App` holds
/// the index that can turn one into the other: a worktree session encodes the
/// repository in its `project_path`, and two checkouts of one project each have
/// their own `#12`.
export type PrRefOpener = (ref: { sessionId: string | null; number: number }) => void;

let opener: PrRefOpener | null = null;

export function setPrRefOpener(fn: PrRefOpener | null) {
  opener = fn;
}

/// Presses the chip. `false` where nothing is listening — a markdown surface
/// rendered outside a session, which is every surface but the transcript.
export function openPrRef(sessionId: string | null, number: number): boolean {
  if (!opener) return false;
  opener({ sessionId, number });
  return true;
}
