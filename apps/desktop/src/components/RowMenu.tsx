import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Check,
  CopyPlus,
  Copy,
  Download,
  EyeOff,
  Folder,
  FolderInput,
  FolderPlus,
  GitBranchPlus,
  History,
  Layers,
  Mail,
  MailOpen,
  MoreHorizontal,
  Pencil,
  Phone,
  Pin,
  PinOff,
  SquareCheck,
  Trash2,
  X,
} from "lucide-react";

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
import type { ExportFormat } from "@/lib/exportSession";
import { cn } from "@/lib/utils";

/// The keyboard-reachable twin of dragging a sidebar row: either callback is
/// absent at its end of the list.
export type Moves = { up?: () => void; down?: () => void };

const ITEM = "gap-2.5 rounded-(--r1) px-[9px] py-[7px] text-[12.5px] focus:bg-active data-open:bg-active [&_svg:not([class*='text-'])]:text-ink3 [&_svg:not([class*='size-'])]:size-[15px]";
const SUB = "min-w-48 rounded-(--r3) p-[5px] shadow-(--shadow) ring-1 ring-line2";
const MENU = "w-56 rounded-(--r3) p-[5px] shadow-(--shadow) ring-1 ring-line2";
const RULE = "mx-2 my-1 bg-line";

function MoveItems({ moves, labels = ["Move up", "Move down"] }: { moves: Moves; labels?: [string, string] }) {
  return (
    <>
      <ContextMenuItem className={ITEM} disabled={!moves.up} onSelect={() => moves.up?.()}>
        <ArrowUp />
        {labels[0]}
      </ContextMenuItem>
      <ContextMenuItem className={ITEM} disabled={!moves.down} onSelect={() => moves.down?.()}>
        <ArrowDown />
        {labels[1]}
      </ContextMenuItem>
    </>
  );
}

