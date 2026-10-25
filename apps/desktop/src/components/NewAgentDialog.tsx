import { Check, ChevronDown, Dices, Folder, Sparkles } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import AgentIcon from "@/components/AgentIcon";
import AgentTile from "@/components/AgentTile";
import Dither from "@/components/Dither";
import Mascot from "@/components/Mascot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { basename } from "@/lib/format";
import { agentIdFor, DEFAULT_LOOK, TEMPLATE_NAMES, TEMPLATES, type TemplateName } from "@/lib/agentDraft";
import { honouredModes, MODE_COPY } from "@/lib/permission";
import { MASCOT_COLORS, MASCOT_KINDS, type MascotKind } from "@/lib/mascots";
import { AGENT_HARNESSES, useRoster, type RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { ApprovalPolicy, Harness, Project } from "@/types/events";

export type AgentDraft = Omit<RosterAgent, "id" | "sessionId">;

const LABEL: Record<Harness, string> = {
  "claude-acp": "Claude",
  "codex-acp": "Codex",
  opencode: "OpenCode",
  mcode: "mcode",
};

/// The mockup's order for the stances, narrowest first. A CLI that does not
/// honour one leaves it out rather than offering a promise it cannot keep.
const STANCE_ORDER: ApprovalPolicy[] = ["plan", "manual", "auto", "bypassPermissions"];

const FIELD =
  "w-full rounded-(--r2) bg-s2 px-3 py-[9px] text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow placeholder:text-ink4 focus:shadow-[inset_0_0_0_1px_var(--line3)]";

/// The new-agent card and the agent's settings, which are the same card: a
/// dithered banner with the face on its edge, then the fields. With `editing`
/// set (an agent id) only the look and the name are shown, since the CLI, folder
/// and instructions belong to a conversation already under way.
export default function NewAgentDialog({
  open,
  editing,
  presetName,
  projects,
  defaultProjectPath,
  onPickFolder,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /// The id of the agent being edited, or null to make a new one.
  editing: string | null;
  /// A name to start the form with, from Jump to's "Create an agent called …".
  presetName?: string;
  projects: Project[];
  /// The folder the composer had selected, offered first so a reader with one
  /// project never has to choose.
  defaultProjectPath: string | null;
  /// Opens the folder picker and answers the path, or null if cancelled.
  onPickFolder: () => Promise<string | null>;
  onClose: () => void;
  /// `id` is the new agent's id, or the edited agent's own.
  onSubmit: (draft: AgentDraft, id: string) => void;
}) {
  const roster = useRoster();
  const workspace = useWorkspaces().active;
  const agents = useAgentAvailability();
  const editingAgent = editing ? (roster.agents.find((a) => a.id === editing) ?? null) : null;
  const isEdit = editingAgent !== null;
  // Settings → Agent defaults: what a new agent in this workspace starts with.
  const defaults = workspace?.defaults;
  const defaultPerm = STANCE_ORDER.find((m) => m === defaults?.permission) ?? "auto";

  // Each open starts from the defaults, so a reader who opens the card a second
  // time does not find the last draft. Fields that depend on the environment
  // (the CLI, the folder) stay unset until the reader picks, and read the live
  // value until then.
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [kind, setKind] = useState<MascotKind>(DEFAULT_LOOK.kind);
  const [color, setColor] = useState<string>(DEFAULT_LOOK.color);
  const [template, setTemplate] = useState<TemplateName>("Blank");
  const [instructions, setInstructions] = useState("");
  const [pickedHarness, setPickedHarness] = useState<Harness | null>(null);
  const [pickedDir, setPickedDir] = useState<string | null>(null);
  const [pickedPerm, setPickedPerm] = useState<ApprovalPolicy>(defaultPerm);
  const [nameMissing, setNameMissing] = useState(false);
  const [folderMissing, setFolderMissing] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset during render, not in an effect, so the first frame of a reopened
  // card already shows the fresh draft rather than the last one for a beat.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(editingAgent?.name ?? presetName ?? "");
      setRole(editingAgent?.role ?? "");
      setKind(editingAgent?.kind ?? DEFAULT_LOOK.kind);
      setColor(editingAgent?.color ?? DEFAULT_LOOK.color);
      setTemplate("Blank");
      setInstructions(editingAgent?.instructions ?? "");
      setPickedHarness(null);
      setPickedDir(null);
      setPickedPerm(editingAgent?.permission ?? defaultPerm);
      setNameMissing(false);
      setFolderMissing(false);
    }
  }

  // The first CLI that is actually on this machine, so the default is not an
  // agent that cannot start.
  const firstReady = AGENT_HARNESSES.find((h) => agents?.find((a) => a.harness === h)?.available);
  const preferred = AGENT_HARNESSES.find(
    (h) => h === defaults?.harness && agents?.find((a) => a.harness === h)?.available,
  );
  const harness: Harness = editingAgent?.harness ?? pickedHarness ?? preferred ?? firstReady ?? "claude-acp";
  const chosen = agents?.find((a) => a.harness === harness);
  const dir =
    editingAgent?.projectPath ?? pickedDir ?? defaults?.folder ?? defaultProjectPath ?? projects[0]?.path ?? null;
  const stances = STANCE_ORDER.filter((m) => honouredModes(harness).includes(m));
  const perm: ApprovalPolicy = stances.includes(pickedPerm) ? pickedPerm : "auto";

  const applyTemplate = (key: TemplateName) => {
    const t = TEMPLATES[key];
    setTemplate(key);
    if (t.role !== undefined) setRole(t.role);
    if (t.kind !== undefined) setKind(t.kind);
    if (t.color !== undefined) setColor(t.color);
    if (t.instructions !== undefined) setInstructions(t.instructions);
  };

  const shuffle = () => {
    setKind(MASCOT_KINDS[Math.floor(Math.random() * MASCOT_KINDS.length)]);
    setColor(MASCOT_COLORS[Math.floor(Math.random() * MASCOT_COLORS.length)]);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameMissing(true);
      nameRef.current?.focus();
      return;
    }

    if (editingAgent) {
      // Only the look and the name change. The rest of the agent goes back as it was.
      const draft: AgentDraft = {
        ...editingAgent,
        name: trimmed,
        role: role.trim(),
        kind,
        color,
      };
      onSubmit(draft, editingAgent.id);
      return;
    }

    if (dir === null) {
      setFolderMissing(true);
      return;
    }

    const id = agentIdFor(trimmed, new Set(roster.agents.map((a) => a.id)));
    onSubmit(
      {
        name: trimmed,
        role: role.trim(),
        kind,
        color,
        harness,
        projectPath: dir,
        modelId: null,
        effort: null,
        permission: perm,
        workspaceId: workspace?.id ?? null,
        instructions: instructions.trim(),
      },
      id,
    );
  };

  const liveName = name.trim() || (editingAgent ? editingAgent.name : "New agent");
  const liveRole =
    role.trim() ||
    (editingAgent ? "Its chat, memory and folder stay as they are" : `Joins ${workspace?.name ?? "your workspace"}`);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showClose={false}
        // Focus the name without scrolling the body: the first tabbable control
        // is a template, and Radix would scroll the card down to it on open.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameRef.current?.focus({ preventScroll: true });
        }}
        className="flex max-h-[88vh] w-[620px] max-w-[620px] flex-col gap-0 overflow-hidden rounded-[20px] p-0"
      >
        <div className="relative h-28 shrink-0">
          <Dither color={color} seed={`${kind}${color}`} cols={150} rows={28} light={0.8} />
          <button
            type="button"
            onClick={shuffle}
            className="absolute top-3.5 right-3.5 flex h-7 cursor-pointer items-center gap-1.5 rounded-full bg-black/40 px-2.5 text-[12px] font-medium text-white backdrop-blur-md"
          >
            <Dices className="size-[13px]" />
            Shuffle look
          </button>
          <div className="absolute bottom-[-44px] left-6 z-10 rounded-[28px] bg-pop p-[5px]">
            <AgentTile id={`draft${kind}${color}`} kind={kind} color={color} size={88} />
          </div>
        </div>

        <div className="flex shrink-0 items-start gap-3.5 pt-3 pr-6 pb-0 pl-32">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[19px] leading-[1.2] font-semibold tracking-[-0.02em]">
              {liveName}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-[12.5px] text-ink3">{liveRole}</DialogDescription>
          </div>
          {!isEdit && (
            <span className="mt-1 ml-auto inline-flex items-center gap-1.5 rounded-full bg-s2 px-2.5 py-[3px] text-[11.5px] whitespace-nowrap text-ink3">
              <AgentIcon harness={harness} className="size-[13px]" />
              {LABEL[harness]} · {MODE_COPY[perm].label}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto px-6 pt-3.5 pb-2">
          {!isEdit && (
            <Section title="Start from" hint="Fills the role, look and instructions">
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATE_NAMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={t === template}
                    onClick={() => applyTemplate(t)}
                    className={cn(
                      "h-[26px] cursor-pointer rounded-full px-[11px] text-[12px] font-medium transition-colors",
                      t === template ? "bg-ink text-background" : "bg-s2 text-ink2 hover:bg-s3 hover:text-ink",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title="Who it is">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <input
                  ref={nameRef}
                  aria-label="Name"
                  value={name}
                  maxLength={18}
                  placeholder="Atlas"
                  aria-invalid={nameMissing}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameMissing(false);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className={cn(FIELD, nameMissing && "shadow-[inset_0_0_0_1px_var(--red)]")}
                />
              </Field>
              <Field label="What it does">
                <input
                  value={role}
                  aria-label="What it does"
                  placeholder="Strategy, pricing, numbers"
                  onChange={(e) => setRole(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className={FIELD}
                />
              </Field>
            </div>
            <div className="mt-3.5 flex items-center gap-3.5">
              <div className="flex gap-0.5">
                {MASCOT_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    title={k}
                    aria-label={`Face ${k}`}
                    aria-pressed={k === kind}
                    onClick={() => setKind(k)}
                    className={cn(
                      "grid size-9 cursor-pointer place-items-center rounded-(--r2) transition-colors hover:bg-hover",
                      k === kind && "bg-active shadow-[inset_0_0_0_1px_var(--line3)]",
                    )}
                  >
                    <Mascot kind={k} color={color} size={24} />
                  </button>
                ))}
              </div>
              <span aria-hidden className="h-[22px] w-px shrink-0 bg-line2" />
              <div className="flex items-center gap-[7px]">
                {MASCOT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Colour ${c}`}
                    aria-pressed={c === color}
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    className={cn(
                      "size-[18px] cursor-pointer rounded-full transition-transform hover:scale-110",
                      c === color && "shadow-[0_0_0_2px_var(--pop),0_0_0_4px_var(--ink)]",
                    )}
                  />
                ))}
              </div>
            </div>
          </Section>

          {!isEdit && (
            <Section title="Where it runs">
              <div className="grid grid-cols-3 gap-2">
                {AGENT_HARNESSES.map((h) => {
                  const on = h === harness;
                  const ready = agents?.find((a) => a.harness === h)?.available === true;
                  return (
                    <button
                      key={h}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPickedHarness(h)}
                      className={cn(
                        "cursor-pointer rounded-(--r3) bg-s1 px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s2",
                        on && "bg-s2 shadow-[inset_0_0_0_1.5px_var(--ink2)]",
                      )}
                    >
                      <div className="flex items-center gap-2 text-[13px] font-semibold">
                        <AgentIcon harness={h} className="size-[15px]" />
                        {LABEL[h]}
                        {on && (
                          <span className="ml-auto grid size-4 place-items-center rounded-full bg-ink">
                            <Check className="size-2.5 text-background" strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11.5px] text-ink3">
                        {agents === null ? "Checking…" : ready ? "Default model · signed in" : "Not ready"}
                      </div>
                    </button>
                  );
                })}
              </div>
              {chosen && !chosen.available && (
                <p className="mt-2.5 text-[12px] text-ink3">
                  {chosen.reason}
                  {chosen.installCommand && (
                    <>
                      {" "}
                      Install it with <code className="font-mono">{chosen.installCommand}</code>.
                    </>
                  )}
                </p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-3">
                <Field label="Works in">
                  <button
                    type="button"
                    onClick={() =>
                      void onPickFolder().then((p) => {
                        if (!p) return;
                        setPickedDir(p);
                        setFolderMissing(false);
                      })
                    }
                    title={dir ?? undefined}
                    className={cn(
                      FIELD,
                      "flex h-9 cursor-pointer items-center gap-2 text-left",
                      folderMissing && "shadow-[inset_0_0_0_1px_var(--red)]",
                    )}
                  >
                    <Folder className="size-3.5 shrink-0 text-ink3" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
                      {dir ? basename(dir) : "Choose a folder"}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 text-ink3" />
                  </button>
                </Field>
                <Field label="Can do">
                  <Segmented
                    label="Can do"
                    value={perm}
                    onChange={setPickedPerm}
                    options={stances.map((m) => ({ value: m, label: MODE_COPY[m].label }))}
                    className="flex w-full [&>button]:flex-1 [&>button]:justify-center"
                  />
                </Field>
              </div>
              <p className="mt-2 text-[12px] text-ink4">{MODE_COPY[perm].hint}.</p>
            </Section>
          )}

          {!isEdit && (
            <Section title="How it works" hint="Its instructions">
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="How it should think and answer. You can change this any time."
                aria-label="Instructions"
                className={cn(FIELD, "h-24 resize-none leading-[1.6]")}
              />
            </Section>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line px-6 py-3.5">
          <Button variant="ghost" className="h-[34px] px-3.5" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="solid" className="ml-auto h-[34px] px-3.5" onClick={submit}>
            {isEdit ? (
              "Save"
            ) : (
              <>
                <Sparkles className="size-3.5" />
                Create and say hello
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-line py-4 first:border-t-0 first:pt-1.5">
      <div className="mb-3 flex items-baseline gap-2.5">
        <b className="text-[13px] font-semibold">{title}</b>
        {hint && <span className="text-[12px] text-ink4">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/// A caption over a control. A div and not a label: a label forwards a click on
/// its caption to the first control inside it, which would pick the first stance.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="mb-2 text-[12px] font-medium text-ink2">{label}</span>
      {children}
    </div>
  );
}
