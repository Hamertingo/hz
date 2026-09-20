import { Server, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/spinner";
import { useMcpEditor } from "@/hooks/usePluginMcp";
import {
  MCP_TRANSPORTS,
  draftProblem,
  isRemote,
  joinCommand,
  linesToMap,
  mapToLines,
  splitCommand,
  transportLabel,
  type McpPick,
} from "@/lib/mcp";
import { cn } from "@/lib/utils";
import type { McpConfig } from "@/types/events";

/// The one field style, so every control in here is the same height and radius.
///
/// `h-7` is the row height the toolbar and the pull-request page's own controls
/// settle on, and a form of a few controls is where a stray `h-8` shows.
const FIELD =
  "h-7 w-full rounded-md border border-border bg-transparent px-2 text-ui outline-none focus-visible:border-accent placeholder:text-muted-foreground/50";

/// The form behind a row, and behind "Add server".
///
/// **It lives in the right pane, on the same terms the other pages' details do** —
/// a row opens it, and it edits the thing the row is. A dialog was the alternative
/// and it loses twice: the reader cannot see the list they are editing in, and the
/// whole window is spent on a form that has four fields.
///
/// **Nothing is written until Save.** The fields are local, the draft is sent whole,
/// and what comes back is what the agent actually stored — so a blank it normalises
/// away does not come back on the next read as a value the reader never typed.
///
/// **It tests on opening, and that is the question the pane is for.** Whether a
/// server works is not something a form can show by describing it — and the answer
/// arrives with the tool list attached, so the reader sees what they just wired up
/// before deciding whether to save a change to it.
export default function McpForm({
  pick,
  onClose,
  onSaved,
}: {
  pick: McpPick;
  onClose: () => void;
  /// A new server has no row to have been picked, so the pane moves onto the one
  /// that was just created. Without it a save would leave a blank form over a
  /// server the reader cannot see.
  onSaved: (name: string) => void;
}) {
  const editor = useMcpEditor(pick);

  const [nameText, setNameText] = useState("");
  const [transport, setTransport] = useState<string>(MCP_TRANSPORTS[0]);
  /// The command and its arguments in one field — see `splitCommand` for why it is
  /// safe to keep them together and take them apart again.
  const [commandText, setCommandText] = useState("");
  const [envText, setEnvText] = useState("");
  const [urlText, setUrlText] = useState("");
  const [headersText, setHeadersText] = useState("");
  /// The delete's own second press, held here rather than in a dialog: the row is
  /// one thing and a modal takes the window over for it.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Seeded from what was read, and again from what came back after a save — the
  // agent's answer is what is stored, and it is the one that normalises away a field
  // this form sent blank.
  useEffect(() => {
    const config = editor.draft;
    setNameText(editor.name);
    setTransport(config.transport);
    setCommandText(joinCommand(config.command, config.args));
    setEnvText(mapToLines(config.env));
    setUrlText(config.url ?? "");
    setHeadersText(mapToLines(config.headers));
  }, [editor.draft, editor.name]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [pick]);

  const remote = isRemote(transport);

  /// What would be written.
  ///
  /// **`timeoutMs` and `description` ride through from what was read**, and that is
  /// not tidiness: this form does not edit them, and an update rewrites the whole
  /// entry — so leaving them out would erase, on every save, the two fields a reader
  /// set with the agent's own tooling and this screen never shows.
  const config: McpConfig = useMemo(() => {
    const command = splitCommand(commandText);
    return {
      transport,
      command: remote ? null : command.command,
      args: remote ? null : command.args,
      env: remote ? null : linesToMap(envText),
      url: remote ? urlText : null,
      headers: remote ? linesToMap(headersText) : null,
      timeoutMs: editor.draft.timeoutMs,
      description: editor.draft.description,
    };
  }, [transport, remote, commandText, envText, urlText, headersText, editor.draft]);

  const problem = draftProblem(nameText, config);
  const canSave = !problem && !editor.saving && !editor.loading;

  const save = useCallback(async () => {
    if (problem) return;
    if (await editor.save(nameText.trim(), config)) {
      if (editor.isNew) onSaved(nameText.trim());
    }
  }, [config, editor, nameText, onSaved, problem]);

  const remove = useCallback(async () => {
    if (await editor.remove()) onClose();
  }, [editor, onClose]);

  if (!pick) {
    return (
      <Empty>
        Choose a server to edit it, or add one to write down a server the agent can
        reach.
      </Empty>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 truncate text-ui font-medium">
            {editor.isNew ? "New server" : editor.name || "Server"}
          </h3>
          {!editor.isNew && (
            // Stated rather than implied by the switch back on the list: this pane
            // can be read with the list scrolled away from the row it belongs to.
            <span
              className={cn(
                "shrink-0 rounded-full border border-border px-1.5 py-px text-ui",
                editor.enabled ? "text-muted-foreground" : "text-muted-foreground/70",
              )}
            >
              {editor.enabled ? "On" : "Off"}
            </span>
          )}
        </div>
        <p className="text-ui text-muted-foreground">
          {editor.isNew
            ? "A name the agent knows this server by, and how to start talking to it."
            : "Saved when you press Save. The switch on the list is what turns it on."}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <Field label="Name" hint="Letters, numbers, dots, underscores and hyphens.">
          <input
            value={nameText}
            // A name is the file's own key, so it is not editable once written:
            // renaming would be a delete and a create, which is not what this button
            // says it does.
            readOnly={!editor.isNew}
            spellCheck={false}
            placeholder="github"
            onChange={(e) => setNameText(e.currentTarget.value)}
            className={cn(FIELD, !editor.isNew && "text-muted-foreground")}
          />
        </Field>

        <Field label="Transport">
          <div className="flex flex-wrap gap-1">
            {MCP_TRANSPORTS.map((option) => (
              <Button
                key={option}
                type="button"
                variant={option === transport ? "secondary" : "outline"}
                size="sm"
                onClick={() => setTransport(option)}
                className="cursor-pointer"
              >
                {transportLabel(option)}
              </Button>
            ))}
          </div>
        </Field>

        {remote ? (
          <>
            <Field label="URL">
              <input
                value={urlText}
                spellCheck={false}
                placeholder="https://example.com/mcp"
                onChange={(e) => setUrlText(e.currentTarget.value)}
                className={FIELD}
              />
            </Field>
            <Field
              label="Headers"
              hint="One per line as name=value. A header holds a token, so this is a credential."
            >
              <textarea
                value={headersText}
                spellCheck={false}
                rows={3}
                onChange={(e) => setHeadersText(e.currentTarget.value)}
                className={cn(FIELD, "h-auto resize-y py-1 font-mono")}
              />
            </Field>
          </>
        ) : (
          <>
            <Field
              label="Command"
              hint="The command and its arguments, as you would type them in a shell."
            >
              <input
                value={commandText}
                spellCheck={false}
                placeholder="npx -y @modelcontextprotocol/server-github"
                onChange={(e) => setCommandText(e.currentTarget.value)}
                className={cn(FIELD, "font-mono")}
              />
            </Field>
            <Field
              label="Environment"
              hint="One per line as NAME=value. These hold credentials."
            >
              <textarea
                value={envText}
                spellCheck={false}
                rows={3}
                placeholder="GITHUB_TOKEN=…"
                onChange={(e) => setEnvText(e.currentTarget.value)}
                className={cn(FIELD, "h-auto resize-y py-1 font-mono")}
              />
            </Field>
          </>
        )}

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
          {editor.isNew ? "Add server" : "Save"}
        </Button>

        {/* Nothing about the connection is drawn here. The list says whether each
            server answers and what it offers — and it asks when the tab is opened,
            which is when a reader wants to know and not when they happen to be
            editing one field of it. Two answers to one question, on two surfaces,
            is the pair that drifts. */}

        {!editor.isNew && (
          <Button
            variant="ghost"
            size="sm"
            // Confirmed in the button rather than in a dialog, the bargain the branch
            // and model deletes make: the thing being removed is one row on the screen
            // behind this pane, and a modal takes the window over for it.
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
        <Server className="size-6 text-muted-foreground/40" strokeWidth={1.5} />
        <p className="text-balance text-ui text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}
