import { useState } from "react";

import { ChevronDown, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NewAutomation } from "@/hooks/useAutomations";
import { modelDisplayName } from "@/lib/modelBrand";
import { cn } from "@/lib/utils";
import type { Automation, Model, ModelId, Project } from "@/types/events";

/// The shortest interval the backend accepts, repeated here so the field can say
/// so before the press rather than after it.
const MIN_EVERY_MINUTES = 15;
const DEFAULT_EVERY_MINUTES = 60;

/// Prompts that run themselves, listed with the form that makes one.
///
/// **Nothing here runs them.** The poll lives in the app's own process and
/// starts whether or not this screen was ever opened — see `automations.rs`.
/// This is the file's editor and nothing more, which is why the list draws what
/// the file holds rather than a schedule it worked out for itself.
export default function AutomationsSettings({
  automations,
  models,
  projects,
  error,
  onCreate,
  onRemove,
  onSetEnabled,
}: {
  automations: Automation[];
  models: Model[];
  projects: Project[];
  error: string | null;
  onCreate: (input: NewAutomation) => Promise<boolean>;
  onRemove: (id: string) => void;
  onSetEnabled: (id: string, enabled: boolean) => void;
}) {
  // The newest pick wins and is held for the *next* one, the rule the composer's
  // own pickers follow: a reader who has said which repository twice should not
  // have to say it a third time.
  const [project, setProject] = useState(projects[0]?.path ?? "");
  const [model, setModel] = useState<ModelId>("" as ModelId);
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [every, setEvery] = useState(String(DEFAULT_EVERY_MINUTES));

  const minutes = Number.parseInt(every, 10);
  const everyOk = Number.isFinite(minutes) && minutes >= MIN_EVERY_MINUTES;
  const chosen = project || projects[0]?.path || "";
  const ready = prompt.trim().length > 0 && !!chosen && everyOk;

  const submit = async () => {
    if (!ready) return;
    const created = await onCreate({
      name: name.trim(),
      prompt: prompt.trim(),
      projectPath: chosen,
      // An unset model is the backend's own default, which is the one the
      // composer would have used — see `DEFAULT_MODEL_FOR`'s note.
      model: model || ("" as ModelId),
      everyMinutes: minutes,
    });
    // Only the words are cleared. The repository, the model and the interval are
    // the shape of the thing being made, and a second automation usually has the
    // same shape as the first.
    if (created) {
      setPrompt("");
      setName("");
    }
  };

  return (
    <>
      {error && <p className="text-ui text-destructive">{error}</p>}

      {automations.length === 0 ? (
        <p className="text-ui text-muted-foreground">
          Nothing runs on its own yet. An automation is a prompt this app sends on a clock — in
          its own session and its own worktree, while Hyze Code is open.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {automations.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              onRemove={() => onRemove(automation.id)}
              onSetEnabled={(enabled) => onSetEnabled(automation.id, enabled)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-ui font-medium">New automation</p>

        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name — the first line of the prompt if you leave it empty"
          className="h-8 text-ui"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="What it should do, written the way you would type it to the agent"
          className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-ui outline-none placeholder:text-muted-foreground focus-visible:border-ring"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Picker
            label={projects.find((p) => p.path === chosen)?.name ?? "Pick a project"}
            empty={projects.length === 0 ? "No projects attached" : null}
            value={chosen}
            onPick={setProject}
            rows={projects.map((p) => ({ value: p.path, label: p.name }))}
          />
          <Picker
            label={model ? modelDisplayName(modelLabel(models, model)) : "The app's own default"}
            value={model}
            onPick={setModel}
            rows={models.map((m) => ({ value: m.id, label: modelDisplayName(m.label) }))}
          />
          <label className="flex items-center gap-1.5 text-ui text-muted-foreground">
            every
            <Input
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              inputMode="numeric"
              className="h-7 w-14 text-ui"
            />
            minutes
          </label>
          <Button variant="secondary" size="sm" onClick={() => void submit()} disabled={!ready}>
            Add
          </Button>
        </div>

        {!everyOk && (
          <p className="text-ui text-destructive">
            Every {MIN_EVERY_MINUTES} minutes at the least — each run opens a session and a
            worktree.
          </p>
        )}
      </div>
    </>
  );
}

function modelLabel(models: Model[], id: ModelId): string {
  return models.find((m) => m.id === id)?.label ?? id;
}

/// One row: what it is, where it runs, and the two things that can be done to it.
///
/// The switch is the whole row's control rather than a switch inside it — the
/// bargain `WorktreeToggle` makes — so a reader aiming at it cannot miss.
function AutomationRow({
  automation,
  onRemove,
  onSetEnabled,
}: {
  automation: Automation;
  onRemove: () => void;
  onSetEnabled: (enabled: boolean) => void;
}) {
  // In the row rather than in a dialog: the question is two words and the row is
  // already the thing being looked at, which is the bargain the model list
  // makes. Deleting is the one action here that cannot be taken back.
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui">{automation.name}</span>
        <span className="truncate text-ui text-muted-foreground">
          every {automation.everyMinutes} min · {automation.projectPath}
          {automation.lastRunAt ? " · has run" : " · never run"}
        </span>
      </div>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="xs" onClick={onRemove}>
            Delete
          </Button>
        </div>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn("shrink-0 text-muted-foreground/60 hover:text-muted-foreground")}
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${automation.name}`}
          >
            <Trash2 />
          </Button>
          <Switch
            checked={automation.enabled}
            onCheckedChange={onSetEnabled}
            aria-label={`Run ${automation.name}`}
          />
        </>
      )}
    </div>
  );
}

/// A menu that picks one of a list, with the current pick on its face.
///
/// A `radiogroup` rather than a menu of actions, which is what it is: the rows
/// are alternatives and exactly one is on, which is also why the selected one is
/// ticked rather than merely current.
function Picker({
  label,
  value,
  rows,
  empty,
  onPick,
}: {
  label: string;
  value: string;
  rows: { value: string; label: string }[];
  empty?: string | null;
  onPick: (value: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!!empty} className="max-w-56">
          <span className="truncate">{empty ?? label}</span>
          <ChevronDown className="ml-1 size-3.5 shrink-0 opacity-60" data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      {/* Scrollable, because a provider list is forty rows on a real machine —
          `ModelSelector` makes the same bargain for the same list. */}
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuRadioGroup value={value} onValueChange={onPick}>
          {rows.map((row) => (
            <DropdownMenuRadioItem key={row.value} value={row.value} className="text-ui">
              <span className="min-w-0 truncate">{row.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
