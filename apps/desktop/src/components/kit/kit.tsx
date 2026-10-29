import { ChevronDown, ChevronRight, Search } from "lucide-react";
import React, { type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/// The pieces every screen is built from, so a list, a heading or a card looks the same wherever it appears.
/// They sit on the app's existing tokens (`s1…s3`, `line`, `ink…ink4`) and next to `ui/button`, `ui/switch`,
/// `ui/segmented` and `ui/input`, which already are the new look's buttons, toggle, segmented switch and field.
/// The mockup's `design/simple/ui.js` is the visual spec for each.

/// A hairline box that holds `Row`s; the rows are split by inset lines.
export function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[13px] bg-s1 shadow-[inset_0_0_0_1px_var(--line)] [&>*:first-child]:rounded-t-[13px] [&>*:last-child]:rounded-b-[13px] [&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:left-3 [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-line", className)}>{children}</div>;
}

/// One line in a `Group`: an optional lead (icon or face), a title with a quieter line under it, and a
/// right side that takes a value, a `Val`, a switch or a button. Pass `onClick` to make the whole row press.
export function Row({
  lead,
  bareLead,
  title,
  sub,
  right,
  onClick,
  red,
  className,
}: {
  lead?: ReactNode;
  /// Draw `lead` as given, without the 24px icon box: for a face or a brand tile.
  bareLead?: boolean;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  red?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {lead && bareLead ? lead : lead ? <span className="grid size-6 shrink-0 place-items-center text-ink2 [&_svg:not([class*='size-'])]:size-[17px]">{lead}</span> : null}
      <span className="min-w-0 flex-1 text-left">
        <b className={cn("block text-[13px] font-medium leading-[1.4]", red && "text-red")}>{title}</b>
        {sub ? <span className="mt-px block text-xs leading-[1.45] text-ink3">{sub}</span> : null}
      </span>
      {right !== undefined ? <span className="ml-auto flex max-w-[60%] shrink-0 items-center gap-1.5">{right}</span> : null}
    </>
  );
  const cls = cn("flex min-h-11 w-full items-center gap-[11px] px-3 py-[9px] text-left transition-colors [[data-lead]+&[data-lead]]:before:left-[46px]", onClick && "cursor-pointer hover:bg-s2", className);
  // A row that presses and also carries a control (a switch) on its right cannot be a <button>: buttons do not nest.
  if (onClick && right !== undefined && React.isValidElement(right) && typeof right.type !== "string" && right.type !== Val) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onClick();
          }
        }}
        className={cls}
      >
        {body}
      </div>
    );
  }
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/// The value on the right of a row: plain, a dropdown (`kind="down"`) or a page behind it (`kind="next"`).
export function Val({ children, kind }: { children?: ReactNode; kind?: "down" | "next" }) {
  return (
    <span className="inline-flex items-center gap-[5px] whitespace-nowrap text-[12.5px] text-ink2 [&_svg]:size-3.5 [&_svg]:text-ink4">
      {children}
      {kind === "down" ? <ChevronDown /> : kind === "next" ? <ChevronRight /> : null}
    </span>
  );
}

/// A heading over a group, with a count and one action on the right.
export function Section({ title, count, action, onAction, large, className }: { title: ReactNode; count?: ReactNode; action?: ReactNode; onAction?: () => void; large?: boolean; className?: string }) {
  return (
    <div className={cn("mx-1 mb-2 mt-5 flex items-baseline gap-1.5 first:mt-1", className)}>
      <b className={cn("font-medium leading-normal", large ? "text-sm font-semibold text-ink" : "text-xs text-ink3")}>{title}</b>
      {count !== undefined ? <i className="text-xs not-italic text-ink4">{count}</i> : null}
      {action ? (
        <button type="button" onClick={onAction} className="ml-auto cursor-pointer rounded-md px-[7px] py-px text-xs font-medium text-ink2 transition-colors hover:bg-s2 hover:text-ink">
          {action}
        </button>
      ) : null}
    </div>
  );
}

