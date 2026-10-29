import { ChevronDown, Dices, Image as ImageIcon, X } from "lucide-react";
import { useRef, useState } from "react";

import EngineMark from "@/components/EngineMark";
import Dither from "@/components/Dither";
import Face from "@/components/Face";
import { Group, Row, UnderlineTabs } from "@/components/kit/kit";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useModels } from "@/components/profile/ConfigMenus";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { ACCS, EYES, MOUTHS, PATS, SHAPE_NAMES, lookFor, shapeOfKind, type Look, type Pose, type ShapeName } from "@/lib/face";
import { agentIdFor, DEFAULT_LOOK, TEMPLATES, type AgentTemplate } from "@/lib/agentDraft";
import { CLI } from "@/lib/cli";
import { MASCOT_COLORS, type MascotKind } from "@/lib/mascots";
import { honouredModes, MODE_COPY } from "@/lib/permission";
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

const HARNESS_OF: Record<AgentTemplate["cli"], Harness> = {
  Claude: "claude-acp",
  Codex: "codex-acp",
  OpenCode: "opencode",
};

/// The mockup's order for the stances, narrowest first. A CLI that does not
/// honour one leaves it out rather than offering a promise it cannot keep.
const STANCE_ORDER: ApprovalPolicy[] = ["plan", "manual", "auto", "bypassPermissions"];

const POSES: readonly [Pose, string][] = [
  ["sleep", "Resting"],
  ["idle", "Idle"],
  ["work", "Working"],
  ["vm", "Its computer"],
  ["mac", "Your Mac"],
];

type Part = "body" | "eyes" | "mouth" | "acc" | "pat" | "color";

const PARTS: { value: Part; label: string }[] = [
  { value: "body", label: "Body" },
  { value: "eyes", label: "Eyes" },
  { value: "mouth", label: "Mouth" },
  { value: "acc", label: "Extra" },
  { value: "pat", label: "Pattern" },
  { value: "color", label: "Colour" },
];

const OPTIONS: Record<Exclude<Part, "body" | "color">, readonly string[]> = {
  eyes: EYES,
  mouth: MOUTHS,
  acc: ACCS,
  pat: PATS,
};

const pick = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

const FIELD =
  "w-full rounded-(--r1) bg-s1 px-[11px] text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line2)] outline-none transition-[box-shadow,background] placeholder:text-ink4 hover:shadow-[inset_0_0_0_1px_var(--line3)] focus:bg-s2 focus:shadow-[inset_0_0_0_1px_var(--line3)] h-[34px]";

