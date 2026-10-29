import AgentAvatar from "@/components/AgentAvatar";
import FileIcon from "@/components/FileIcon";
import PickerMenu from "@/components/composer/PickerMenu";
import type { RosterAgent } from "@/lib/roster";
import type { FileMatch } from "@/types/events";

/// One row of the `@` list in an agent's composer: a teammate to bring in, or a
/// file to point at.
export type MentionRow = { kind: "agent"; agent: RosterAgent } | { kind: "file"; file: FileMatch };

/// The `@` list when the chat has teammates to offer: they come first, then the
/// files, in one list that the arrows, Enter and Tab walk as one.
export default function MentionMenu({
  rows,
  activeIndex,
  onPick,
  onHover,
  working,
  members,
}: {
  rows: MentionRow[];
  activeIndex: number;
  onPick: (row: MentionRow) => void;
  onHover: (index: number) => void;
  /// Agents mid-turn, for the word on their row.
  working: ReadonlySet<string>;
  /// A channel's members. An agent outside them is marked "not in channel".
  members?: readonly string[];
}) {
  const agents = rows.filter((r) => r.kind === "agent");
  const files = rows.filter((r) => r.kind === "file");
  return (
    <PickerMenu
      groups={[
        ...(agents.length ? [{ label: "Bring someone in", items: agents }] : []),
        ...(files.length ? [{ label: "Files", items: files }] : []),
      ]}
      label="Mentions"
      keyOf={(row) => (row.kind === "agent" ? `agent:${row.agent.id}` : `file:${row.file.path}`)}
      activeIndex={activeIndex}
      onPick={onPick}
      onHover={onHover}
      renderItem={(row) =>
        row.kind === "agent" ? (
          <>
            <AgentAvatar agent={row.agent} size={20} />
            <span className="shrink-0 font-medium">{row.agent.name}</span>
            <span className="min-w-0 truncate text-muted-foreground">{row.agent.role}</span>
            {members && !members.includes(row.agent.id) ? (
              <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">not in channel</span>
            ) : (
              working.has(row.agent.id) && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground/70">working</span>
              )
            )}
          </>
        ) : (
          <>
            <FileIcon path={row.file.path} className="size-3.5" />
            <span className="shrink-0 font-medium">{row.file.name}</span>
            {row.file.dir && <span className="min-w-0 truncate text-muted-foreground">{row.file.dir}</span>}
          </>
        )
      }
    />
  );
}
