import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import Swatches from "@/components/Swatches";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { ignoreToaster } from "@/components/ui/sheet";
import WorkspaceLogo from "@/components/WorkspaceLogo";
import { MASCOT_COLORS } from "@/lib/mascots";
import { workspaceMark } from "@/lib/workspace";
import { cn } from "@/lib/utils";

/// "Create workspace": a name, a colour and what the team is about. The context
/// goes in front of every agent's instructions, so it is asked for here rather
/// than left for settings.
export default function NewWorkspaceDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, color: string, context: string) => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(MASCOT_COLORS[4]);
  const [context, setContext] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setColor(MASCOT_COLORS[4]);
      setContext("");
    }
  }, [open]);

  const trimmed = name.trim();
  const submit = () => {
    if (!trimmed) return;
    onCreate(trimmed, color, context);
    onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-70 bg-black/55 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={ignoreToaster}
          className="fixed top-1/2 left-1/2 z-70 flex w-[min(470px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[18px] bg-(--pop) px-6 pt-6 pb-[18px] text-ink shadow-(--shadow) ring-1 ring-line2 backdrop-blur-xl outline-none data-open:animate-pop-in"
        >
          <div>
            <DialogPrimitive.Title className="text-[17px] font-semibold tracking-[-0.015em]">
              New workspace
            </DialogPrimitive.Title>
            <p className="mt-1 text-[13px] leading-normal text-ink3">
              A team of agents with its own context. Agents in one workspace never see another's.
            </p>
          </div>

          <div className="flex items-center gap-3.5">
            <WorkspaceLogo name={trimmed || "New"} mark={workspaceMark(trimmed || "N")} color={color} size={56} />
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="HyzeVM, Personal, Client X…"
              aria-label="Workspace name"
              className={cn(fieldClassName, "h-10 text-[15px]")}
            />
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-ink2">Colour</div>
            <Swatches value={color} onChange={setColor} />
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-medium text-ink2">What it's about</span>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Put in front of every agent's instructions."
              className={cn(fieldClassName, "h-[70px] resize-none leading-[1.55]")}
            />
          </label>

          <div className="flex justify-end gap-2 pt-0.5">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="solid" disabled={!trimmed} onClick={submit}>
              Create workspace
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