/// A row's menu when move is all it has: a section header.
export function MoveMenu({ moves, labels, children }: { moves: Moves; labels?: [string, string]; children: React.ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48 rounded-(--r3) p-[5px] shadow-(--shadow) ring-1 ring-line2">
        <MoveItems moves={moves} labels={labels} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export type RowMenuProps = {
  children: React.ReactNode;
  pinned: boolean;
  onPin: () => void;
  onSelect: () => void;
  folders: { id: string; name: string }[];
  /// The folder the row is in now, for the tick.
  inFolder: string | null;
  onFolder: (id: string | null) => void;
  onNewFolder: () => void;
  unread: boolean;
  onToggleRead: () => void;
  editLabel: string;
  onEdit?: () => void;
  callLabel?: string;
  onCall?: () => void;
  onVersions?: () => void;
  onCopyId: () => void;
  workspaces?: { id: string; name: string }[];
  workspaceId?: string | null;
  onMoveWorkspace?: (id: string) => void;
  muted: boolean;
  onMute?: () => void;
  /// An agent with a session can be exported and forked; a channel or a fresh agent cannot.
  onExport?: (format: ExportFormat) => void;
  onFork?: (worktree: boolean) => void;
  forkDisabled?: boolean;
  onHide: () => void;
  onDelete: () => void;
  moves?: Moves;
};

/// The row's right-click menu: what the sidebar can do to one conversation, in the mockup's order.
///
/// Delete confirms in place, in the same menu, so the frame holds still under the cursor. `confirming`
/// resets on open: the content unmounts either way, but the state lives out here, and a cancelled delete
/// would otherwise reopen already armed.
export function RowMenu(p: RowMenuProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <ContextMenu onOpenChange={(open) => open && setConfirming(false)}>
      <ContextMenuTrigger asChild>{p.children}</ContextMenuTrigger>
      <ContextMenuContent className={MENU}>
        {confirming ? (
          <>
            <p className="px-2 py-1.5 text-[12.5px] text-ink3">Delete this for good?</p>
            <div className="mt-1 flex gap-1">
              <ContextMenuItem className={cn(ITEM, "flex-1 justify-center")}>Cancel</ContextMenuItem>
              <ContextMenuItem variant="destructive" onSelect={p.onDelete} className={cn(ITEM, "flex-1 justify-center bg-red/10")}>
                Delete
              </ContextMenuItem>
            </div>
          </>
        ) : (
          <>
            <ContextMenuItem className={ITEM} onSelect={p.onPin}>
              {p.pinned ? <PinOff /> : <Pin />}
              {p.pinned ? "Unpin" : "Pin to the top"}
            </ContextMenuItem>
            <ContextMenuItem className={ITEM} onSelect={p.onSelect}>
              <SquareCheck />
              Select
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger className={ITEM}>
                <FolderInput />
                Move to folder
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className={SUB}>
                {p.folders.map((f) => (
                  <ContextMenuItem key={f.id} className={ITEM} onSelect={() => p.onFolder(f.id)}>
                    <Folder />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {f.id === p.inFolder && <Check className="text-ink!" />}
                  </ContextMenuItem>
                ))}
                {p.inFolder && (
                  <ContextMenuItem className={ITEM} onSelect={() => p.onFolder(null)}>
                    <X />
                    Out of the folder
                  </ContextMenuItem>
                )}
                {p.folders.length > 0 && <ContextMenuSeparator className={RULE} />}
                <ContextMenuItem className={ITEM} onSelect={p.onNewFolder}>
                  <FolderPlus />
                  New folder…
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem className={ITEM} onSelect={p.onToggleRead}>
              {p.unread ? <MailOpen /> : <Mail />}
              {p.unread ? "Mark as read" : "Mark as unread"}
            </ContextMenuItem>

            <ContextMenuSeparator className={RULE} />

            <ContextMenuItem className={ITEM} disabled={!p.onEdit} onSelect={() => p.onEdit?.()}>
              <Pencil />
              {p.editLabel}
            </ContextMenuItem>
            {p.callLabel && (
              <ContextMenuItem className={ITEM} disabled={!p.onCall} onSelect={() => p.onCall?.()}>
                <Phone />
                {p.callLabel}
              </ContextMenuItem>
            )}
            {p.onVersions && (
              <ContextMenuItem className={ITEM} onSelect={p.onVersions}>
                <History />
                Versions…
              </ContextMenuItem>
            )}

            <ContextMenuSeparator className={RULE} />

            <ContextMenuItem className={ITEM} onSelect={p.onCopyId}>
              <Copy />
              Copy ID
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger className={ITEM}>
                <MoreHorizontal />
                More
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className={SUB}>
                {p.workspaces && p.workspaces.length > 1 && p.onMoveWorkspace && (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={ITEM}>
                      <Layers />
                      Move to workspace
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className={SUB}>
                      {p.workspaces.map((w) => (
                        <ContextMenuItem key={w.id} className={ITEM} disabled={w.id === p.workspaceId} onSelect={() => p.onMoveWorkspace?.(w.id)}>
                          <span className="min-w-0 flex-1 truncate">{w.name}</span>
                          {w.id === p.workspaceId && <Check className="text-ink!" />}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                )}
                {p.onMute && (
                  <ContextMenuItem className={ITEM} onSelect={p.onMute}>
                    {p.muted ? <Bell /> : <BellOff />}
                    {p.muted ? "Unmute" : "Mute"}
                  </ContextMenuItem>
                )}
                {p.onExport && (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger className={ITEM}>
                      <Download />
                      Export chat
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className={SUB}>
                      <ContextMenuItem className={ITEM} onSelect={() => p.onExport?.("md")}>
                        This session
                        <span className="ml-auto text-ink4">.md</span>
                      </ContextMenuItem>
                      <ContextMenuItem className={ITEM} onSelect={() => p.onExport?.("json")}>
                        The event log
                        <span className="ml-auto text-ink4">.json</span>
                      </ContextMenuItem>
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                )}
                {p.onFork && (
                  <>
                    <ContextMenuItem className={ITEM} disabled={p.forkDisabled} onSelect={() => p.onFork?.(false)}>
                      <CopyPlus />
                      Duplicate
                    </ContextMenuItem>
                    <ContextMenuItem className={ITEM} disabled={p.forkDisabled} onSelect={() => p.onFork?.(true)}>
                      <GitBranchPlus />
                      Fork in new worktree
                    </ContextMenuItem>
                  </>
                )}
                {p.moves && (
                  <>
                    <ContextMenuSeparator className={RULE} />
                    <MoveItems moves={p.moves} />
                  </>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSeparator className={RULE} />

            <ContextMenuItem className={ITEM} onSelect={p.onHide}>
              <EyeOff />
              Hide from sidebar
            </ContextMenuItem>
            {/* `preventDefault` holds the menu open: an item select closes it by default, which would take the confirm step down with it. */}
            <ContextMenuItem
              variant="destructive"
              className={ITEM}
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