/// The new-agent card and the agent's settings, which are the same card: a pixel field behind a face built from
/// parts, the name, and a look picker. A new agent also takes a role, an engine, a stance and instructions.
/// With `editing` set (an agent id) only the look and the name are shown, since the CLI, folder and instructions
/// belong to a conversation already under way.
export default function NewAgentDialog({
  open,
  editing,
  presetName,
  projects,
  defaultProjectPath,
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
  /// Kept for the caller; the card no longer has a folder row, so it is not called here.
  onPickFolder?: () => Promise<string | null>;
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

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [shape, setShape] = useState<ShapeName | string>(DEFAULT_LOOK.shape);
  const [look, setLook] = useState<Required<Look>>(DEFAULT_LOOK.look);
  const [color, setColor] = useState<string>(DEFAULT_LOOK.color);
  const [photo, setPhoto] = useState<string | null>(null);
  const [pose, setPose] = useState<Pose>("idle");
  const [tab, setTab] = useState<"make" | "ready">("make");
  const [part, setPart] = useState<Part>("body");
  const [instructions, setInstructions] = useState("");
  const [pickedHarness, setPickedHarness] = useState<Harness | null>(null);
  const [pickedPerm, setPickedPerm] = useState<ApprovalPolicy>(defaultPerm);
  const [nameMissing, setNameMissing] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset during render, not in an effect, so the first frame of a reopened
  // card already shows the fresh draft rather than the last one for a beat.
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      const base = editingAgent;
      setName(base?.name ?? presetName ?? "");
      setRole(base?.role ?? "");
      setShape(base ? (base.shape ?? shapeOfKind(base.kind)) : DEFAULT_LOOK.shape);
      setLook(base ? { ...lookFor(base.id), ...(base.look ?? {}) } : DEFAULT_LOOK.look);
      setColor(base?.color ?? DEFAULT_LOOK.color);
      setPhoto(base?.photo ?? null);
      setPose("idle");
      setTab("make");
      setPart("body");
      setInstructions(base?.instructions ?? "");
      setPickedHarness(null);
      setPickedPerm(base?.permission ?? defaultPerm);
      setNameMissing(false);
    }
  }

  // The first CLI that is actually on this machine, so the default is not an
  // agent that cannot start.
  const firstReady = AGENT_HARNESSES.find((h) => agents?.find((a) => a.harness === h)?.available);
  const preferred = AGENT_HARNESSES.find(
    (h) => h === defaults?.harness && agents?.find((a) => a.harness === h)?.available,
  );
  const harness: Harness = editingAgent?.harness ?? pickedHarness ?? preferred ?? firstReady ?? "claude-acp";
  const dir = editingAgent?.projectPath ?? defaults?.folder ?? defaultProjectPath ?? projects[0]?.path ?? null;
  const stances = STANCE_ORDER.filter((m) => honouredModes(harness).includes(m));
  const perm: ApprovalPolicy = stances.includes(pickedPerm) ? pickedPerm : "auto";
  const models = useModels(harness);
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const [pickedEffort, setPickedEffort] = useState<string | null>(null);
  const modelId = models?.some((m) => m.id === pickedModel) ? pickedModel : null;
  const efforts = models?.find((m) => m.id === modelId)?.efforts ?? [];
  const effort = pickedEffort && efforts.includes(pickedEffort as never) ? pickedEffort : null;

  const applyTemplate = (t: AgentTemplate) => {
    setName(t.name);
    setRole(t.role);
    setShape(t.shape);
    setLook({ ...t.look });
    setColor(t.color);
    setPhoto(null);
    setPickedHarness(HARNESS_OF[t.cli]);
    setPickedPerm(t.permission);
    setInstructions(t.instructions);
    setNameMissing(false);
    setTab("make");
  };

  const shuffle = () => {
    setShape(pick(SHAPE_NAMES));
    setColor(pick(MASCOT_COLORS));
    setLook({ eyes: pick(EYES), mouth: pick(MOUTHS), acc: pick(ACCS), pat: pick(PATS) });
    setPhoto(null);
  };

  const choose = (p: Part, v: string) => {
    if (p === "body") setShape(v);
    else if (p === "color") setColor(v);
    else setLook((l) => ({ ...l, [p]: v }));
    setPhoto(null);
  };

  const readPhoto = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPhoto(reader.result);
    };
    reader.readAsDataURL(file);
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
        kind: editingAgent.kind,
        color,
        shape,
        look,
        photo,
      };
      onSubmit(draft, editingAgent.id);
      return;
    }

    if (dir === null) return;

    const id = agentIdFor(trimmed, new Set(roster.agents.map((a) => a.id)));
    onSubmit(
      {
        name: trimmed,
        role: role.trim(),
        kind: DEFAULT_LOOK.kind as MascotKind,
        color,
        shape,
        look,
        photo,
        harness,
        projectPath: dir,
        modelId,
        effort,
        permission: perm,
        workspaceId: workspace?.id ?? null,
        instructions: instructions.trim(),
      },
      id,
    );
  };

  const liveName = name.trim() || (editingAgent ? editingAgent.name : "New agent");
  const liveRole = role.trim();
  const previewId = editingAgent?.id ?? "new-agent";
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
        className="flex max-h-[calc(100vh-48px)] w-[min(860px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden rounded-(--r4) border-0 bg-(--sheet) p-0"
      >
        <div className="flex shrink-0 items-center gap-3 px-5 pt-[18px] pb-2">
          <DialogTitle className="min-w-0 flex-1 text-[16px] leading-[1.3] font-semibold tracking-[-0.015em]">
            {isEdit ? "Change look" : "New agent"}
          </DialogTitle>
          <DialogDescription className="sr-only">{liveName}</DialogDescription>
          {!isEdit && (
            <UnderlineTabs
              className="border-0 px-0"
              size="sm"
              value={tab}
              onChange={setTab}
              options={[
                { value: "make", label: "Make one" },
                { value: "ready", label: "Ready-made" },
              ]}
            />
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-7 cursor-pointer place-items-center rounded-lg text-ink3 transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        {tab === "ready" && !isEdit ? (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-y-auto px-5 pt-1.5 pb-5">
            {TEMPLATES.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => applyTemplate(t)}
                className="flex cursor-pointer items-center gap-3 rounded-(--r3) p-3 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s2"
              >
                <Face id={`tpl-${t.name}`} color={t.color} shape={t.shape} look={t.look} size={46} />
                <span className="min-w-0">
                  <b className="block text-[13px] font-semibold">{t.name}</b>
                  <span className="block text-[12px] leading-snug text-ink3">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-5 overflow-y-auto px-5 pt-1 pb-2 max-[720px]:grid-cols-1">
            <div>
              <div className="relative flex min-h-[400px] flex-col items-center justify-end overflow-hidden rounded-(--r4) bg-s1 px-3.5 pb-6 text-center shadow-[inset_0_0_0_1px_var(--line)]">
                <Dither color={color} seed="new-agent" cols={36} rows={60} light={1} className="opacity-80" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[48%] bg-linear-to-b from-transparent to-(--sheet)/90" />
                <div className="relative z-[2] mt-auto flex flex-col items-center gap-[3px]">
                  <span className="mb-3.5 grid drop-shadow-[0_12px_20px_rgba(0,0,0,0.35)]">
                    <Face id={previewId} color={color} shape={shape} look={look} photo={photo} pose={pose} size={128} />
                  </span>
                  <b className="max-w-full truncate text-[16px] font-semibold tracking-[-0.015em]">{liveName}</b>
                  <span className="max-w-full truncate text-[12.5px] text-ink3">{liveRole || "No role yet"}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap justify-center gap-0.5">
                {POSES.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={pose === k}
                    onClick={() => setPose(k)}
                    className={cn(
                      "h-6 cursor-pointer rounded-full px-[9px] text-[11.5px] font-medium transition-colors",
                      pose === k ? "bg-s3 text-ink" : "text-ink3 hover:text-ink",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-w-0">
              <input
                ref={nameRef}
                aria-label="Name"
                value={name}
                maxLength={18}
                placeholder="Agent name"
                aria-invalid={nameMissing}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameMissing(false);
                }}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className={cn(FIELD, "h-10 text-[15px] font-medium", nameMissing && "shadow-[inset_0_0_0_1px_var(--red)]")}
              />
              <div className="mt-3.5 mb-2.5 flex items-center gap-0.5 border-b border-line">
                <UnderlineTabs className="gap-3.5 border-0 px-0" size="sm" value={part} onChange={setPart} options={PARTS.map((p) => ({ value: p.value, label: p.label }))} />
                <span className="flex-1" />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    readPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <Button variant="ghost" size="sm" onClick={shuffle}>
                  <Dices /> Shuffle
                </Button>
                {photo ? (
                  <Button variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                    Remove photo
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
                    <ImageIcon /> Photo
                  </Button>
                )}
              </div>

              <div className={cn("min-h-[108px] transition-opacity", photo && "opacity-40")}>
                {part === "color" ? (
                  <div className="flex flex-wrap gap-[9px]">
                    {MASCOT_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Colour ${c}`}
                        aria-pressed={color === c}
                        onClick={() => choose("color", c)}
                        style={{ backgroundColor: c }}
                        className={cn(
                          "size-5 cursor-pointer rounded-full transition-transform hover:scale-[1.15]",
                          color === c && "shadow-[0_0_0_2px_var(--sheet),0_0_0_3.5px_var(--ink)]",
                        )}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-6 gap-1">
                    {(part === "body" ? SHAPE_NAMES : OPTIONS[part]).map((v) => {
                      const current = part === "body" ? shape === v : look[part] === v;
                      const over = part === "body" ? { shape: v } : { look: { ...look, [part]: v } };
                      return (
                        <button
                          key={v}
                          type="button"
                          title={v}
                          aria-label={`${part} ${v}`}
                          aria-pressed={current}
                          onClick={() => choose(part, v)}
                          className={cn("grid h-[54px] cursor-pointer place-items-center rounded-(--r2) transition-colors hover:bg-s2", current && "bg-s3")}
                        >
                          <Face id={`opt-${part}-${v}`} color={color} shape={over.shape ?? shape} look={over.look ?? look} size={40} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {!isEdit && (
                <Group className="mt-4">
                  <Row
                    title="Role"
                    right={
                      <input
                        value={role}
                        aria-label="Role"
                        placeholder="Optional"
                        onChange={(e) => setRole(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && submit()}
                        className="w-[190px] rounded-md bg-transparent px-1.5 py-[3px] text-right text-[12.5px] text-ink outline-none transition-colors placeholder:text-ink4 hover:bg-s3 focus:bg-s3"
                      />
                    }
                  />
                  <Row
                    title="Brain"
                    right={
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="inline-flex cursor-pointer items-center gap-[5px] text-[12.5px] text-ink2 transition-colors hover:text-ink">
                            <EngineMark harness={harness} size={14} />
                            {CLI[harness]?.label ?? LABEL[harness]}
                            <ChevronDown className="size-3.5 text-ink4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[270px]">
                          <DropdownMenuRadioGroup value={harness} onValueChange={(v) => setPickedHarness(v as Harness)}>
                            {AGENT_HARNESSES.map((h) => {
                              const ready = agents?.find((a) => a.harness === h)?.available === true;
                              return (
                                <DropdownMenuRadioItem key={h} value={h}>
                                  <EngineMark harness={h} size={16} />
                                  {CLI[h]?.label ?? LABEL[h]}
                                  <span className="ml-auto whitespace-nowrap pl-4 text-[11.5px] text-ink4">
                                    {agents === null ? "Checking…" : ready ? "Signed in" : "Not ready"}
                                  </span>
                                </DropdownMenuRadioItem>
                              );
                            })}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                  />
                  <Row
                    title="Model"
                    right={
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={!models || models.length === 0}>
                          <button type="button" className="inline-flex cursor-pointer items-center gap-[5px] text-[12.5px] text-ink2 transition-colors hover:text-ink disabled:cursor-default disabled:text-ink4">
                            {models?.find((m) => m.id === modelId)?.label ?? "Default"}
                            <ChevronDown className="size-3.5 text-ink4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="max-h-72 min-w-[220px] overflow-y-auto">
                          <DropdownMenuRadioGroup value={modelId ?? ""} onValueChange={(v) => setPickedModel(v || null)}>
                            <DropdownMenuRadioItem value="">Default</DropdownMenuRadioItem>
                            {(models ?? []).map((m) => (
                              <DropdownMenuRadioItem key={m.id} value={m.id}>
                                {m.label}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                  />
                  {efforts.length > 0 && (
                    <Row
                      title="Effort"
                      right={
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="inline-flex cursor-pointer items-center gap-[5px] text-[12.5px] text-ink2 transition-colors hover:text-ink">
                              {effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : "Default"}
                              <ChevronDown className="size-3.5 text-ink4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[180px]">
                            <DropdownMenuRadioGroup value={effort ?? ""} onValueChange={(v) => setPickedEffort(v || null)}>
                              <DropdownMenuRadioItem value="">Default</DropdownMenuRadioItem>
                              {efforts.map((e) => (
                                <DropdownMenuRadioItem key={e} value={e}>
                                  {e.charAt(0).toUpperCase() + e.slice(1)}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      }
                    />
                  )}
                  <Row
                    title="Permission"
                    right={
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="inline-flex cursor-pointer items-center gap-[5px] text-[12.5px] text-ink2 transition-colors hover:text-ink">
                            {MODE_COPY[perm].label}
                            <ChevronDown className="size-3.5 text-ink4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[300px]">
                          <DropdownMenuRadioGroup value={perm} onValueChange={(v) => setPickedPerm(v as ApprovalPolicy)}>
                            {stances.map((m) => (
                              <DropdownMenuRadioItem key={m} value={m}>
                                {MODE_COPY[m].label}
                                <span className="ml-auto whitespace-nowrap pl-4 text-[11.5px] text-ink4">{MODE_COPY[m].hint}</span>
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    }
                  />
                  <div className="px-3 py-[9px]">
                    <b className="mb-1.5 block text-[13px] font-medium">Instructions</b>
                    <textarea
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      rows={3}
                      placeholder="The goal, how to work, what needs your approval"
                      aria-label="Instructions"
                      className={cn(FIELD, "h-auto resize-none py-[9px] leading-[1.55]")}
                    />
                  </div>
                </Group>
              )}
            </div>
          </div>
        )}

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 pt-3 pb-4">
          {dir === null && !isEdit && (
            <span className="mr-auto text-[12px] text-red">Choose a folder for it in Settings first.</span>
          )}
          <Button variant="ghost" className="h-[30px]" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="solid" className={cn("h-[30px]", !name.trim() && !isEdit && "opacity-35")} onClick={submit}>
            {isEdit ? "Save" : "Create agent"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
