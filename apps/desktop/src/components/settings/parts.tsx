import { Check } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";

import { Val } from "@/components/kit/kit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/// Lets a page send the reader to another page of the same dialog ("Edit profile") without
/// the dialog handing its tab state down through every body.
export const SettingsNav = createContext<(tab: string) => void>(() => {});
export const useSettingsNav = () => useContext(SettingsNav);

/// A value with a chevron that opens a menu of choices: the mockup's `Down` on a row.
export function Pick<T extends string>({
  label,
  value,
  shown,
  options,
  onChange,
}: {
  label: string;
  value: T;
  shown?: ReactNode;
  options: readonly { value: T; label: ReactNode; lead?: ReactNode }[];
  onChange: (next: T) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Val kind="down">{shown ?? current?.label ?? value}</Val>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-44">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => onChange(o.value)} className="cursor-pointer">
            {o.lead}
            <span className="flex-1">{o.label}</span>
            {o.value === value && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/// The row's own text box: reads as a value until hovered, like the mockup's `.inl`.
export function Inline({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "className"> & { className?: string }) {
  return (
    <input
      {...props}
      className={cn(
        "w-[190px] cursor-text rounded-md bg-transparent px-1.5 py-[3px] text-right text-[12.5px] text-ink2 outline-none transition-colors placeholder:text-ink4 hover:bg-s3 hover:text-ink focus:bg-s3 focus:text-ink",
        className,
      )}
    />
  );
}

/// A card's lead tile, with the status dot hanging off its corner.
export function MacTile({ children, dot = "bg-green" }: { children: ReactNode; dot?: string }) {
  return (
    <span className="relative grid size-9 shrink-0 place-items-center rounded-[10px] bg-s3 text-ink2">
      {children}
      <i className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full shadow-[0_0_0_2px_var(--pop)]", dot)} />
    </span>
  );
}
