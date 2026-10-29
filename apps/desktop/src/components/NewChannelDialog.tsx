import { ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import AgentAvatar from "@/components/AgentAvatar";
import { Group, Row } from "@/components/kit/kit";
import { ChannelTile } from "@/components/sidebar/ConvRow";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { createChannel, updateChannel } from "@/hooks/useChannels";
import { channelProblem, MODES, slugName } from "@/lib/channels";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { Channel, Mode } from "@/types/events";

const FIELD =
  "w-full rounded-(--r1) bg-s1 px-[11px] text-[13px] text-ink shadow-[inset_0_0_0_1px_var(--line2)] outline-none transition-[box-shadow,background] placeholder:text-ink4 hover:shadow-[inset_0_0_0_1px_var(--line3)] focus:bg-s2 focus:shadow-[inset_0_0_0_1px_var(--line3)]";

function Label({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <div className={cn("mb-[7px] px-0.5 text-xs font-medium text-ink3", first ? "mt-0.5" : "mt-4")}>{children}</div>;
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
  const [mode, setMode] = useState<Mode>("triage");
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
    setMode(editing?.mode ?? "triage");
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

  const leadAgent = agents.find((a) => a.id === leadId);
  const menuBtn = "inline-flex cursor-pointer items-center gap-[5px] text-[12.5px] text-ink2 transition-colors hover:text-ink";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showClose={false}
        className="flex max-h-[calc(100vh-64px)] w-[540px] max-w-[calc(100vw-48px)]! flex-col gap-0 overflow-hidden rounded-(--r4)! border-0 bg-(--sheet) p-0!"
      >
        <div className="flex shrink-0 items-center gap-3 px-5 pt-[18px] pb-2">
          <ChannelTile color={leadAgent?.color ?? "#a58bfa"} size={44} lead={leadAgent} />
          <DialogTitle className="min-w-0 flex-1 text-[16px] leading-[1.3] font-semibold tracking-[-0.015em]">
            {editing ? "Edit channel" : "New channel"}
          </DialogTitle>
          <DialogDescription className="sr-only">A room where you and a few agents work on one thing together.</DialogDescription>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-7 cursor-pointer place-items-center rounded-lg text-ink3 transition-colors hover:bg-hover hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-1 pb-5">
          <Label first>Name</Label>
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
            className={cn(FIELD, "h-[34px]", nameBad && "shadow-[inset_0_0_0_1px_var(--red)]!")}
          />
          {nameBad && <p className="mt-1.5 text-xs text-red">{problem}</p>}
          {!nameBad && slug && slug !== name.trim() && <p className="mt-1.5 text-xs text-ink4">Saved as #{slug}</p>}

          <Label>Purpose</Label>
          <textarea
            aria-label="What it's for"
            rows={2}
            value={purpose}
            placeholder="What is this channel for?"
            onChange={(e) => setPurpose(e.target.value)}
            className={cn(FIELD, "resize-none py-[9px] leading-[1.55]")}
          />

          <Label>Agents</Label>
          {agents.length === 0 ? (
            <p className="text-[13px] text-ink3">This workspace has no agents yet. Create one first.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {agents.map((a) => {
                const on = picked.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={on}
                    title={a.role || a.name}
                    onClick={() => toggle(a.id)}
                    className={cn(
                      "inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-full pr-2.5 pl-[5px] text-[12.5px] font-medium whitespace-nowrap transition-colors",
                      on ? "bg-s3 text-ink" : "text-ink2 hover:bg-s2 hover:text-ink",
                    )}
                  >
                    <AgentAvatar agent={a} size={18} />
                    {a.name}
                  </button>
                );
              })}
            </div>
          )}
          {shown && picked.length === 0 && <p className="mt-1.5 text-xs text-red">Pick at least one agent.</p>}

          <Group className="mt-[18px]">
            <Row
              title="Lead"
              sub="Answers first when nobody is mentioned."
              right={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild disabled={picked.length === 0}>
                    <button type="button" className={menuBtn}>
                      {leadAgent && <AgentAvatar agent={leadAgent} size={20} />}
                      {leadAgent?.name ?? "Pick an agent"}
                      <ChevronDown className="size-3.5 text-ink4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">Lead</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={leadId} onValueChange={setLead}>
                      {picked.flatMap((id) => {
                        const a = agents.find((x) => x.id === id);
                        return a
                          ? [
                              <DropdownMenuRadioItem key={id} value={id}>
                                <AgentAvatar agent={a} size={22} />
                                {a.name}
                              </DropdownMenuRadioItem>,
                            ]
                          : [];
                      })}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
            <Row
              title="Answers"
              sub="Who replies to a message."
              right={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={menuBtn}>
                      {MODES.find((m) => m.value === mode)?.title}
                      <ChevronDown className="size-3.5 text-ink4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">Who answers</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)}>
                      {MODES.map((m) => (
                        <DropdownMenuRadioItem key={m.value} value={m.value}>
                          <span className="flex flex-col">
                            {m.title}
                            <span className="text-[11.5px] font-normal text-ink4">{m.hint}</span>
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
            <Row
              title="Rounds"
              sub="How many times agents answer each other."
              right={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={menuBtn}>
                      {rounds}
                      <ChevronDown className="size-3.5 text-ink4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuLabel className="px-[9px] py-1 text-[11px] font-medium text-ink4">Rounds</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={String(rounds)} onValueChange={(v) => setRounds(Number(v))}>
                      {[1, 2, 3].map((n) => (
                        <DropdownMenuRadioItem key={n} value={String(n)}>
                          {n}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
          </Group>

          {failure && <p className="mt-3 text-xs text-red">{failure}</p>}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 pt-3 pb-4">
          <Button variant="ghost" className="h-[30px]" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="solid" className={cn("h-[30px]", (!slug || picked.length === 0) && "opacity-35")} disabled={busy} onClick={() => void save()}>
            {editing ? "Save" : "Create channel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
