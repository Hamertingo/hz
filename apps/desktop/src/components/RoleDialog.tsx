import { useId, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, inputClassName } from "@/components/ui/input";
import { basename } from "@/lib/format";
import { defaultRoleScope, deleteRole, saveRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import type { Project, Role } from "@/types/events";

/// A responsibility's name, instructions and scope — the whole editor.
///
/// `role` is `null` for a new one, and the dialog branches on that alone: an
/// edit keeps the id so the backend replaces rather than appends, and a create
/// mints one here so the caller knows which row it just made. The id is the only
/// difference between the two, which is why one component carries both.
///
/// **Rendered only while it has something to edit** (`RoleControl`), never held
/// open by a prop: `DialogContent` unmounts on close anyway, and mounting fresh
/// is what lets every field initialize from the role rather than being reset by
/// an effect.
///
/// The scope list is attached projects only. A responsibility filed on a bare
/// path nothing attached is offered but never applied, so the default is global
/// — see [`defaultRoleScope`]. A role already carrying such a path keeps it (the
/// stray row below), so an edit cannot quietly move it to global.
export default function RoleDialog({
  role,
  projects,
  defaultProjectPath,
  onClose,
  onSaved,
  onDeleted,
}: {
  role: Role | null;
  projects: Project[];
  /// The session this was opened from, so a new responsibility defaults to that
  /// project where one contains it.
  defaultProjectPath: string | null;
  onClose: () => void;
  /// `created` is true for a new responsibility, which is what the caller uses
  /// to decide whether to assign it to the session it came from.
  onSaved: (role: Role, created: boolean) => void;
  onDeleted: () => void;
}) {
  const created = role === null;
  const [name, setName] = useState(role?.name ?? "");
  const [instructions, setInstructions] = useState(role?.instructions ?? "");
  const [scope, setScope] = useState<string | null>(
    role ? role.projectPath : defaultRoleScope(projects, defaultProjectPath),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Deleting is confirmed in place, the model list's bargain: a modal over a
  // modal is a second window for one question.
  const [confirming, setConfirming] = useState(false);

  const nameId = useId();
  const instructionsId = useId();

  const choices: { label: string; value: string | null }[] = [
    { label: "Global", value: null },
    ...projects.map((project) => ({ label: project.name, value: project.path })),
  ];
  // A role scoped to a path no longer attached: shown so the reader can see it
  // and move it, rather than the group reading as though nothing were selected.
  if (scope && !projects.some((project) => project.path === scope)) {
    choices.push({ label: basename(scope), value: scope });
  }

  // The radio group's roving selection: arrows and Home/End move the pick and
  // focus together, and only the picked row is a Tab stop — the promise
  // `role="radiogroup"` makes, the same one `SettingsDialog`'s groups keep.
  const scopeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedScope = choices.findIndex((choice) => choice.value === scope);
  const onScopeKeyDown = (e: React.KeyboardEvent) => {
    if (choices.length === 0) return;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? 0 : choices.length - 1;
      setScope(choices[next].value);
      scopeRefs.current[next]?.focus();
      return;
    }
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const from = selectedScope < 0 ? 0 : selectedScope;
    const next = (from + step + choices.length) % choices.length;
    setScope(choices[next].value);
    scopeRefs.current[next]?.focus();
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    const draft: Role = {
      id: role?.id ?? crypto.randomUUID(),
      name: trimmed,
      instructions,
      projectPath: scope,
    };

    setBusy(true);
    setError(null);
    const next = await saveRole(draft);
    setBusy(false);
    if (!next) {
      setError("Couldn't save the responsibility. Try again.");
      return;
    }
    onSaved(draft, created);
  };

  const remove = async () => {
    if (!role || busy) return;

    setBusy(true);
    setError(null);
    const next = await deleteRole(role.id);
    setBusy(false);
    if (!next) {
      setError("Couldn't delete the responsibility. Try again.");
      return;
    }
    onDeleted();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-110">
        <DialogHeader className="pr-6">
          <DialogTitle>
            {created ? "New responsibility" : "Edit responsibility"}
          </DialogTitle>
          <DialogDescription>
            What this agent is here to do. Dray sends it to the agent whenever it
            runs — an edit reaches every agent already carrying it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field id={nameId} label="Name">
            <Input
              id={nameId}
              autoFocus
              value={name}
              placeholder="Orchestrator"
              spellCheck={false}
              // `md:text-ui` as well as `text-ui`: the input's own base carries
              // `md:text-sm`, which would take over at desktop widths.
              className="text-ui md:text-ui"
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Enter saves from the name field, the one-line field where it
                // cannot mean "newline". The textarea below needs its Enter.
                if (e.key === "Enter") (e.preventDefault(), void submit());
              }}
            />
          </Field>

          <Field
            id={instructionsId}
            label="Instructions"
            hint="Sent verbatim"
          >
            <textarea
              id={instructionsId}
              value={instructions}
              spellCheck={false}
              placeholder="You coordinate the work across this workspace. Investigate before you change anything."
              onChange={(e) => setInstructions(e.currentTarget.value)}
              className={cn(
                inputClassName,
                "h-40 resize-y py-2 text-ui leading-relaxed md:text-ui",
              )}
            />
          </Field>

          <Field label="Scope">
            <div
              role="radiogroup"
              aria-label="Scope"
              onKeyDown={onScopeKeyDown}
              className="flex flex-col gap-1"
            >
              {choices.map((choice, i) => {
                const selected = scope === choice.value;
                return (
                  <button
                    key={choice.value ?? "__global__"}
                    ref={(el) => {
                      scopeRefs.current[i] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setScope(choice.value)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-ui transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
                      selected
                        ? "border-ring/60 bg-muted/60 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    )}
                  >
                    <span className="truncate">{choice.label}</span>
                    {selected && <Check className="ml-auto size-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        {error && <p className="text-ui text-destructive">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          {/* Delete only on an edit — a responsibility that does not exist yet
              has nothing to take back. Clearing it from *this* agent is the
              picker's None, a different act that keeps the role. */}
          <div>
            {!created &&
              (confirming ? (
                <div className="flex items-center gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    Delete
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirming(true)}
                >
                  Delete
                </Button>
              ))}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" disabled={busy || !name.trim()} onClick={() => void submit()}>
              {created ? "Create" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/// A labelled field: the name above, the control below.
///
/// `hint` sits on the label's line rather than under the control, where the
/// dialog's own description already lives — one line of "sent verbatim" beside
/// the word it qualifies reads faster than a sentence under a 10rem box.
function Field({
  id,
  label,
  hint,
  children,
}: {
  id?: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        {/* A label only reaches a labelable element, so the scope group — which
            is buttons — points its own `aria-label` at itself instead and gets
            a plain span here. Same bargain `SettingRow`'s `asGroup` makes. */}
        {id ? (
          <label htmlFor={id} className="text-ui font-medium">
            {label}
          </label>
        ) : (
          <span className="text-ui font-medium">{label}</span>
        )}
        {hint && <span className="text-ui text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
