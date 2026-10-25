import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { lineDiff, withContext } from "@/lib/lineDiff";
import { cn } from "@/lib/utils";

/// Two versions of the instructions side by side in one column: what changed
/// since `fromLabel`, as a line diff.
export default function VersionSheet({
  open,
  onOpenChange,
  fromLabel,
  toLabel,
  before,
  after,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fromLabel: string;
  toLabel: string;
  before: string;
  after: string;
}) {
  const rows = withContext(lineDiff(before, after));
  const same = rows.every((r) => r.kind === "gap" || r.kind === "same");

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width={560}
      title={`${fromLabel} → ${toLabel}`}
      sub="instructions.md"
      footer={
        <Button variant="solid" className="ml-auto" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      {same ? (
        <p className="text-[13px] text-ink3">These two are the same text.</p>
      ) : (
        <div className="overflow-hidden rounded-(--r2) font-mono text-xs leading-[1.7]">
          {rows.map((r, i) =>
            r.kind === "gap" ? (
              <div key={i} className="bg-s2 px-3 py-0.5 text-ink4">
                @@ {r.hidden} unchanged {r.hidden === 1 ? "line" : "lines"} @@
              </div>
            ) : (
              <div
                key={i}
                className={cn(
                  "px-3 py-px break-words whitespace-pre-wrap",
                  r.kind === "add" && "bg-green/12 text-green",
                  r.kind === "del" && "bg-red/12 text-red",
                  r.kind === "same" && "text-ink3",
                )}
              >
                {r.kind === "add" ? "+ " : r.kind === "del" ? "- " : "  "}
                {r.text}
              </div>
            ),
          )}
        </div>
      )}
    </Sheet>
  );
}
