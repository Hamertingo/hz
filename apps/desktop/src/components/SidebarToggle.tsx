import PanelLeftIcon from "@/components/icons/PanelLeftIcon";
import ShortcutKeys from "@/components/ShortcutKeys";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/// Sidebar toggle. Lives outside the sidebar because a collapsed sidebar renders
/// nothing at all — the button has to survive its own pane disappearing, so the
/// app header owns it and its y position never moves.
export function SidebarToggle({
  onToggle,
  collapsed = false,
}: {
  onToggle: () => void;
  collapsed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Held back at rest — it's chrome, not content — and brought to full
            strength under the cursor. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-label="Toggle sidebar"
          className="opacity-80 transition-opacity hover:opacity-100"
        >
          <PanelLeftIcon className="size-4.5" dim={collapsed} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        Toggle Sidebar
        <ShortcutKeys ids={["sidebar.toggle"]} />
      </TooltipContent>
    </Tooltip>
  );
}

/// What the dev badge says for a given branch.
///
/// On `main` it stays bare: that is the common case, and naming the default
/// branch is a word the reader skips every time to reach the one that matters.
/// A worktree's branch is already `worktree-<name>`, so the prefix goes and the
/// badge names the tree the way the sidebar and `hz ls` do — stripped after
/// the `main` test, or a tree named `main` would read as no branch at all.
function devBadgeLabel(branch: string | null): string {
  if (branch === null || branch === "" || branch === "main") return "Dev";
  return `Dev · ${branch.replace(/^worktree-/, "")}`;
}

/// Marks a dev build so it can't be mistaken for the installed app, and names
/// the checkout it runs from — with several worktrees open, two dev builds are
/// otherwise identical.
///
/// Gated on `import.meta.env.DEV`, which Vite folds to a constant, so this
/// component and the branch it reads both drop out of a production bundle.
///
/// Muted, and at the sidebar's bottom edge: it marks the build rather than
/// offering anything to act on, so it belongs with the standing information and
/// not beside the app's name, and the orange it wore made the corner's quietest
/// fact its loudest. One line — a long branch truncates rather than pushing the
/// row, with `title` restoring it.
export function DevBadge() {
  return (
    <div
      title={__DEV_BRANCH__ ?? undefined}
      className="shrink-0 truncate px-3.5 pb-2 font-mono text-[10px] leading-none text-muted-foreground/60"
    >
      {devBadgeLabel(__DEV_BRANCH__)}
    </div>
  );
}
