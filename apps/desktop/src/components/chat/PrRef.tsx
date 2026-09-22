import { useChatSession } from "@/hooks/useChatSession";
import { useKnownPr } from "@/hooks/usePrList";
import { openPrRef } from "@/lib/prRef";
import { cn } from "@/lib/utils";

/// The chip a pull request named in a message wears.
///
/// **A reference the repository has answered for is drawn only where it holds
/// one.** That is the whole reason a bare `#1` can be a reference here at all: a
/// number in a sentence is the same shape whether it names a pull request or a
/// priority, and GitHub resolves the ambiguity the only way it can be resolved —
/// by asking. `useKnownPr` answers from listings the app has already read, so
/// the asking costs nothing, and `#1 priority` in a repository whose listing
/// says there is no #1 stays the words it was written as. This is
/// [issue.ts](../lib/issue.ts)'s rule for a tag whose issue never resolved: a
/// button that opens nothing is worse than a word that was never one.
///
/// A repository that has **not** answered is the other side of it, and the chip
/// is offered there rather than withheld — see `useKnownPr` for what reading
/// that the wrong way round cost.
///
/// **Pressing it stays in the app**, which is the one thing a bare `#7` cannot
/// say — GitHub's own rendering of the same reference leaves the page. So it is
/// drawn as a control rather than as coloured text, on the shape this app gives
/// every reference it can act on: the accent for ink, a hairline for an edge,
/// and a fill only under the cursor.
///
/// It carries **no state glyph**, deliberately. `PrStateIcon` would be the
/// obvious thing to reach for and it would be a lie: a number in a sentence says
/// nothing about whether the pull request is open, merged or closed, and the
/// only thing that knows is the read the press starts.
///
/// The colour is the issue tag's, because both are "a tracker reference in a
/// sentence" and one colour for that idea is enough — what tells them apart is
/// the shape, since the tag is `#DRA-53` spelled out and this is a chip.
///
/// A `button` rather than the `span` a file path uses: this is an action, and
/// `role="link"` on a span exists for the file case alone, where the element has
/// to sit inside a row that is already a control.
export function PrRefChip({ number, label }: { number: number; label: string }) {
  const { sessionId, projectPath } = useChatSession();
  const known = useKnownPr(projectPath, number);

  // The words it was written as, and nothing else: no chip, no colour, no
  // control. **Only where the repository has answered and answered no** — an
  // unread one is not an answer, and treating it as one is what leaves a whole
  // session with no chips in it and nothing saying why.
  if (known === false) return <>{label}</>;

  return (
    <button
      type="button"
      // The destination is not something the reader has, which is the one case
      // the app's tooltip rule allows: a reference in prose does not say which
      // repository it is in, and this is the only place that can.
      title={`Open pull request ${label}`}
      aria-label={`Open pull request ${label}`}
      className={cn(
        "mx-px inline-flex cursor-pointer items-center rounded-md px-1 text-accent-issue",
        "ring-1 ring-border transition-colors hover:bg-muted/60",
      )}
      onClick={() => openPrRef(sessionId, number)}
    >
      {label}
    </button>
  );
}
