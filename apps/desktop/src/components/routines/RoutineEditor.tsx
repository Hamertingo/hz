import { Bell, BarChart3, Check, Copy, Eye, EyeOff, Globe, Hash, Inbox, Key, MessageSquare, MessageSquareReply, Moon, Plus, RefreshCw, Trash2, Zap, Clock, Webhook } from "lucide-react";
import { useState, type ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import { SourceMark } from "@/components/routines/Sentence";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  ALL_DAYS,
  DAY_LETTERS,
  SOURCES,
  TEMPLATES,
  hookUrl,
  newSecret,
  sentenceParts,
  type Channel,
} from "@/lib/routines";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { HookInfo, Routine, RoutineInput } from "@/types/events";

const TEMPLATE_ICON = { bell: Bell, usage: BarChart3, bolt: Zap, moon: Moon } as const;

const H = ({ children }: { children: ReactNode }) => (
  <h4 className="mt-5 mb-2 text-xs font-medium text-ink2 first:mt-0">{children}</h4>
);

/// The pill a pick in the editor is drawn as: lit when chosen.
function Pill({ on, onClick, children, mono }: { on: boolean; onClick: () => void; children: ReactNode; mono?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center rounded-full px-3 text-xs transition-colors",
        mono && "font-mono text-[11.5px]",
        on ? "bg-ink text-background" : "bg-s2 text-ink2 hover:bg-s3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function HookRow({ icon, children, actions }: { icon: ReactNode; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-2 rounded-(--r2) bg-s2 pr-1 pl-[11px] font-mono text-[11.5px] text-ink2 shadow-[inset_0_0_0_1px_var(--line)]">
      <span className="text-ink3 [&_svg]:size-3.5">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {actions}
    </div>
  );
}

