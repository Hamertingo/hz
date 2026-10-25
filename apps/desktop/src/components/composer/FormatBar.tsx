import {
  Bold,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FormatKind } from "@/lib/markdownFormat";

const TOOLS: { kind: FormatKind; label: string; icon: React.ReactNode }[] = [
  { kind: "bold", label: "Bold", icon: <Bold /> },
  { kind: "italic", label: "Italic", icon: <Italic /> },
  { kind: "strike", label: "Strikethrough", icon: <Strikethrough /> },
  { kind: "code", label: "Code", icon: <Code /> },
  { kind: "codeblock", label: "Code block", icon: <SquareCode /> },
  { kind: "link", label: "Link", icon: <Link2 /> },
  { kind: "bullet", label: "Bulleted list", icon: <List /> },
  { kind: "numbered", label: "Numbered list", icon: <ListOrdered /> },
  { kind: "quote", label: "Quote", icon: <Quote /> },
];

/// The row along the bottom of an agent's composer: who the message is for, then
/// the marks the transcript renders. It writes Markdown into the draft and nothing
/// else — what the agent receives is still plain text.
///
/// The buttons keep the textarea's focus (`onMouseDown` is cancelled), or each
/// press would drop the selection it is about to act on.
export default function FormatBar({
  recipient,
  onFormat,
  extra,
  end,
}: {
  recipient?: React.ReactNode;
  onFormat: (kind: FormatKind) => void;
  /// After the marks: attach, which writes into the draft the same way.
  extra?: React.ReactNode;
  /// At the far end: dictation and send.
  end?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-0.5 px-2.5 pt-0.5 pb-2">
      {recipient}
      {recipient && <span aria-hidden className="mx-1.5 h-4 w-px bg-border" />}
      {TOOLS.map((tool) => (
        <Tooltip key={tool.kind}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={tool.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onFormat(tool.kind)}
              className="text-muted-foreground hover:text-foreground"
            >
              {tool.icon}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{tool.label}</TooltipContent>
        </Tooltip>
      ))}
      {extra && <span aria-hidden className="mx-1.5 h-4 w-px bg-border" />}
      {extra}
      {end && <div className="ml-auto">{end}</div>}
    </div>
  );
}
