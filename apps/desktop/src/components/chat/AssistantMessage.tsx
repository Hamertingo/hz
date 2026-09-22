import { memo } from "react";

import { Markdown } from "@/components/chat/Markdown";

/// Full-width and unbubbled — assistant output is the page's main content, and
/// wrapping code blocks or tables in a bubble only costs horizontal room.
///
/// Memoised on two primitives, which is the whole prop list: a message that has
/// not changed is not re-rendered however often the transcript around it is.
/// That matters most for the one message that *is* growing — a delta re-renders
/// this row and only this row, and the `Markdown` under it is memoised on the
/// same text, so a settled answer costs nothing while the live one types.
function AssistantMessage({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    // `data-answer` marks the one region a text selection may be quoted from —
    // see `AssistantSelectionToolbar`. On a wrapper rather than on the markdown,
    // which renders whatever element its own tree starts with.
    <div data-answer="">
      {/* The one surface whose paths name files on this machine, so the one that
          draws them as something to open. */}
      <Markdown streaming={streaming} sessionRefs>
        {text}
      </Markdown>
    </div>
  );
}

export default memo(AssistantMessage);
