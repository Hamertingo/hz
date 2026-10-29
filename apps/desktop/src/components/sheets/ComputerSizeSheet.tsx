import { Check, Cpu } from "lucide-react";
import { useState } from "react";

import Modal, { Hint } from "@/components/sheets/Modal";
import { toast } from "@/components/ui/toast";
import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";
import { kit, type VmSize } from "@/lib/kit";
import { cn } from "@/lib/utils";

const SIZES: { value: VmSize; name: string; spec: string; use: string }[] = [
  { value: "small", name: "Small", spec: "2 CPUs · 2 GB", use: "Browsing and light scripts" },
  { value: "medium", name: "Medium", spec: "4 CPUs · 4 GB", use: "Builds, tests, a few tabs" },
  { value: "large", name: "Large", spec: "8 CPUs · 8 GB", use: "Heavy builds and many tabs" },
];

const KEY = "hz.vmSize";

/// How much machine the agents' computer gets. The pick is kept here and sent to the backend, which
/// restarts the computer when no agent is working.
export default function ComputerSizeSheet({ agentId, open, onOpenChange }: { agentId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [size, setSize] = useState<VmSize>(() => {
    const v = readLocalStorage<string>(KEY, "small");
    return SIZES.some((s) => s.value === v) ? (v as VmSize) : "small";
  });

  const pick = async (next: VmSize) => {
    setSize(next);
    writeLocalStorage(KEY, next);
    try {
      await kit.vmSize(agentId, next);
      toast(`Computer set to ${next}. It restarts when no agent is working.`);
    } catch {
      toast(`Computer set to ${next}. It takes effect when the computer is connected.`);
    }
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Computer size" width={480}>
      <Hint>The agents share one computer on this Mac. A bigger one is faster and uses more of your Mac.</Hint>
      <div className="flex flex-col gap-2">
        {SIZES.map((s) => (
          <button
            key={s.value}
            type="button"
            onClick={() => void pick(s.value)}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-(--r3) px-3 py-[11px] text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s2",
              size === s.value && "bg-s1 shadow-[inset_0_0_0_1.5px_var(--ink2)]",
            )}
          >
            <span className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-s3 text-ink2">
              <Cpu className="size-[17px]" />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13px] font-medium">
                {s.name} · <span className="text-[12.5px] font-normal text-ink2">{s.spec}</span>
              </b>
              <span className="text-xs text-ink3">{s.use}</span>
            </span>
            {size === s.value && <Check className="size-4 shrink-0" />}
          </button>
        ))}
      </div>
    </Modal>
  );
}
