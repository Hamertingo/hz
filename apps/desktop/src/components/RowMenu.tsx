import { useRef, useState } from "react";
import { ArrowDownToLine, ArrowDown, ArrowUp, GitBranchPlus, Trash2, Unlink } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Kbd } from "@/components/ui/kbd";
import type { ExportFormat } from "@/lib/exportSession";

/// The keyboard-reachable twin of dragging a sidebar row: either callback is
/// absent at its end of the list.
export type Moves = { up?: () => void; down?: () => void };

function MoveItems({ moves, labels = ["Move up", "Move down"] }: { moves: Moves; labels?: [string, string] }) {
  return (
    <>
      <ContextMenuItem className="text-ui" disabled={!moves.up} onSelect={() => moves.up?.()}>
        <ArrowUp />
        {labels[0]}
      </ContextMenuItem>
      <ContextMenuItem className="text-ui" disabled={!moves.down} onSelect={() => moves.down?.()}>
        <ArrowDown />
        {labels[1]}
      </ContextMenuItem>
    </>
  );
}

/// A row's menu when move is all it has: channels, and agents with no session yet.
export function MoveMenu({ moves, labels, children }: { moves: Moves; labels?: [string, string]; children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <MoveItems moves={moves} labels={labels} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

/// The fork submenu's rows, in the order they are drawn. The number key that
/// picks one is its position here — the rule the pane digits follow too — so
/// reordering moves the digits with it and there is no second table to fall out
/// of step with the labels.
const FORKS = [
  { label: "Fork in new worktree", worktree: true },
  { label: "Fork here", worktree: false },
] as const;

/// The row's right-click menu. Delete confirms in place — a second surface for
/// two words costs more than it protects, and the menu is already open under the
/// cursor. Both steps live in one `Content` so the menu holds its position
/// across the swap; reanchoring mid-decision would move the target being aimed
/// at.
///
/// `confirming` resets on open rather than on close. The content unmounts either
/// way, but the state lives out here, so without it a cancelled delete would
/// reopen already armed.
///
/// A context menu can't be opened programmatically, so `ContextMenu` takes no
/// `open` — the trigger's own `data-state` is what the row styles off, and there
/// is no second copy of the flag to fall out of step with it.
export function RowMenu({
  onFork,
  forkDisabled,
  onDelete,
  onDetach,
  onExport,
  moves,
  children,
}: {
  onFork: (worktree: boolean) => void;
  /// The session's turn is in flight. The CLI forks by reading its transcript,
  /// which a live child is appending to mid-turn, so a fork taken now can
  /// inherit half a turn. `SessionManager::fork` refuses on the same question
  /// (`turn_in_flight`, which is exactly `in_progress`) and nothing wider —
  /// a session still running a background task forks fine.
  forkDisabled: boolean;
  onDelete: () => void;
  /// Absent on a row that isn't nested — there is nothing to detach from, and
  /// a disabled item on every row in the list would be noise rather than a
  /// promise of something coming.
  onDetach?: () => void;
  /// **Here rather than only in `⌘K`, which is where it started.** A palette row
  /// is found by someone who already knows what they are looking for, and every
  /// other thing you can do to one session already lives in this menu — so an
  /// export that existed only down there was a feature with no way in.
  onExport: (format: ExportFormat) => void;
  moves?: Moves;
  children: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  // Radix moves DOM focus onto the sub's own content only once the pointer (or
  // an arrow key) actually enters it — hovering the trigger alone opens the
  // submenu but leaves focus behind on the trigger. Reading `open` instead of
  // focus location is what lets a number fire the moment the submenu is drawn,
  // without the cursor ever crossing into it.
  const [forkOpen, setForkOpen] = useState(false);
  // A digit clicks the row rather than calling `onFork` directly, so closing the
  // menu and restoring focus stay Radix's job — picking by key and picking by
  // mouse then cannot end in different states.
  const forkRefs = useRef<(HTMLDivElement | null)[]>([]);

  return (
    <ContextMenu onOpenChange={(open) => open && setConfirming(false)}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>

      {/* Portaled, so a click in here never reaches the row's select handler. */}
      {/* Wide enough for the confirm step's two buttons, which is the widest
          thing this menu ever holds — the width is fixed rather than fitted so
          the frame doesn't resize under the cursor when Delete swaps them in. */}
      {/*
          The digit listener lives up here rather than on the sub's own content:
          `SubContent` renders through a portal, so a handler placed there only
          ever fires once focus — not just the open submenu — has moved inside
          it. React still delivers the event here through the component tree
          rather than the DOM one, so this fires the instant the submenu opens,
          whether that happened by hover or by keyboard, and no matter which of
          the two elements the key lands on.
      */}
      <ContextMenuContent
        className="w-48"
        onKeyDown={(e) => {
          if (!forkOpen) return;
          const picked = forkRefs.current[Number(e.key) - 1];
          if (!picked) return;
          // Holds the digit back from Radix's own typeahead, which would
          // otherwise read it as a search letter and jump focus instead.
          e.preventDefault();
          picked.click();
        }}
      >
        {confirming ? (
          <>
            {/* No title in the copy: the menu opens on the row, which stays on
                screen beside it and already names the session. */}
            <p className="px-1.5 py-1 text-ui text-muted-foreground">
              Are you sure?
            </p>

            {/* Items rather than buttons, so selecting either closes the menu on
                its own — nothing here can reopen it, and a stranded confirm step
                is the one state with no way out but Escape. */}
            <div className="mt-1 flex gap-1">
              <ContextMenuItem className="flex-1 justify-center text-ui">
                Cancel
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onSelect={onDelete}
                className="flex-1 justify-center bg-destructive/10 text-ui"
              >
                Yes, Delete
              </ContextMenuItem>
            </div>
          </>
        ) : (
          <>
            {moves && (
              <>
                <MoveItems moves={moves} />
                <ContextMenuSeparator />
              </>
            )}
            {/* A submenu because the two forks differ in where the copy
                *runs*, not in what it copies — both carry the whole
                conversation. Flattening them into two top-level items would put
                the rarer choice beside Delete on every row. */}
            <ContextMenuSub onOpenChange={setForkOpen}>
              <ContextMenuSubTrigger
                disabled={forkDisabled}
                className="text-ui"
              >
                <GitBranchPlus />
                Fork
              </ContextMenuSubTrigger>

              {/* Sized by its own rows. Nothing swaps in here, so there is
                  no second layout to hold a width for. */}
              <ContextMenuSubContent>
                {FORKS.map((fork, i) => (
                  <ContextMenuItem
                    key={fork.label}
                    ref={(el) => {
                      forkRefs.current[i] = el;
                    }}
                    className="text-ui"
                    onSelect={() => onFork(fork.worktree)}
                  >
                    {fork.label}
                    <Kbd className="ml-auto">{i + 1}</Kbd>
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>

            {/* A submenu for Fork's own reason: two answers to one question,
                and flattening them would put the rarer choice beside Delete on
                every row. The extension is on the right where a chord would be,
                because it is the one thing telling the two apart. */}
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-ui">
                <ArrowDownToLine />
                Export
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem className="text-ui" onSelect={() => onExport("md")}>
                  This session
                  <span className="ml-auto text-muted-foreground">.md</span>
                </ContextMenuItem>
                <ContextMenuItem className="text-ui" onSelect={() => onExport("json")}>
                  The event log
                  <span className="ml-auto text-muted-foreground">.json</span>
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>

            {onDetach && (
              <ContextMenuItem className="text-ui" onSelect={onDetach}>
                <Unlink />
                Detach from parent
              </ContextMenuItem>
            )}

            {/* `preventDefault` holds the menu open — an item select closes it by
                default, which would take the confirm step down with it. */}
            <ContextMenuItem
              variant="destructive"
              className="text-ui"
              onSelect={(e) => {
                e.preventDefault();
                setConfirming(true);
              }}
            >
              <Trash2 />
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
