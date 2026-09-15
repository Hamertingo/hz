import { useState } from "react";
import { Globe, Pencil, Plus, Target } from "lucide-react";

import RoleDialog from "@/components/RoleDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isGlobal, offerableRoles, roleById, roleScopeLabel, useRoles } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { Project, Role } from "@/types/events";

/// The radio value for "no responsibility", since a radio value cannot be
/// `null`. Kept out of the ids' namespace so a role cannot collide with it.
const NONE = "__none__";

/// Picks a responsibility, and is the way one is written.
///
/// **Two callers, one meaning each, and the difference is only what `onSelect`
/// does.** In a session's header it points *that agent* at a role; in the
/// composer it writes the *default* the next agents in this project start
/// under. Everything above that line — the offerable list, the dialog, the
/// actions — is the same, so it lives here once.
///
/// The menu is the picker: every role this context may carry, plus `None`. The
/// dialog behind the two items is where one is written, edited or deleted, and
/// a role made there is selected on the spot — the gesture is "give this agent
/// a responsibility", so creating one and then having to pick it would be
/// asking twice.
export default function RolePicker({
  roleId,
  projects,
  offerPath,
  defaultProjectPath,
  onSelect,
  onSelectGlobal,
}: {
  roleId: string | null;
  projects: Project[];
  /// The path the offered roles are resolved against. A session's project for
  /// the header, the composer's target for a new session — the same path the
  /// spawn resolves the role's scope through, so the menu cannot offer what the
  /// backend would withhold.
  offerPath: string | null;
  /// Where a newly written role is scoped by default.
  defaultProjectPath: string | null;
  /// Points at a role, or clears it with `null`. The one line that differs
  /// between the two callers.
  onSelect: (roleId: string | null) => void;
  /// Promotes a **global** role to the default every project starts under.
  /// Given only by the composer, and only there because the composer's own pick
  /// is filed under the open project — which leaves the every-project default
  /// unreachable from inside one. A project-scoped role has no such entry: it
  /// cannot be applied outside its own project, so promoting it would write a
  /// default the spawn then refuses.
  onSelectGlobal?: (roleId: string | null) => void;
}) {
  const roles = useRoles();
  const offerable = offerableRoles(roles, projects, offerPath);
  const role = roleById(roles, roleId);

  // The role being written, `"new"` for one that does not exist yet, `null` at
  // rest. One piece of state, because the dialog is either up or not and there
  // is never a second role in flight.
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  // The role that dialog holds, or `null` for a new one — resolved once so the
  // delete cleanup does not have to narrow `"new"`.
  const target = editing === "new" ? null : editing;

  const scopeName = (candidate: Role) =>
    projects.find((project) => project.path === candidate.projectPath)?.name ?? null;

  const instructions = role?.instructions.trim() ?? "";

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "max-w-44 gap-1.5 px-1.5 text-ui",
                  role ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Target className="size-3.5 shrink-0" />
                <span className="truncate">{role?.name ?? "Set responsibility"}</span>
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64 flex-col items-start">
            {role ? (
              <div className="flex flex-col gap-1">
                <span className="font-medium text-foreground">{role.name}</span>
                <span className="line-clamp-6 whitespace-pre-wrap text-muted-foreground">
                  {instructions || "No instructions yet."}
                </span>
              </div>
            ) : (
              "Give this agent a responsibility to focus it."
            )}
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent
          align="start"
          className="min-w-64"
          // The trigger is the tooltip trigger too, so Radix returning focus to
          // it on close reopens the tooltip and leaves it stuck — the model
          // picker's own note, and the same fix.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel>Responsibility</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={role?.id ?? NONE}
            onValueChange={(next) => onSelect(next === NONE ? null : next)}
          >
            <DropdownMenuRadioItem value={NONE} className="text-ui text-muted-foreground">
              None
            </DropdownMenuRadioItem>

            {offerable.map((candidate) => (
              <DropdownMenuRadioItem
                key={candidate.id}
                value={candidate.id}
                className="text-ui"
              >
                <span className="truncate">{candidate.name}</span>
                {/* Where the responsibility applies, which is the one thing two
                    same-named rows would differ by. */}
                <span className="ml-auto shrink-0 pl-2 text-ui text-muted-foreground/60">
                  {roleScopeLabel(candidate, scopeName(candidate))}
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>

          {offerable.length === 0 && (
            <p className="px-2 py-1.5 text-ui text-muted-foreground">
              No responsibilities yet
            </p>
          )}

          <DropdownMenuSeparator />

          {role && (
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-ui"
              onSelect={() => setEditing(role)}
            >
              <Pencil className="size-3.5" />
              <span className="truncate">Edit “{role.name}”</span>
            </DropdownMenuItem>
          )}
          {onSelectGlobal && role && isGlobal(role) && (
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-ui"
              onSelect={() => onSelectGlobal(role.id)}
            >
              <Globe className="size-3.5" />
              Use in every project
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-ui"
            onSelect={() => setEditing("new")}
          >
            <Plus className="size-3.5" />
            New responsibility…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mounted only while there is something to edit — see the dialog's own
          note for why that is also what resets its fields. */}
      {editing && (
        <RoleDialog
          role={target}
          projects={projects}
          defaultProjectPath={defaultProjectPath}
          onClose={() => setEditing(null)}
          onSaved={(saved, created) => {
            setEditing(null);
            // A new responsibility is picked on the spot; an edit is not a pick,
            // so a role edited from this menu stays selected exactly as it was.
            if (created) onSelect(saved.id);
          }}
          onDeleted={() => {
            setEditing(null);
            // A delete clears the reference from every agent the backend knows
            // about, but this surface's copy is in memory — left alone the
            // trigger keeps naming a responsibility that no longer exists.
            if (role && target && role.id === target.id) onSelect(null);
          }}
        />
      )}
    </>
  );
}
