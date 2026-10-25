import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Folder as FolderIcon, Lock, Plus, X } from "lucide-react";
import { useState } from "react";

import { homeShort } from "@/components/chat/AgentChatHeader";
import { LEVEL } from "@/components/profile/ProfileOverview";
import { Blk, Meter, TextDialog } from "@/components/profile/parts";
import type { ProfileProps } from "@/components/profile/AgentProfile";
import { PluginMark } from "@/components/plugins/parts";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { useSpend } from "@/hooks/useAgentProfile";
import { usePlugins } from "@/hooks/usePlugins";
import { removeAllowRule, useInbox } from "@/hooks/useInbox";
import { STARTER_RULES, addFolder, toolOn, withTool, type AskRule, type Talk } from "@/lib/agentAccess";
import { budgetState, litSegments, parseBudget, spendShare, usd } from "@/lib/budget";
import { MODE_COPY, honoursMode } from "@/lib/permission";
import { cn } from "@/lib/utils";
import type { ApprovalPolicy, ActivityScan } from "@/types/events";

const LADDER: ApprovalPolicy[] = ["plan", "manual", "auto", "bypassPermissions"];

const ROW = "flex items-center gap-2.5 border-t border-line py-2.5 text-[13px] first:border-t-0";

export default function ProfileAccess({
  agent,
  teammates,
  workspace,
  onChange,
  onOpenPlugins,
  scan,
}: ProfileProps & { scan: ActivityScan | null }) {
  const mode = agent.permission ?? "auto";
  // The starter rules are offered, not applied: a rule is a hard line in the
  // agent's briefing, and nothing should change its behaviour unasked.
  const rules: AskRule[] = agent.alwaysAsk ?? [];
  const folders = agent.folders ?? [];
  const talk: Talk = agent.talk ?? { mode: "everyone", ids: [] };
  const [ruleOpen, setRuleOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const spend = useSpend(agent.id, `${agent.budget}|${scan?.tasks.length}`);
  const allowed = useInbox().rules.filter((r) => r.agentId === agent.id);
  const plugins = usePlugins(agent.workspaceId, true);

  const seedRules = () => onChange({ ...agent, alwaysAsk: STARTER_RULES.map((r) => ({ ...r })) });
  const setRules = (next: AskRule[]) => onChange({ ...agent, alwaysAsk: next });

  const addFolderPath = async () => {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    onChange({ ...agent, folders: addFolder(folders, picked) });
    toast(
      agent.harness === "claude-acp"
        ? `${agent.name} can read ${homeShort(picked)} from its next session`
        : `${agent.name} is told it can read ${homeShort(picked)}`,
    );
  };

  const spent = spend?.spentUsd ?? 0;
  const share = spendShare(spent, agent.budget ?? null);
  const state = budgetState(spent, agent.budget ?? null);

  const tools: { key: "team" | "memory"; name: string; sub: string }[] = [
    { key: "team", name: "Team", sub: "Ask and message teammates" },
    { key: "memory", name: "Memory", sub: "Read and write its notes" },
  ];

  const setTalk = (next: Talk) => onChange({ ...agent, talk: next });

  return (
    <div className="grid grid-cols-2 gap-x-11 gap-y-[34px] max-[860px]:grid-cols-1">
      <Blk title={`How far ${agent.name} goes on its own`} className="col-span-full">
        <div className="grid grid-cols-4 gap-2 max-[700px]:grid-cols-2" role="radiogroup" aria-label="Permission">
          {LADDER.map((k) => {
            const ok = honoursMode(agent.harness, k);
            const on = k === mode;
            const card = (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!ok}
                onClick={() => {
                  onChange({ ...agent, permission: k });
                  toast(`${agent.name}: ${MODE_COPY[k].label}, from the next message`);
                }}
                className={cn(
                  "cursor-pointer rounded-(--r3) bg-s1 px-4 py-3.5 text-left shadow-[inset_0_0_0_1px_var(--line)] transition-colors outline-none hover:bg-s2 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-s1",
                  on && "bg-(--tint)/7 shadow-[inset_0_0_0_1.5px_var(--tint)] hover:bg-(--tint)/7",
                )}
              >
                <b className="flex items-center gap-[9px] text-[13.5px] font-semibold">
                  <Meter level={LEVEL[k]} />
                  {MODE_COPY[k].label}
                </b>
                <span className="mt-1.5 block text-xs leading-[1.45] text-ink3">{MODE_COPY[k].hint}</span>
              </button>
            );
            return ok ? (
              card
            ) : (
              <Tooltip key={k}>
                <TooltipTrigger asChild>
                  <span className="block">{card}</span>
                </TooltipTrigger>
                <TooltipContent>This CLI has no such stance</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </Blk>

      <Blk
        title="Always asks you before"
        action={
          <>
            <Plus className="size-[11px]" /> Add
          </>
        }
        onAction={() => setRuleOpen(true)}
      >
        {rules.length === 0 ? (
          <div className="rounded-(--r3) bg-s1 px-4 py-3.5 text-[13px] text-ink3 shadow-[inset_0_0_0_1px_var(--line)]">
            No rules yet.{" "}
            <button type="button" className="cursor-pointer text-ink underline-offset-2 hover:underline" onClick={seedRules}>
              Start from the usual ones
            </button>
          </div>
        ) : (
          <div>
            {rules.map((r, i) => (
              <div key={`${r.text}-${i}`} className={cn(ROW, "group")}>
                <span className="min-w-0 flex-1 truncate">{r.text}</span>
                <button
                  type="button"
                  aria-label={`Remove “${r.text}”`}
                  onClick={() => setRules(rules.filter((_, j) => j !== i))}
                  className="grid size-6 cursor-pointer place-items-center rounded-(--r1) text-ink4 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
                >
                  <X className="size-2.5" />
                </button>
                <Switch
                  checked={r.on}
                  aria-label={r.text}
                  onCheckedChange={(on) => setRules(rules.map((x, j) => (j === i ? { ...x, on } : x)))}
                />
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs leading-normal text-ink4">
          Put in {agent.name}'s instructions as hard rules, so it stops and asks. hz does not intercept the tool calls itself.
        </p>
      </Blk>

      {allowed.length > 0 && (
        <Blk title="Always allowed">
          <div>
            {allowed.map((r) => (
              <div key={r.id} className={cn(ROW, "group")}>
                <span className="min-w-0 flex-1 truncate">{r.label.replace(/^Always allow /, "").replace(/`/g, "")}</span>
                <button
                  type="button"
                  aria-label={`Stop allowing ${r.label}`}
                  onClick={() => void removeAllowRule(r.id)}
                  className="grid size-6 cursor-pointer place-items-center rounded-(--r1) text-ink4 transition-colors hover:text-ink"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs leading-normal text-ink4">
            Given from the Inbox. hz answers these for {agent.name} without asking, once, and only for the same command words or folder.
          </p>
        </Blk>
      )}

      <Blk
        title="Folders it can touch"
        action={
          <>
            <Plus className="size-[11px]" /> Add
          </>
        }
        onAction={() => void addFolderPath()}
      >
        <div>
          <div className={ROW}>
            <FolderIcon className="size-[13px] text-ink3" />
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{homeShort(agent.projectPath)}</code>
            <span className="rounded-[5px] bg-s3 px-[7px] py-px text-[11px] font-medium text-ink2 lowercase">read · write</span>
            <Lock className="size-[11px] text-ink4" aria-label="Its own folder, fixed" />
          </div>
          {folders.map((f, i) => (
            <div key={f.path} className={ROW}>
              <FolderIcon className="size-[13px] text-ink3" />
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{homeShort(f.path)}</code>
              <button
                type="button"
                onClick={() => onChange({ ...agent, folders: folders.map((x, j) => (j === i ? { ...x, write: !x.write } : x)) })}
                className="cursor-pointer rounded-[5px] bg-s3 px-[7px] py-px text-[11px] font-medium text-ink2 lowercase transition-colors hover:bg-line3"
              >
                {f.write ? "read · write" : "read only"}
              </button>
              <button
                type="button"
                aria-label={`Remove ${f.path}`}
                onClick={() => {
                  onChange({ ...agent, folders: folders.filter((_, j) => j !== i) });
                  toast(`Removed ${homeShort(f.path)}`);
                }}
                className="grid size-6 cursor-pointer place-items-center rounded-(--r1) text-ink3 hover:bg-hover hover:text-ink"
              >
                <X className="size-2.5" />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs leading-normal text-ink4">
          {agent.harness === "claude-acp"
            ? "Added to Claude's folders when its next session starts. Read only is a rule in its instructions, not a lock."
            : "This CLI takes no extra folders, so they are told in its instructions. Read only is a rule, not a lock."}
        </p>
      </Blk>

      <Blk title="Tools" action="Plugins" onAction={onOpenPlugins}>
        <div>
          {tools.map((t) => (
            <div key={t.key} className={ROW}>
              <div className="min-w-0 flex-1">
                <div>{t.name}</div>
                <div className="text-xs text-ink3">{t.sub}</div>
              </div>
              <Switch
                checked={toolOn(agent, t.key)}
                aria-label={t.name}
                onCheckedChange={(on) => {
                  onChange({ ...agent, toolsOff: withTool(agent.toolsOff ?? [], t.key, on) });
                  toast(`${t.name} ${on ? "on" : "off"} for ${agent.name}, from its next session`);
                }}
              />
            </div>
          ))}
        </div>
        {plugins.plugins.length > 0 && (
          <div className="mt-1 border-t border-line">
            {plugins.plugins.map((p) => (
              <div key={p.id} className={ROW}>
                <PluginMark face={p} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.name}</div>
                  <div className="text-xs text-ink3">
                    {p.tools.filter((t) => t.policy !== "off").length} of {p.tools.length} tools on
                  </div>
                </div>
                <Switch
                  checked={p.grants.includes(agent.id)}
                  aria-label={`${p.name} for ${agent.name}`}
                  onCheckedChange={(on) => {
                    void plugins.setGrant(p.id, agent.id, on).then((ok) => {
                      if (ok) toast(on ? `${agent.name} gets ${p.name} from its next session` : `${agent.name} can no longer use ${p.name}`);
                    });
                  }}
                />
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs leading-normal text-ink4">
          Team and Memory are hz's own. The rest come from Plugins, where each tool is set to Allow, Ask or Off. A plugin
          you give {agent.name} reaches it when its next session starts; one you take away stops working at once.
        </p>
      </Blk>

      <Blk title={`Who can talk to ${agent.name}`}>
        <Segmented<Talk["mode"]>
          label="Who can talk"
          value={talk.mode}
          onChange={(mode) => setTalk({ mode, ids: mode === "list" ? talk.ids : [] })}
          options={[
            { value: "everyone", label: "Everyone here" },
            { value: "me", label: "Only me" },
            { value: "list", label: "A list" },
          ]}
        />
        {talk.mode === "list" && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {teammates.length === 0 && <span className="text-xs text-ink3">There is no one else here.</span>}
            {teammates.map((m) => {
              const on = talk.ids.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTalk({ mode: "list", ids: on ? talk.ids.filter((x) => x !== m.id) : [...talk.ids, m.id] })}
                  className={cn(
                    "h-[26px] cursor-pointer rounded-full px-2.5 text-xs transition-colors",
                    on ? "bg-(--tint)/20 text-ink shadow-[inset_0_0_0_1px_var(--tint)]" : "bg-s2 text-ink3 hover:bg-s3",
                  )}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-2.5 text-xs leading-normal text-ink3">
          {talk.mode === "everyone"
            ? `Agents in ${workspace?.name ?? "this workspace"} can always ask ${agent.name} for help.`
            : talk.mode === "me"
              ? `No other agent can message ${agent.name}; their team_ask and team_message are refused.`
              : `Only the agents you pick can message ${agent.name}; everyone else is refused.`}{" "}
          Messages from you always get through.
        </p>

        <h3 className="mt-[30px] mb-3 flex items-center gap-2 text-[13px] font-semibold">
          Monthly budget
          <button
            type="button"
            onClick={() => setBudgetOpen(true)}
            className="ml-auto cursor-pointer text-xs font-normal text-ink3 transition-colors hover:text-ink"
          >
            Change
          </button>
        </h3>
        <button
          type="button"
          onClick={() => setBudgetOpen(true)}
          className="block w-full cursor-pointer rounded-(--r3) bg-s1 p-4 text-left shadow-[inset_0_0_0_1px_var(--line)]"
        >
          <div className="text-[22px] font-semibold tracking-[-0.02em]">
            US$ {spent.toFixed(2)}{" "}
            <small className="text-[13px] font-[450] tracking-normal text-ink3">
              {agent.budget ? `of US$ ${usd(agent.budget)}` : "this month · no limit"}
            </small>
          </div>
          <div className="mt-3 flex h-1.5 gap-0.5" aria-hidden>
            {Array.from({ length: 40 }, (_, i) => (
              <i
                key={i}
                className={cn(
                  "flex-1 rounded-[1px] bg-foreground/8",
                  i < litSegments(share) && (state === "ok" ? "bg-(--tint)" : "bg-amber"),
                )}
              />
            ))}
          </div>
          <div className="mt-2 flex text-xs text-ink4">
            <span>Alert at 80%</span>
            <span className="ml-auto">Pause at 100%</span>
          </div>
          {state !== "ok" && (
            <div className={cn("mt-2.5 text-xs", state === "paused" ? "text-red" : "text-amber")}>
              {state === "paused"
                ? `${agent.name} is paused: new messages are refused until you raise the budget.`
                : `${agent.name} is past 80% of its budget.`}
            </div>
          )}
        </button>
      </Blk>

      <TextDialog
        open={ruleOpen}
        onOpenChange={setRuleOpen}
        title="Always ask before…"
        lead={`${agent.name} stops and asks you whenever it is about to do this.`}
        placeholder="Sending money, emailing a customer…"
        confirm="Add"
        onSubmit={(v) => {
          const text = v.trim();
          if (!text) return false;
          setRules([...rules, { text, on: true }]);
          return true;
        }}
      />
      <TextDialog
        open={budgetOpen}
        onOpenChange={setBudgetOpen}
        title={`${agent.name}'s monthly budget`}
        lead={`At 80% you get a ping. At 100% ${agent.name} pauses and refuses new messages. Leave it empty for no limit.`}
        prefix="US$"
        inputMode="decimal"
        initial={agent.budget ? String(agent.budget) : ""}
        confirm="Save"
        onSubmit={(v) => {
          const empty = v.trim() === "";
          const n = empty ? null : parseBudget(v);
          if (!empty && n === null) return false;
          onChange({ ...agent, budget: n });
          // The mirror to the backend lands a beat after the roster changes.
          setTimeout(() => void invoke("agent_budget_changed", { agentId: agent.id }).catch(() => {}), 400);
          return true;
        }}
      />
    </div>
  );
}
