import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { invoke } from "@tauri-apps/api/core";

import { useChatSession } from "@/hooks/useChatSession";
import { openPath } from "@/hooks/useDocs";
import { openFile } from "@/lib/openWith";
import { cn } from "@/lib/utils";

/// A path anywhere in the chat, drawn as something that opens.
///
/// A span with `role="link"` rather than a button or an anchor, because one of
/// the three callers puts this *inside* the tool row's own expand button —
/// nesting a second interactive element there would be invalid markup and the
/// click would toggle the row instead of opening anything. `stopPropagation` is
/// what keeps the two apart, and it has to happen on the key as well as on the
/// click.
///
/// Underlined on hover rather than at rest, matching the issue tag beside it: a
/// permanent underline through a sentence reads as a correction, and in an
/// agent's prose it would mark up every path it mentions.
///
/// `writtenAsLink` is the exception, and it is not a style choice — the author
/// spelled that one `[Footer.js](/Users/me/Footer.js)`, so it has to read as the
/// link they wrote and sit beside the message's other links without looking
/// half-converted.
export default function FileLink({
  path,
  raw,
  line,
  title,
  writtenAsLink = false,
  className,
  children,
}: {
  /// Absolute, and already resolved. This draws whatever it is given and asks
  /// nothing about whether the file is there: both panels this opens into say
  /// so in their own words, and a ⌘-click on something gone falls through to a
  /// reveal that does nothing.
  path: string;
  /// The name as the agent wrote it, where what it wrote was *relative*.
  ///
  /// Present only on that branch, and it is what turns the click into a check:
  /// `path` above came from joining this to the session's cwd, and that join is a
  /// guess — the agent wrote the name against whatever directory *it* was in, so
  /// the join lands one folder off often enough to be worth undoing at the one
  /// moment something can look at the disk. Absent for an absolute path, which is
  /// the agent's own and needs no second opinion.
  raw?: string;
  /// The line the reference named, where it named one. Scrolled to and marked
  /// in the Files view, honoured by an editor, and ignored by a reveal, which
  /// can only select the file.
  line?: number;
  title?: string;
  /// This was a markdown link before it was a file link, so draw it as one.
  writtenAsLink?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  // Whose transcript drew this link, and so whose panel a doc opened here
  // belongs in. Read from context rather than passed down: three components in
  // between would carry an id they never look at, and the transcript that drew
  // the link is the right answer even where it is not the selected session.
  const { sessionId, cwd, projectPath } = useChatSession();

  /// Where this link's file actually is, before anything is opened.
  ///
  /// **Only a path that was *resolved* is re-checked.** An absolute one is the
  /// agent's own and is opened exactly as drawn; a relative one was joined to the
  /// session's cwd at draw time, and that join is a guess — the agent wrote the
  /// name against whatever directory *it* was in, which is often a subdirectory of
  /// the session's, so the guess lands one folder off and the click answers "No
  /// file at this path" about a file that is right there.
  ///
  /// Draw time cannot check it: this renders on every streamed delta and has no way
  /// to touch the disk. The click can, so it does — and where nothing resolves with
  /// certainty, the drawn path is opened unchanged, which is what happened before.
  const locate = async (): Promise<string> => {
    if (!raw) return path;
    const found = await invoke<string | null>("resolve_named_path", {
      raw,
      cwd,
      projectPath,
    }).catch(() => null);
    return found ?? path;
  };

  const open = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    // ⌘-click (Ctrl elsewhere) means "out there, not here" — the same thing it
    // means on an issue row and in the link dialog — so it goes straight to the
    // reader's own editor, line and all. A plain click stays in the app:
    // markdown in the Docs panel, everything else in the Files view.
    const outThere = e.metaKey || e.ctrlKey;
    void locate().then((resolved) => {
      if (outThere) return void openFile(resolved, line);
      openPath(sessionId, resolved, line);
    });
  };

  return (
    <span
      role="link"
      tabIndex={0}
      title={title ?? path}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        open(e);
      }}
      className={cn(
        "cursor-pointer",
        writtenAsLink
          ? // Streamdown's own anchor classes, copied because there is no way to
            // reach its link renderer from here — and looking like the links
            // either side of it is the whole point of this branch.
            "wrap-anywhere font-medium text-primary underline"
          : "underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current",
        className,
      )}
    >
      {children ?? path}
    </span>
  );
}
