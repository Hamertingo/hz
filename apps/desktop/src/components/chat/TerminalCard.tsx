import { Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";

/// The shell the agent is using, shown as a card inside its working message: the
/// command, and what the last run printed. Take over opens a real shell in the
/// same folder.
///
/// The output is what the call returned once it finished — the agent's tool
/// result arrives whole, not as it prints — so a running command shows its caret
/// and the previous run's lines, not a live tail.
export default function TerminalCard({
  name,
  command,
  output,
  running,
  onTakeOver,
}: {
  name: string;
  command: string;
  output: string;
  running: boolean;
  onTakeOver: () => void;
}) {
  return (
    <div className="mt-2.5 max-w-[720px] overflow-hidden rounded-(--r3) bg-(--code-well) shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-center gap-2 border-b border-line py-[7px] pr-2 pl-3 text-xs text-ink2">
        <Terminal className="size-[13px]" />
        {name}'s terminal
        <Button variant="outline" size="xs" className="ml-auto" onClick={onTakeOver}>
          Take over
        </Button>
      </div>
      <pre className="max-h-48 overflow-auto px-3 py-2.5 font-mono text-[11.5px] leading-[1.65] whitespace-pre-wrap text-ink3">
        <span className="text-ink">$ {command}</span>
        {output ? `\n${output}` : ""}
        {running && <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-ink2" />}
      </pre>
    </div>
  );
}
