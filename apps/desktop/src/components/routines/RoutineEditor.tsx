import { Bell, BarChart3, ChevronDown, Clock, Copy, Eye, EyeOff, Globe, Key, Moon, RefreshCw, Zap } from "lucide-react";
import { useState, type ReactNode } from "react";

import AgentTile from "@/components/AgentTile";
import { Group, Row, Section, Val } from "@/components/kit/kit";
import { SourceMark } from "@/components/routines/Sentence";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fieldClassName } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import {
  ALL_DAYS,
  DAY_LETTERS,
  DAY_NAMES,
  SOURCES,
  TEMPLATES,
  WEEKDAYS,
  hookUrl,
  infinitive,
  newSecret,
  sentenceParts,
  type Channel,
} from "@/lib/routines";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { HookInfo, Routine, RoutineInput } from "@/types/events";

const TEMPLATE_ICON = { bell: Bell, usage: BarChart3, bolt: Zap, moon: Moon } as const;

type Repeat = "daily" | "weekday" | "weekly" | "custom" | "service";
const REPEATS: { value: Repeat; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekday", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "custom", label: "Chosen days" },
  { value: "service", label: "When a service calls" },
];

const repeatOf = (t: RoutineInput["trigger"]): Repeat => {
  if (t.kind === "webhook") return "service";
  const key = [...new Set(t.days)].sort().join();
  if (key === ALL_DAYS.join()) return "daily";
  if (key === WEEKDAYS.join()) return "weekday";
  return t.days.length === 1 ? "weekly" : "custom";
};

const Sec = ({ className, ...p }: React.ComponentProps<typeof Section>) => (
  <Section {...p} className={cn("[&>b]:leading-[1.5]", className)} />
);

const PICK =
  "flex min-h-11 w-full cursor-pointer items-center gap-[11px] px-3 py-[9px] text-left transition-colors hover:bg-s2 focus-visible:bg-s2 focus-visible:outline-none";

