import { Quote, X } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";

/// The little bar that appears over a selection in an answer.
///
/// **A pointer selection, not any selection.** There is no menu for a keyboard
/// selection: this is a convenience over a gesture, and wiring `selectionchange`
/// to reveal it would have the bar appear and vanish while somebody types their
/// own prompt in the composer next door.
///
/// It decides from the DOM rather than from props — the answer it quotes is
/// somewhere under the transcript's scroller, and a handler per answer row would
/// be another prop on the hottest component in the app.
export default function AssistantSelectionToolbar({
  scroller,
  onCite,
}: {
  /// The transcript's scroll container. A selection outside it is somebody
  /// else's — the docs pane and the diff view have their own reading.
  scroller: RefObject<HTMLElement | null>;
  /// Pins the quotation to the composer. Handed in rather than reached for, so
  /// this stays a view: who owns the chip row is the composer's business.
  onCite: (quote: string) => void;
}) {
  const [selection, setSelection] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const scrollerEl = scroller.current;

    const read = () => {
      const el = scroller.current;
      const live = window.getSelection();
      if (!el || !live || live.isCollapsed || live.rangeCount === 0) {
        setSelection(null);
        return;
      }

      const range = live.getRangeAt(0);
      const text = live.toString().trim();
      if (!text) {
        setSelection(null);
        return;
      }

      // Only from an answer. The transcript holds the reader's own prompts, tool
      // rows and cards too, and quoting a prompt back at the agent is not what
      // this is for — nor is quoting a button's label.
      const node = range.commonAncestorContainer;
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      const answer = element?.closest("[data-answer]");
      if (!answer || !el.contains(answer)) {
        setSelection(null);
        return;
      }

      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) {
        setSelection(null);
        return;
      }

      setSelection({ x: rect.left + rect.width / 2, y: rect.top, text });
    };

    const hide = () => setSelection(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    document.addEventListener("pointerup", read);
    document.addEventListener("keydown", onKey);
    // A bar pinned to a viewport rect means nothing once the text under it has
    // moved, and the selection it describes is off screen.
    scrollerEl?.addEventListener("scroll", hide);

    return () => {
      document.removeEventListener("pointerup", read);
      document.removeEventListener("keydown", onKey);
      scrollerEl?.removeEventListener("scroll", hide);
    };
  }, [scroller]);

  if (!selection) return null;

  const cite = () => {
    onCite(selection.text);
    // The selection goes with the bar: leaving it lit over a chip that now holds
    // the same words reads as the app having done nothing.
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  return createPortal(
    // `fixed` from the selection's own viewport rect, and portalled to the body:
    // the transcript is a scroller, so an absolutely-positioned bar inside it
    // would be clipped by the overflow and dragged along by the scroll.
    <div
      className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-border/60 bg-popover p-0.5 shadow-sm"
      style={{ left: selection.x, top: selection.y - 8 }}
      // Never takes the selection away: pressing one of these must not clear it
      // before the press lands.
      onPointerDown={(e) => e.preventDefault()}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={cite}
        className="cursor-pointer gap-1.5 text-ui"
      >
        <Quote className="size-3.5" />
        Cite in composer
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Dismiss"
        onClick={() => setSelection(null)}
        className="cursor-pointer text-muted-foreground"
      >
        <X />
      </Button>
    </div>,
    document.body,
  );
}
