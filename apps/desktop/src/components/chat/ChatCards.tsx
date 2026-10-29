import { FileText, GitPullRequest } from "lucide-react";

import { useAgentChatActions } from "@/hooks/useAgentChat";
import type { ChatCard } from "@/lib/chatCards";
import { openSheet } from "@/lib/chatSheets";
import { shortenPath } from "@/lib/tools";

/// The cards under an agent's message: a document it wrote, a pull request it
/// opened. Pressing one opens it in the sheet beside the chat.
export default function ChatCards({ cards }: { cards: ChatCard[] }) {
  const chat = useAgentChatActions();
  if (!chat || cards.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {cards.map((card) => {
        const file = card.kind === "file";
        return (
          <button
            key={file ? card.path : card.url}
            type="button"
            onClick={() =>
              openSheet(
                file
                  ? { kind: "file", path: card.path, agentId: chat.agent.id }
                  : {
                      kind: "pr",
                      number: card.number,
                      repo: card.repo,
                      url: card.url,
                      agentId: chat.agent.id,
                    },
              )
            }
            className="mt-2.5 flex max-w-[520px] cursor-pointer items-center gap-3 rounded-(--r3) bg-s2 px-3.5 py-[11px] text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s3"
          >
            <span className="grid size-[34px] shrink-0 place-items-center rounded-(--r2) bg-s3 text-ink2">
              {file ? <FileText className="size-4" /> : <GitPullRequest className="size-4" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-[550]">
                {file ? card.name : `PR #${card.number}`}
              </span>
              <span className="mt-px block truncate text-[11.5px] text-ink3">
                {file ? `${shortenPath(card.path)} · made by ${chat.agent.name}` : `github · ${card.repo}`}
              </span>
            </span>
            <span className="ml-auto shrink-0 rounded-[5px] bg-s3 px-1.5 py-px text-[11px] font-medium text-ink3">
              {file ? "OPEN" : "PR"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