/// A row whose right side is a value that opens a menu of choices: the mockup's `Down` row.
function PickRow({ title, value, current, onPick, children }: {
  title: string;
  value: ReactNode;
  current: string;
  onPick: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={PICK}>
          <b className="block flex-1 text-[13px] leading-[1.4] font-medium">{title}</b>
          <Val kind="down">{value}</Val>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup value={current} onValueChange={onPick}>
          {children}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

/// The dialog that makes or changes a routine: who, when, what, in the mockup's four fields.
/// Everything the page can do beyond that (name, full prompt, where the result goes, quiet,
/// templates, run history) sits behind "More options", and a service's address and secret
/// appear only once "When a service calls" is picked.
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
  // A routine made from a chat message arrives with a prompt and no short line.
  const [draft, setDraft] = useState<RoutineInput>(() => ({
    ...seed,
    act: infinitive(seed.act || seed.prompt.slice(0, 80)),
  }));
  const [repeat, setRepeat] = useState<Repeat>(() => repeatOf(seed.trigger));
  const [template, setTemplate] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const isNew = existing === null;

  const agent = agents.find((a) => a.id === draft.agentId) ?? null;
  const name = agent?.name ?? "The agent";
  const t = draft.trigger;
  const set = (patch: Partial<RoutineInput>) => setDraft((d) => ({ ...d, ...patch }));
  const url = hookUrl(hook.base, agent?.workspaceId ?? null, draft.id ?? "");
  const secret = draft.secret ?? "";
  const ready = draft.act.trim().length > 0 && !!draft.agentId;
  const schedule = t.kind === "schedule" ? t : null;

  const copy = (text: string, what: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    toast(`${what} copied`, { icon: <Copy /> });
  };

  const pickRepeat = (next: string) => {
    const r = next as Repeat;
    setRepeat(r);
    if (r === "service") {
      set({ trigger: { kind: "webhook", source: "GitHub", event: SOURCES.GitHub[0] }, secret: draft.secret || newSecret() });
      return;
    }
    const base = schedule ?? { kind: "schedule" as const, days: WEEKDAYS, time: "09:00", tz: "local" };
    const days = r === "daily" ? ALL_DAYS : r === "weekday" ? WEEKDAYS : r === "weekly" ? [base.days[0] ?? 0] : base.days;
    set({ trigger: { ...base, days: r === "custom" && days.length < 2 ? [0, 2, 4] : days } });
  };

  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    const act = draft.act.trim();
    const ok = await onSave({ ...draft, act, name: draft.name.trim() || act[0].toUpperCase() + act.slice(1), prompt: draft.prompt.trim() || act });
    setSaving(false);
    if (ok) onClose();
  };

  const recent = (existing?.runs ?? []).slice(-16);
  const parts = sentenceParts({ trigger: t, act: draft.act.trim() || "…" }, name);
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const destinations: { value: string; label: string }[] = [
    { value: "agent_chat", label: `${name}'s chat` },
    ...channels.map((c) => ({ value: `channel:${c.id}`, label: `#${c.name}` })),
    { value: "inbox", label: "Inbox" },
    { value: "pr_comment", label: "A PR comment" },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      width={540}
      title={isNew ? "New routine" : "Edit routine"}
      lead={
        <span className="grid size-11 shrink-0 place-items-center text-ink2">
          <Clock className="size-[22px]" />
        </span>
      }
      footer={
        <>
          {!isNew && (
            <Button variant="bad" className="mr-auto" onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="solid" disabled={!ready || saving} onClick={save}>
            Save routine
          </Button>
        </>
      }
    >
      <Sec title="Who" className="first:mt-5" />
      <Group>
        <PickRow
          title="Agent"
          current={draft.agentId}
          onPick={(agentId) => set({ agentId })}
          value={
            <>
              {agent && <AgentTile id={agent.id} kind={agent.kind} color={agent.color} shape={agent.shape} look={agent.look} photo={agent.photo} size={22} />}
              {name}
            </>
          }
        >
          {agents.map((a) => (
            <DropdownMenuRadioItem key={a.id} value={a.id}>
              <AgentTile id={a.id} kind={a.kind} color={a.color} shape={a.shape} look={a.look} photo={a.photo} size={20} />
              {a.name}
            </DropdownMenuRadioItem>
          ))}
        </PickRow>
      </Group>

      <Sec title="When" />
      <Group>
        <PickRow title="Repeat" current={repeat} onPick={pickRepeat} value={REPEATS.find((r) => r.value === repeat)?.label}>
          {REPEATS.map((r) => (
            <DropdownMenuRadioItem key={r.value} value={r.value}>
              {r.label}
            </DropdownMenuRadioItem>
          ))}
        </PickRow>
        {schedule && repeat === "weekly" && (
          <PickRow
            title="Day"
            current={String(schedule.days[0] ?? 0)}
            onPick={(d) => set({ trigger: { ...schedule, days: [Number(d)] } })}
            value={DAY_NAMES[schedule.days[0] ?? 0]}
          >
            {DAY_NAMES.map((n, i) => (
              <DropdownMenuRadioItem key={n} value={String(i)}>
                {n}
              </DropdownMenuRadioItem>
            ))}
          </PickRow>
        )}
        {schedule && repeat === "custom" && (
          <Row
            title="Days"
            right={
              <span className="flex gap-1">
                {DAY_LETTERS.map((letter, i) => {
                  const on = schedule.days.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-label={DAY_NAMES[i]}
                      aria-pressed={on}
                      onClick={() => {
                        if (on && schedule.days.length === 1) return;
                        set({ trigger: { ...schedule, days: on ? schedule.days.filter((d) => d !== i) : [...schedule.days, i].sort() } });
                      }}
                      className={cn(
                        "grid size-6 cursor-pointer place-items-center rounded-full text-[11px] font-medium transition-colors",
                        on ? "bg-ink text-background" : "bg-s2 text-ink3 hover:bg-s3",
                      )}
                    >
                      {letter}
                    </button>
                  );
                })}
              </span>
            }
          />
        )}
        {schedule && (
          <Row
            title="Time"
            right={
              <input
                type="time"
                title={`${tzName} time`}
                value={schedule.time}
                onChange={(e) => e.target.value && set({ trigger: { ...schedule, time: e.target.value } })}
                className="w-[120px] rounded-md bg-transparent px-1.5 py-[3px] text-right text-[12.5px] text-ink2 tabular-nums outline-none transition-colors hover:bg-s3 hover:text-ink focus:bg-s3 focus:text-ink"
              />
            }
          />
        )}
        {t.kind === "webhook" && (
          <>
            <PickRow
              title="Service"
              current={t.source}
              onPick={(source) => set({ trigger: { kind: "webhook", source, event: SOURCES[source][0] } })}
              value={
                <>
                  <SourceMark source={t.source} size={16} />
                  {t.source}
                </>
              }
            >
              {Object.keys(SOURCES).map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  <SourceMark source={s} size={16} />
                  {s}
                </DropdownMenuRadioItem>
              ))}
            </PickRow>
            <PickRow
              title="Event"
              current={t.event}
              onPick={(event) => set({ trigger: { ...t, event } })}
              value={<code className="font-mono text-[11.5px]">{t.event}</code>}
            >
              {(SOURCES[t.source] ?? [t.event]).map((e) => (
                <DropdownMenuRadioItem key={e} value={e}>
                  <code className="font-mono text-[11.5px]">{e}</code>
                </DropdownMenuRadioItem>
              ))}
            </PickRow>
          </>
        )}
      </Group>
      {t.kind === "webhook" && (
        <div className="mx-1 mt-3">
              <div className="mb-2 text-xs font-medium text-ink2">Point {t.source} at this address</div>
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

      <Sec title="What it does" />
      <textarea
        rows={3}
        value={draft.act}
        onChange={(e) => set({ act: e.target.value })}
        placeholder="check the pool and report capacity"
        className={cn(fieldClassName, "resize-none py-[9px] leading-[1.55]")}
      />
      <p className="px-1 py-2 text-[13px] leading-[1.55] text-ink3">
        {parts.map((p, i) =>
          p.chip === "agent" ? (
            <span key={i} className="border-b border-dashed border-ink4 font-medium">
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>

      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore((m) => !m)}
        className="mx-1 mt-1 inline-flex cursor-pointer items-center gap-1 text-xs text-ink3 transition-colors hover:text-ink"
      >
        More options <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
      </button>

      {more && (
        <div className="mt-1">
          {isNew && (
            <>
              <Sec title="Start from a template" />
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((tpl, i) => {
                  const Icon = TEMPLATE_ICON[tpl.icon];
                  return (
                    <button
                      key={tpl.name}
                      type="button"
                      onClick={() => {
                        setTemplate(i);
                        set({ ...tpl.set });
                        if (tpl.set.trigger) setRepeat(repeatOf(tpl.set.trigger));
                        if (tpl.set.trigger?.kind === "webhook") set({ secret: draft.secret || newSecret() });
                      }}
                      className={cn(
                        "cursor-pointer rounded-(--r3) bg-s1 p-3 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-[background,box-shadow] hover:bg-s2",
                        template === i && "shadow-[inset_0_0_0_1.5px_var(--ink2)]",
                      )}
                    >
                      <Icon className="mb-2 size-[17px] text-ink2" />
                      <b className="block text-[12.5px] font-medium">{tpl.name}</b>
                      <span className="mt-[3px] block text-[11.5px] leading-[1.4] text-ink3">{tpl.description}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <Sec title="Details" />
          <Group>
            <Row
              title="Name"
              right={
                <input
                  value={draft.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="Weekly numbers"
                  className="w-[220px] rounded-md bg-transparent px-1.5 py-[3px] text-right text-[12.5px] text-ink2 outline-none transition-colors placeholder:text-ink4 hover:bg-s3 hover:text-ink focus:bg-s3 focus:text-ink"
                />
              }
            />
            <PickRow
              title="Send the result to"
              current={draft.to}
              onPick={(to) => set({ to })}
              value={destinations.find((d) => d.value === draft.to)?.label ?? draft.to}
            >
              {destinations.map((d) => (
                <DropdownMenuRadioItem key={d.value} value={d.value}>
                  {d.label}
                </DropdownMenuRadioItem>
              ))}
            </PickRow>
            <Row
              title="Quiet run"
              sub="No ping unless something changed or it needs you"
              right={<Switch checked={draft.quiet} onCheckedChange={(quiet) => set({ quiet })} aria-label="Quiet run" />}
            />
          </Group>

          <Sec title="Full prompt" />
          <textarea
            rows={4}
            value={draft.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            placeholder={`What ${name} gets every run. Left empty, it is the line above.`}
            className={cn(fieldClassName, "resize-none py-[9px] leading-[1.55]")}
          />

          {!isNew && (
            <>
              <Sec title="Last runs" />
              <div className="flex gap-[3px]">
                {recent.length === 0 && <span className="text-xs text-ink4">None yet.</span>}
                {recent.map((r) => (
                  <i key={r.at} className={cn("h-5 max-w-3.5 flex-1 rounded-[3px] opacity-75", r.status === "fail" ? "bg-red" : "bg-green")} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red">{error}</p>}
    </Modal>
  );
}
