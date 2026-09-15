import { FolderGit2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { basename } from "@/lib/format";
import { ROOT_VALUE, targetValue, valueToTarget } from "@/lib/target";
import type { RepoSummary } from "@/types/events";

/// Where a new session runs, for a project that is a workspace — a directory
/// holding repositories rather than being one.
///
/// **Drawn only when the project holds more than one**, which is the whole of
/// how this stays invisible to everything that came before it: a project that is
/// itself a repository answers one entry, so this returns `null` and the
/// composer reads exactly as it always did. Nothing here is gated on a flag or a
/// migration — the absence of a second repository *is* the old behaviour.
///
/// **The whole project is the first row**, and it is not a repository: it is
/// `Project.path`, the directory the reader attached. Choosing it runs the
/// session there, where the agent reaches every repository under it — which is
/// what makes a cross-repository task work without picking one of them, and what
/// `omp` does when it is opened at the root. Choosing a repository narrows the
/// session to it, and that is where branches, worktrees and pull requests live.
///
/// Creation-time only, like the project and branch pickers beside it and for the
/// same reason: it decides which child process runs and where. Once a session
/// exists the choice is in its header, and this control is gone.
///
/// It sits **before** the branch picker, because it is what that picker is a
/// picker *of*: the branches on offer belong to the repository chosen here, and
/// a reader reading left to right gets the narrowing in the order it happens.
export default function RepoSelector({
  rootPath,
  repos,
  value,
  onSelect,
}: {
  /// The project root — the workspace, and the first row. Named rather than
  /// passed whole, since the two rows want different halves of it.
  rootPath: string;
  repos: RepoSummary[];
  /// `null` is the project root. See `lib/target.ts`.
  value: string | null;
  onSelect: (path: string | null) => void;
}) {
  // `repos` is required, but a caller on an older wiring passes nothing — and
  // an undefined list must never take the whole composer down. Absent reads
  // as "one repository", which draws nothing by the rule below.
  if (!repos || repos.length < 2) return null;
  const atRoot = value === null;
  const selected = repos.find((repo) => repo.path === value) ?? null;
  // What the trigger says: the root's own folder with a trailing slash, so it
  // reads as the directory it is rather than as one more repository beside the
  // ones below it.
  const name = atRoot ? `${basename(rootPath)}/` : (selected?.name ?? "Repository");

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="max-w-40 gap-1.5 px-1.5 text-ui text-muted-foreground"
            >
              {/* Same slot and same size as the project and branch glyphs beside
                  it, so the row reads as one set of controls. */}
              <FolderGit2 className="size-3.5 shrink-0" />
              <span className="truncate">{name}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        {/* The path, since a folder name is what the trigger already says and
            the path is what an error or the CLI would name. */}
        <TooltipContent side="top" className="max-w-none whitespace-nowrap">
          {atRoot ? rootPath : (selected?.path ?? "Repository")}
        </TooltipContent>
      </Tooltip>

      {/* The dropdown is as wide as the *trigger* — `w-(--radix-dropdown-menu-
          trigger-width)` in the content — and that trigger is a short folder
          name, so without a floor this menu is ~160px and every row truncates.
          The floor is what a repository name and a branch need side by side. */}
      <DropdownMenuContent align="start" className="min-w-72">
        {/* One group, so arrow keys and the radio dot behave as one choice —
            which they are. The value bridge is `lib/target.ts`, and the
            sentinel never leaves this component. */}
        <DropdownMenuRadioGroup
          value={targetValue(value)}
          onValueChange={(next) => onSelect(valueToTarget(next))}
        >
          <DropdownMenuRadioItem value={ROOT_VALUE} title={rootPath} className="gap-2 text-ui">
            <span className="max-w-[60%] shrink-0 truncate">{basename(rootPath)}/</span>
            {/* In the slot the repositories use for their branch, because that
                is what it is the alternative to: a repository row says what
                that repository is on, and the root says it is not one. */}
            <span className="ml-auto shrink-0 text-ui text-muted-foreground/60">Workspace</span>
          </DropdownMenuRadioItem>

          {/* The rule is the whole separation: above it the project, below it
              the repositories inside it. No heading text — the two rows either
              side already say which is which, and a label there would be a
              third thing reading the same difference. */}
          <DropdownMenuSeparator />

          {repos.map((repo) => (
            <DropdownMenuRadioItem
              key={repo.path}
              value={repo.path}
              title={repo.path}
              className="gap-2 text-ui"
            >
              {/* **The name is the row and may not be crushed.** The branch is
                  context beside it, so the name holds its width (up to a share
                  of the row) and the branch yields.

                  This is the whole of the layout, and getting it backwards is
                  what it looked like: a `shrink-0` on the *branch* made it
                  demand every pixel of a 224px row, and a branch like
                  `feat/hyze-257-emit-zip-encrypted` left the repository's own
                  name ellipsised down to `h..`. Both need `min-w-0` to be
                  shrinkable at all, since a flex item's floor is its content
                  until `overflow` says otherwise. */}
              <span className="max-w-[60%] shrink-0 truncate">{repo.name}</span>
              <span className="ml-auto flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground/60">
                {repo.dirty > 0 && (
                  <span
                    title={`${repo.dirty} uncommitted`}
                    className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                  />
                )}
                <span className="min-w-0 truncate">{repo.branch ?? "detached"}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