/// The centered sheet that makes or changes a routine: templates, who, when
/// (a clock or a service), what, where the result goes, quiet, and the sentence
/// it adds up to, live on the right.
export default function RoutineEditor({
  seed,
  existing,
  agents,
  channels,
  hook,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  seed: RoutineInput;
  /// The saved routine when editing one, for its history; null for a new one.
  existing: Routine | null;
  agents: RosterAgent[];
  channels: Channel[];
  hook: HookInfo;
  error: string | null;
  onClose: () => void;
  onSave: (input: RoutineInput) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<RoutineInput>(seed);
  const [template, setTemplate] = useState<number | null>(null);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const isNew = existing === null;

  const agent = agents.find((a) => a.id === draft.agentId) ?? null;
  const name = agent?.name ?? "The agent";
  const t = draft.trigger;
  const set = (patch: Partial<RoutineInput>) => setDraft((d) => ({ ...d, ...patch }));
  const url = hookUrl(hook.base, agent?.workspaceId ?? null, draft.id ?? "");
  const secret = draft.secret ?? "";
  const ready = draft.prompt.trim().length > 0 && !!draft.agentId;

  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    toast(`${what} copied`, { icon: <Copy /> });
  };

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    const ok = await onSave({ ...draft, act: draft.act.trim() || "does the job" });
    setSaving(false);
    if (ok) onClose();
  };

  const recent = (existing?.runs ?? []).slice(-16);
  const parts = sentenceParts(draft, name, channels);
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const destinations: { value: string; label: ReactNode }[] = [
    { value: "agent_chat", label: <><MessageSquare className="size-3.5" />{name}&apos;s chat</> },
    ...channels.map((c) => ({ value: `channel:${c.id}`, label: <><Hash className="size-3.5" />{c.name}</> })),
    { value: "inbox", label: <><Inbox className="size-3.5" />Inbox</> },
    { value: "pr_comment", label: <><MessageSquareReply className="size-3.5" />a PR comment</> },
  ];

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      mode="centered"
      width={860}
      title={isNew ? "New routine" : existing.name}
      sub={
        isNew
          ? "An agent does something on its own, on a clock or a signal"
          : `${name} · ${existing.trigger.kind === "webhook" ? "webhook" : "schedule"}`
      }
      icon={
        <span className="grid size-[30px] place-items-center rounded-(--r2) bg-s3 text-ink2">
          {isNew ? <Plus className="size-4" /> : <Clock className="size-4" />}
        </span>
      }
      footer={
        <>
          {!isNew && (
            <Button variant="bad" onClick={onDelete}>
              <Trash2 className="size-[13px]" /> Delete
            </Button>
          )}
          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="solid" disabled={!ready || saving} onClick={save}>
            {isNew ? "Create routine" : "Save changes"}
          </Button>
        </>
      }
    >
      {isNew && (
        <>
          <H>Start from a template</H>
          <div className="mb-1.5 grid grid-cols-4 gap-2">
            {TEMPLATES.map((tpl, i) => {
              const Icon = TEMPLATE_ICON[tpl.icon];
              return (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => {
                    setTemplate(i);
                    set({ ...tpl.set });
                  }}
                  className={cn(
                    "cursor-pointer rounded-(--r3) bg-s1 p-3 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-[background,box-shadow] hover:bg-s2",
                    template === i && "shadow-[inset_0_0_0_1.5px_var(--ink2)]",
                  )}
                >
                  <Icon className="mb-2.5 size-[18px] text-ink2" />
                  <b className="block text-[12.5px] font-semibold">{tpl.name}</b>
                  <span className="mt-[3px] block text-[11.5px] leading-[1.4] text-ink3">{tpl.description}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-5 grid grid-cols-[1fr_250px] gap-7 max-md:grid-cols-1">
        <div className="min-w-0">
          <H>Name</H>
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Weekly numbers"
            className={fieldClassName}
          />

          <H>Who runs it</H>
          {agents.length === 0 ? (
            <p className="text-[13px] text-ink3">Make an agent first. A routine is something an agent does.</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {agents.map((a) => {
                const on = a.id === draft.agentId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => set({ agentId: a.id })}
                    className={cn(
                      "flex cursor-pointer items-center gap-[9px] rounded-(--r3) px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-s2",
                      on ? "bg-s2 shadow-[inset_0_0_0_1.5px_var(--ink3)]" : "bg-s1 shadow-[inset_0_0_0_1px_var(--line)]",
                    )}
                  >
                    <AgentTile id={a.id} kind={a.kind} color={a.color} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{a.name}</span>
                      <em className="block truncate text-[11.5px] font-normal text-ink3 not-italic">{a.role}</em>
                    </span>
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded-full",
                        on ? "bg-ink text-background" : "shadow-[inset_0_0_0_1.5px_var(--line3)]",
                      )}
                    >
                      {on && <Check className="size-[11px]" strokeWidth={2.6} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <H>When</H>
          <Segmented
            value={t.kind}
            label="When it runs"
            onChange={(kind) =>
              set({
                trigger:
                  kind === "schedule"
                    ? { kind: "schedule", days: [0, 1, 2, 3, 4], time: "09:00", tz: "local" }
                    : { kind: "webhook", source: "GitHub", event: SOURCES.GitHub[0] },
                secret: draft.secret || newSecret(),
              })
            }
            options={[
              { value: "schedule", label: <><Clock className="size-[13px]" /> On a schedule</> },
              { value: "webhook", label: <><Webhook className="size-[13px]" /> When a service calls</> },
            ]}
          />

          {t.kind === "schedule" ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex gap-1">
                {DAY_LETTERS.map((letter, i) => {
                  const on = t.days.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        if (on && t.days.length === 1) return;
                        set({ trigger: { ...t, days: on ? t.days.filter((d) => d !== i) : [...t.days, i].sort() } });
                      }}
                      className={cn(
                        "grid size-[30px] cursor-pointer place-items-center rounded-full text-xs font-medium transition-colors",
                        on ? "bg-ink text-background" : "bg-s2 text-ink3 hover:bg-s3",
                      )}
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
              <input
                type="time"
                value={t.time}
                onChange={(e) => e.target.value && set({ trigger: { ...t, time: e.target.value } })}
                className={cn(fieldClassName, "w-[110px] tabular-nums")}
              />
              <span className="text-xs text-ink4">{tzName} time</span>
              <button
                type="button"
                className="cursor-pointer text-xs text-ink3 underline decoration-ink4 underline-offset-[3px] hover:text-ink"
                onClick={() => set({ trigger: { ...t, days: ALL_DAYS } })}
              >
                Every day
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <Segmented
                value={t.source}
                label="Which service"
                onChange={(source) => set({ trigger: { kind: "webhook", source, event: SOURCES[source][0] } })}
                options={Object.keys(SOURCES).map((s) => ({
                  value: s,
                  label: <><SourceMark source={s} size={16} />{s}</>,
                }))}
              />
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {(SOURCES[t.source] ?? []).map((e) => (
                  <Pill key={e} mono on={e === t.event} onClick={() => set({ trigger: { ...t, event: e } })}>
                    {e}
                  </Pill>
                ))}
              </div>

              <div className="mt-4 mb-2 text-xs font-medium text-ink2">Point {t.source} at this address</div>
              <HookRow
                icon={<Globe />}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => copy(url, "Webhook URL")}>
                    <Copy /> Copy
                  </Button>
                }
              >
                {url}
              </HookRow>
              <div className="mt-1.5">
                <HookRow
                  icon={<Key />}
                  actions={
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setReveal((r) => !r)}>
                        {reveal ? <EyeOff /> : <Eye />} {reveal ? "Hide" : "Show"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => copy(secret, "Signing secret")}>
                        <Copy /> Copy
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => set({ secret: newSecret() })}>
                        <RefreshCw /> New
                      </Button>
                    </>
                  }
                >
                  {reveal ? secret : "whsec_••••••••••••••••"}
                </HookRow>
              </div>
              <p className="mt-2 text-xs leading-[1.5] text-ink3">
                {t.source === "Stripe"
                  ? "Stripe makes its own signing secret: paste it here (press Show, then replace it) so the signature checks out. "
                  : `Put the signing secret in ${t.source}'s webhook settings; calls without a valid signature are refused. `}
                This address is on your machine ({hook.base || "listener not started"}), so a service on the internet
                cannot reach it by itself: run a tunnel such as <code className="font-mono">cloudflared tunnel --url {hook.base || "http://127.0.0.1:47831"}</code> or
                ngrok, and put its public address in place of {hook.base || "the local one"}. Routines run while hz is open.
              </p>
            </div>
          )}

          <H>What {name} does</H>
          <input
            value={draft.act}
            onChange={(e) => set({ act: e.target.value })}
            placeholder="pulls the weekly numbers"
            className={fieldClassName}
          />
          <textarea
            value={draft.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            placeholder={`The full prompt ${name} gets every run.`}
            className={cn(fieldClassName, "mt-2 h-[110px] resize-none leading-[1.6]")}
          />

          <H>Where the result goes</H>
          <Segmented value={draft.to} label="Where the result goes" onChange={(to) => set({ to })} options={destinations} />
          <p className="mt-1.5 text-xs text-ink4">
            {name} always answers in its own chat. The Inbox and channels get a copy as well: a channel posts it as {name}.
          </p>

          <div className="mt-4 flex items-center gap-3 text-[13px]">
            <div>
              <div className="font-medium">Quiet run</div>
              <div className="mt-px text-xs text-ink3">No ping unless something changed or it needs you</div>
            </div>
            <Switch className="ml-auto" checked={draft.quiet} onCheckedChange={(quiet) => set({ quiet })} aria-label="Quiet run" />
          </div>
          {error && <p className="mt-3 text-xs text-red">{error}</p>}
        </div>

        <div>
          <div className="sticky top-0 rounded-(--r3) bg-s1 p-4 shadow-[inset_0_0_0_1px_var(--line)]">
            <div className="text-xs font-medium text-ink3">In one sentence</div>
            <div className="mt-2.5 text-sm leading-[1.65] text-ink2">
              {parts.map((p, i) =>
                p.chip ? (
                  <b key={i} className="font-[550] text-ink">
                    {p.text || "…"}
                  </b>
                ) : (
                  <span key={i}>{p.text}</span>
                ),
              )}
            </div>
            {!isNew && (
              <>
                <div className="mt-5 text-xs font-medium text-ink3">Last runs</div>
                <div className="mt-1 flex gap-[3px]">
                  {recent.length === 0 && <span className="text-xs text-ink4">None yet.</span>}
                  {recent.map((r) => (
                    <i
                      key={r.at}
                      className={cn("h-5 max-w-3.5 flex-1 rounded-[3px] opacity-75", r.status === "fail" ? "bg-red" : "bg-green")}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
