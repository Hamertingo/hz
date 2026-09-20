import { Bot, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import AgentAvatar from "@/components/plugins/AgentAvatar";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/spinner";
import { useAgentEditor } from "@/hooks/usePluginAgents";
import {
  PORTRAIT_COUNT,
  draftProblem,
  portraitMarker,
  portraitVariant,
  type AgentPick,
} from "@/lib/agents";
import { cn } from "@/lib/utils";
import type { AgentDraft } from "@/types/events";

/// The one field style, so every control in here is the same height and radius.
/// `h-7` is the row height the toolbar and the other panes' forms settle on.
const FIELD =
  "h-7 w-full rounded-md border border-border bg-transparent px-2 text-ui outline-none focus-visible:border-accent placeholder:text-muted-foreground/50 disabled:text-muted-foreground";

/// The pane behind an Agent row, and behind "Create agent".
///
/// **It lives in the right pane, on the same terms the other pages' details do** —
/// a row opens it and it edits the thing the row is. A dialog would take the
/// window for a form of four fields and hide the list being edited.
///
/// **Nothing is written until Save.** The fields are local, the draft is sent
/// whole, and what comes back is what the agent actually stored — so a blank it
/// normalises away does not return on the next read as a value nobody typed.
///
/// **The name is the address, not a field.** A written Agent is keyed by its
/// name, and the store's update has no rename: changing it would be a delete and
/// a create, which is not what a button saying Save does. So it is read-only once
/// written and the sentence under it says why.
export default function AgentForm({
  pick,
  onClose,
  onSaved,
  onChat,
}: {
  pick: AgentPick;
  onClose: () => void;
  /// A new Agent has no row to have been picked, so the pane moves onto the one
  /// just created instead of staying on a blank form.
  onSaved: (name: string) => void;
  /// Hands the Agent to the composer: a new session, with the draft addressed to
  /// this agent. See `App` for why it is a prompt and not a session setting.
  onChat: (name: string) => void;
}) {
  const editor = useAgentEditor(pick);

  const [nameText, setNameText] = useState("");
  const [displayNameText, setDisplayNameText] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [promptText, setPromptText] = useState("");
  const [portrait, setPortrait] = useState<number | null>(null);
  /// The delete's own second press, held here rather than in a dialog: the row is
  /// one thing and a modal takes the window over for it.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Seeded from what was read, and again from what came back after a save — the
  // agent's answer is what is stored, and it is the one that normalises a field
  // this form sent blank.
  useEffect(() => {
    const agent = editor.detail?.agent;
    setNameText(editor.name ?? "");
    setDisplayNameText(agent?.displayName ?? "");
    setDescriptionText(agent?.description ?? "");
    setPromptText(editor.detail?.systemPrompt ?? "");
    setPortrait(portraitVariant(agent?.avatar));
  }, [editor.detail, editor.name]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [pick]);

  const problem = editor.isNew ? draftProblem(nameText) : null;
  const canSave = !problem && !editor.saving && !editor.loading;

  /// What would be written.
  ///
  /// `persona` is deliberately absent: this form does not edit it, and an update
  /// leaves an absent field alone — so a persona set with the agent's own tooling
  /// survives a save made here.
  const draft = useCallback((): AgentDraft => {
    return {
      name: editor.isNew ? nameText.trim() || null : null,
      displayName: displayNameText.trim() || null,
      description: descriptionText.trim() ? descriptionText : null,
      avatar: portrait !== null ? portraitMarker(portrait) : null,
      // Sent even when empty: clearing a prompt is something a reader may mean,
      // where clearing a *name* is not — and the Rust side drops a blank name for
      // exactly that reason.
      systemPrompt: promptText,
      persona: null,
      // The Form never chooses one. On a creation the backend names the machine's
      // own default, which is what keeps the Agent saveable at all; on a rewrite
      // the field is ignored, because a model is not an identity field and the
      // store has no route to move one.
      model: null,
    };
  }, [editor.isNew, nameText, displayNameText, descriptionText, portrait, promptText]);

  const save = useCallback(async () => {
    if (problem) return;
    const address = editor.isNew ? null : editor.name;
    if (await editor.save(draft(), address)) {
      if (editor.isNew) onSaved(nameText.trim());
    }
  }, [draft, editor, nameText, onSaved, problem]);

  const remove = useCallback(async () => {
    if (await editor.remove()) onClose();
  }, [editor, onClose]);

  if (!pick) {
    return (
      <Empty>
        Choose an agent to edit it, or create one. An agent is who a delegated task
        runs as — its prompt is what that work is told to be.
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <AgentAvatar
          agent={{
            name: nameText || "agent",
            displayName: displayNameText || nameText || "A",
            avatar: portrait !== null ? portraitMarker(portrait) : null,
          }}
          size={40}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="min-w-0 truncate text-ui font-medium">
            {editor.isNew ? "New agent" : editor.detail?.agent.displayName || editor.name || "Agent"}
          </h3>
          <p className="text-balance text-ui text-muted-foreground">
            {editor.isNew
              ? "A name the agent knows it by, and the prompt every delegated task under it is handed."
              : "Saved when you press Save. The list on the left is the roster."}
          </p>
        </div>
        {editor.detail?.agent.builtin && (
          // Stated rather than implied by the group it sits in: this pane can be
          // read with the list scrolled away from the row it belongs to.
          <span className="ml-auto shrink-0 rounded-full border border-border px-1.5 py-px text-ui text-muted-foreground">
            Built-in
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <Field
          label="Portrait"
          hint="How the agent is drawn in the list. Nothing about how it works."
        >
          <div className="flex flex-wrap items-center gap-1">
            {Array.from({ length: PORTRAIT_COUNT }, (_, variant) => (
              <button
                key={variant}
                type="button"
                aria-label={`Portrait ${variant + 1}`}
                aria-pressed={portrait === variant}
                onClick={() => setPortrait(variant)}
                className={cn(
                  "cursor-pointer rounded-lg p-0.5 transition-colors",
                  portrait === variant ? "ring-2 ring-accent" : "hover:bg-sidebar-accent/60",
                )}
              >
                <AgentAvatar
                  agent={{
                    name: nameText || "agent",
                    displayName: displayNameText || nameText || "A",
                    avatar: portraitMarker(variant),
                  }}
                  size={26}
                />
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Name"
          hint={
            editor.isNew
              ? "Letters, numbers, dots, underscores and hyphens. This is what a task names."
              : "Written down already — an agent is keyed by its name, so this one is not editable."
          }
        >
          <input
            value={nameText}
            readOnly={!editor.isNew}
            spellCheck={false}
            placeholder="notes-writer"
            onChange={(e) => setNameText(e.currentTarget.value)}
            className={cn(FIELD, "font-mono")}
          />
        </Field>

        <Field label="Label" hint="What the row is called on screen. Defaults to the name.">
          <input
            value={displayNameText}
            spellCheck={false}
            placeholder="Notes writer"
            onChange={(e) => setDisplayNameText(e.currentTarget.value)}
            className={FIELD}
          />
        </Field>

        <Field label="What it is for" hint="One sentence, drawn under the row.">
          <input
            value={descriptionText}
            spellCheck={false}
            placeholder="Writes and tidies the changelog."
            onChange={(e) => setDescriptionText(e.currentTarget.value)}
            className={FIELD}
          />
        </Field>

        <Field
          label="System prompt"
          hint="What every task delegated to this agent is told to be. The task itself is sent separately."
        >
          <textarea
            value={promptText}
            spellCheck={false}
            rows={10}
            placeholder="You write release notes. Read the merged commits and…"
            onChange={(e) => setPromptText(e.currentTarget.value)}
            className={cn(FIELD, "h-auto resize-y py-1.5 leading-relaxed")}
          />
        </Field>

        {problem && (
          <p className="text-ui text-muted-foreground">
            {problem} Save is off until that is filled in.
          </p>
        )}

        {editor.error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0">{editor.error}</span>
          </div>
        )}
      </div>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void save()}
          disabled={!canSave}
          className="cursor-pointer"
        >
          {editor.saving ? <Spinner className="size-3.5" /> : null}
          {editor.isNew ? "Create agent" : "Save"}
        </Button>

        {/* Handing work to it is the reason to write one down, so it sits beside
            Save rather than behind a menu — and it is off until the Agent exists,
            because there is nothing to address before then. */}
        <Button
          variant="outline"
          size="sm"
          disabled={editor.isNew || editor.saving}
          onClick={() => editor.name && onChat(editor.name)}
          className="cursor-pointer"
        >
          Chat with it
        </Button>

        {!editor.isNew && (
          <Button
            variant="ghost"
            size="sm"
            // Confirmed in the button rather than in a dialog, the bargain the
            // other panes' deletes make: the thing being removed is one row on the
            // screen behind this pane.
            onClick={() => (confirmingDelete ? void remove() : setConfirmingDelete(true))}
            onBlur={() => setConfirmingDelete(false)}
            disabled={editor.saving}
            className={cn(
              "ml-auto cursor-pointer",
              confirmingDelete ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {confirmingDelete ? "Delete for good?" : "Delete"}
          </Button>
        )}
      </footer>
    </div>
  );
}

/// One labelled control, with the line under it that says what the field is for.
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-ui text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground/70">{hint}</span>}
    </label>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-72 flex-col items-center gap-2.5 text-center">
        <Bot className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
        <p className="text-balance text-ui text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
