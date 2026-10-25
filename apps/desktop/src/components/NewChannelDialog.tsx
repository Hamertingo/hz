import { Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import AgentTile from "@/components/AgentTile";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Segmented } from "@/components/ui/segmented";
import { createChannel, updateChannel } from "@/hooks/useChannels";
import { channelProblem, MODES, slugName } from "@/lib/channels";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Channel, Mode } from "@/types/events";

const FIELD =
  "w-full rounded-(--r2) bg-s2 px-3 py-[9px] text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-shadow placeholder:text-ink4 focus:shadow-[inset_0_0_0_1px_var(--line3)]";

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-xs font-medium text-ink2">{children}</div>;
}

/// The new-channel card, and the edit card: the same form, filled from the
/// channel when there is one. It saves through the backend itself and answers
/// the channel it made, so the caller only has to open it.
export default function NewChannelDialog({
  open,
  editing,
  agents,
  channels,
  workspaceId,
  onClose,
  onSaved,
}: {
  open: boolean;
  /// The channel being edited, or null to make one.
  editing: Channel | null;
  /// The workspace's agents, in the roster's order.
  agents: RosterAgent[];
  channels: Channel[];
  workspaceId: string | null;
  onClose: () => void;
  onSaved: (channel: Channel, created: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("mention");
  const [lead, setLead] = useState("");
  const [rounds, setRounds] = useState(3);
  const [shown, setShown] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // A fresh form each time it opens, filled from the channel when editing.
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setPurpose(editing?.purpose ?? "");
    setPicked(editing ? editing.members : agents.slice(0, 3).map((a) => a.id));
    setMode(editing?.mode ?? "mention");
    setLead(editing?.lead ?? "");
    setRounds(editing?.rounds ?? 3);
    setShown(false);
    setFailure(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  // The lead is always one of the picked agents: removing the lead hands it to
  // whoever is first.
  const leadId = picked.includes(lead) ? lead : (picked[0] ?? "");
  const problem = useMemo(
    () => channelProblem({ name, members: picked, channels, workspaceId, editing: editing?.id ?? null }),
    [name, picked, channels, workspaceId, editing?.id],
  );
  const slug = slugName(name);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = async () => {
    setShown(true);
    if (problem) {
      if (!slug) nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const channel = editing
        ? await updateChannel(editing.id, { name: slug, purpose, members: picked, lead: leadId, mode, rounds })
        : await createChannel({ workspaceId: workspaceId ?? undefined, name: slug, purpose, members: picked, lead: leadId, mode, rounds });
      onSaved(channel, !editing);
    } catch (e) {
      setFailure(String(e));
    } finally {
      setBusy(false);
    }
  };

  const nameBad = shown && (!slug || (problem?.endsWith("already exists.") ?? false));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showClose={false}
        className="w-[640px] max-w-[calc(100vw-48px)]! gap-0 overflow-hidden rounded-[18px]! p-0! bg-(--pop)"
      >
        <div className="flex max-h-[calc(100vh-64px)] flex-col gap-[18px] overflow-y-auto px-[26px] pt-6 pb-5">
          <div>
            <DialogTitle className="text-lg font-semibold tracking-[-0.02em]">
              {editing ? `Edit #${editing.name}` : "New channel"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] text-ink3">
              A room where you and a few agents work on one thing together.
            </DialogDescription>
          </div>

          <div>
            <Label>Name</Label>
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-(--r2) bg-s2 px-3 py-[9px] text-[15px] shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--line3)]",
                nameBad && "shadow-[inset_0_0_0_1px_var(--red)]!",
              )}
            >
              <span className="text-ink4">#</span>
              <input
                ref={nameRef}
                autoFocus
                aria-label="Name"
                aria-invalid={nameBad}
                value={name}
                placeholder="launch"
                maxLength={40}
                onChange={(e) => {
                  setName(e.target.value);
                  setFailure(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && void save()}
                className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink4"
              />
            </div>
            {nameBad && <p className="mt-1.5 text-xs text-red">{problem}</p>}
            {!nameBad && slug && slug !== name.trim() && (
              <p className="mt-1.5 text-xs text-ink4">Saved as #{slug}</p>
            )}
          </div>

          <div>
            <Label>What it&apos;s for</Label>
            <input
              aria-label="What it's for"
              value={purpose}
              placeholder="Launch of the Pro plan on 30/10."
              onChange={(e) => setPurpose(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void save()}
              className={FIELD}
            />
          </div>

          <div>
            <Label>Agents in it</Label>
            {agents.length === 0 ? (
              <p className="text-[13px] text-ink3">This workspace has no agents yet. Create one first.</p>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {agents.map((a) => {
                  const on = picked.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(a.id)}
                      className={cn(
                        "flex cursor-pointer items-center gap-[9px] rounded-(--r3) bg-s1 px-2.5 py-2 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s2",
                        on && "bg-s2 shadow-[inset_0_0_0_1.5px_var(--ink3)]",
                      )}
                    >
                      <AgentTile id={a.id} kind={a.kind} color={a.color} size={26} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {a.name}
                        <em className="block truncate text-[11.5px] font-normal text-ink3 not-italic">{a.role}</em>
                      </span>
                      <span
                        className={cn(
                          "grid size-4 flex-none place-items-center rounded-full shadow-[inset_0_0_0_1.5px_var(--line3)]",
                          on && "bg-ink text-background shadow-none",
                        )}
                      >
                        {on && <Check className="size-2.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {shown && picked.length === 0 && <p className="mt-1.5 text-xs text-red">Pick at least one agent.</p>}
          </div>

          <div>
            <Label>Who answers</Label>
            <div role="radiogroup" aria-label="Who answers" className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    "cursor-pointer rounded-(--r3) bg-s1 px-3 py-[11px] text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors",
                    mode === m.value && "bg-s2 shadow-[inset_0_0_0_1.5px_var(--ink2)]",
                  )}
                >
                  <b className="text-[12.5px] font-semibold">{m.title}</b>
                  <span className="mt-1 block text-[11.5px] leading-[1.4] text-ink3">{m.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <Label>Lead</Label>
              {picked.length === 0 ? (
                <span className="text-[13px] text-ink4">Pick an agent</span>
              ) : (
                <Segmented
                  label="Lead"
                  value={leadId}
                  onChange={setLead}
                  options={picked.flatMap((id) => {
                    const a = agents.find((x) => x.id === id);
                    return a ? [{ value: id, label: a.name }] : [];
                  })}
                />
              )}
            </div>
            <div>
              <Label>Rounds per message</Label>
              <Segmented
                label="Rounds per message"
                value={String(rounds)}
                onChange={(v) => setRounds(Number(v))}
                options={["1", "2", "3"].map((n) => ({ value: n, label: n }))}
              />
            </div>
          </div>

          {failure && <p className="text-xs text-red">{failure}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {editing ? "Save" : "Create channel"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