/// A small pill with a hairline: a status, an engine, a count.
export function Chip({ children, dot, onClick, className }: { children: ReactNode; dot?: "go" | "warn" | "bad" | "idle"; onClick?: () => void; className?: string }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] text-xs font-medium text-ink2 shadow-[inset_0_0_0_1px_var(--line2)] transition-colors [&_svg]:size-[13px]", onClick && "cursor-pointer hover:bg-s2 hover:text-ink", className)}
    >
      {dot ? <i className={cn("size-1.5 rounded-full", dot === "go" ? "bg-green" : dot === "warn" ? "bg-amber" : dot === "bad" ? "bg-red" : "bg-ink4")} /> : null}
      {children}
    </Tag>
  );
}

/// Tabs drawn as an underline under the current one, not a box.
export function UnderlineTabs<T extends string>({ value, onChange, options, className, size }: { value: T; onChange: (v: T) => void; options: readonly { value: T; label: ReactNode }[]; className?: string; size?: "sm" }) {
  return (
    <div role="tablist" className={cn("flex items-center gap-[18px] border-b border-line px-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn("relative cursor-pointer font-medium transition-colors", size === "sm" ? "h-[30px] text-[12.5px]" : "h-[34px] text-[13px]", o.value === value ? "text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-[1.5px] after:rounded-full after:bg-ink" : "text-ink3 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/// The frame for everything rich an agent posts: a quiet header line, a body, an optional footer of actions.
export function Card({ icon, label, right, children, foot, className }: { icon?: ReactNode; label?: ReactNode; right?: ReactNode; children: ReactNode; foot?: ReactNode; className?: string }) {
  return (
    <div className={cn("my-0.5 w-[min(500px,100%)] overflow-hidden rounded-[13px] shadow-[inset_0_0_0_1px_var(--line2)]", className)}>
      {label ? (
        <div className="flex items-center gap-[7px] px-3.5 pt-2.5 text-xs text-ink3 [&_svg]:size-3.5">
          {icon}
          <span>{label}</span>
          {right ? <span className="ml-auto flex items-center gap-1.5">{right}</span> : null}
        </div>
      ) : null}
      <div className="px-3.5 pb-3 pt-1.5">{children}</div>
      {foot ? <div className="flex items-center gap-1.5 border-t border-line px-3.5 py-2.5">{foot}</div> : null}
    </div>
  );
}

/// One answer in a question card: the number key that picks it, the answer, an optional note.
export function Choice({ n, children, note, onClick }: { n: number; children: ReactNode; note?: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] shadow-[inset_0_0_0_1px_var(--line)] transition-[background,box-shadow] hover:bg-s2 hover:shadow-[inset_0_0_0_1px_var(--line2)]">
      <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-s3 text-[10.5px] font-semibold text-ink3">{n}</span>
      {children}
      {note ? <span className="ml-auto text-xs text-ink3">{note}</span> : null}
    </button>
  );
}

/// A file or pull request inside the chat.
export function Attach({ icon, title, sub, onClick, right }: { icon: ReactNode; title: ReactNode; sub?: ReactNode; onClick?: () => void; right?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-[min(360px,100%)] cursor-pointer items-center gap-[11px] rounded-[13px] py-2 pl-2 pr-3 text-left shadow-[inset_0_0_0_1px_var(--line2)] transition-all hover:-translate-y-px hover:bg-s2">
      <span className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-s3 text-ink2 [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[13px] font-medium">{title}</b>
        {sub ? <span className="text-xs text-ink3">{sub}</span> : null}
      </span>
      {right}
    </button>
  );
}

/// The search box: a magnifier, the text, a hairline that brightens on focus.
export function SearchField({ className, ...props }: ComponentProps<"input">) {
  return (
    <label className={cn("flex h-8 items-center gap-2 rounded-lg bg-s1 px-2.5 text-ink3 shadow-[inset_0_0_0_1px_var(--line)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--line3)]", className)}>
      <Search className="size-3.5 shrink-0" />
      <input {...props} className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink4" />
    </label>
  );
}

/// Nothing here: a face or an icon, one line, and an optional action.
export function Empty({ children, face, action, className }: { children: ReactNode; face?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-7 text-center text-[12.5px] text-ink3", className)}>
      {face}
      <p>{children}</p>
      {action}
    </div>
  );
}

/// A keyboard key, as drawn in menu hints and the palette's footer.
export function Key({ children }: { children: ReactNode }) {
  return <span className="mr-1 inline-grid h-[18px] min-w-[18px] place-items-center rounded px-1 text-[10.5px] font-medium text-ink2 shadow-[inset_0_0_0_1px_var(--line2)]">{children}</span>;
}
