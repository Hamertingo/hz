import { useEffect, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ignoreToaster } from "@/components/ui/sheet";
import { formatClock } from "@/lib/clock";
import { cn } from "@/lib/utils";

/// A section of a profile tab: a bold heading with an optional action on its
/// right (the mockup's `.blk h3 .ed`).
export function Blk({
  title,
  action,
  onAction,
  children,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  onAction?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold">
        {title}
        {action &&
          (onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="ml-auto inline-flex cursor-pointer items-center gap-[5px] text-xs font-normal whitespace-nowrap text-ink3 transition-colors hover:text-ink"
            >
              {action}
            </button>
          ) : (
            <span className="ml-auto text-xs font-normal whitespace-nowrap text-ink3">{action}</span>
          ))}
      </h3>
      {children}
    </section>
  );
}

/// Four bars of how far an agent goes on its own; `level` is the last one lit.
export function Meter({ level }: { level: number }) {
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <i
          key={i}
          className={cn("h-2.5 w-1.5 rounded-[2px] not-italic", i <= level ? "bg-(--tint)" : "bg-foreground/12")}
        />
      ))}
    </span>
  );
}

/// How long ago, at the grain the mockup writes it: minutes, hours, yesterday,
/// then the date.
export function agoLabel(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/// "21:14" in the reader's clock.
export function clock(ms: number): string {
  return formatClock(new Date(ms));
}

/// A small dialog with one text field, for the two things on this page that ask
/// for a line of text: a rule and a budget.
export function TextDialog({
  open,
  onOpenChange,
  title,
  lead,
  placeholder,
  initial = "",
  confirm,
  prefix,
  inputMode,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  lead: string;
  placeholder?: string;
  initial?: string;
  confirm: string;
  prefix?: string;
  inputMode?: "decimal" | "text";
  /// Return false to keep the dialog open (the value was not acceptable).
  onSubmit: (value: string) => boolean;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  const submit = () => {
    if (onSubmit(value)) onOpenChange(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-70 bg-black/55 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={ignoreToaster}
          className="fixed top-1/2 left-1/2 z-70 flex w-[min(440px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[18px] bg-(--pop) px-6 pt-6 pb-[18px] text-ink shadow-(--shadow) ring-1 ring-line2 backdrop-blur-xl outline-none data-open:animate-pop-in"
        >
          <div>
            <DialogPrimitive.Title className="text-[17px] font-semibold tracking-[-0.015em]">
              {title}
            </DialogPrimitive.Title>
            <div className="mt-1 text-[13px] leading-normal text-ink3">{lead}</div>
          </div>
          <div className="flex items-center gap-2">
            {prefix && <span className="font-mono text-[13px] text-ink3">{prefix}</span>}
            <Input
              autoFocus
              value={value}
              inputMode={inputMode}
              placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className={cn(prefix && "w-32 font-mono")}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="h-[34px]" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="solid" className="h-[34px]" onClick={submit}>
              {confirm}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
