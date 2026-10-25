import { BookOpen, Check, Lock, Plug, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type MutableRefObject } from "react";

import AgentTile from "@/components/AgentTile";
import MeAvatar from "@/components/MeAvatar";
import AddServerDialog from "@/components/plugins/AddServerDialog";
import ConnectModal from "@/components/plugins/ConnectModal";
import PluginSheet from "@/components/plugins/PluginSheet";
import PluginsSkeleton from "@/components/plugins/PluginsSkeleton";
import SkillSheet from "@/components/plugins/SkillSheet";
import { Faces, PluginMark } from "@/components/plugins/parts";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useMe } from "@/hooks/useMe";
import { usePlugins } from "@/hooks/usePlugins";
import {
  authNote,
  callsThisWeek,
  catalogGroups,
  grantToast,
  holders,
  matches,
  matrixCount,
  spark,
  type PluginsTab,
} from "@/lib/pluginsView";
import type { RosterAgent } from "@/lib/roster";
import { useJumpTarget } from "@/lib/jumpTarget";
import { cn } from "@/lib/utils";
import type { CatalogEntry, Plugin, Skill } from "@/types/events";

const TABS: { key: PluginsTab; label: string }[] = [
  { key: "connected", label: "Connected" },
  { key: "catalog", label: "Catalog" },
  { key: "skills", label: "Skills" },
];

const CARD = "rounded-(--r4) bg-s1 shadow-[inset_0_0_0_1px_var(--line)]";

/// The Plugins page: MCP servers a workspace has connected, the catalog of the
/// ones hz can connect, and Skills (how-tos an agent follows).
///
/// Everything is the workspace's. A plugin is held by agents one by one, in the
/// matrix or on its own sheet, and what an agent holds is exactly what its next
/// session is started with. See `plugin_store.rs` and `plugin_proxy.rs`.
export default function PluginsView({
  active,
  workspaceId,
  workspaceName,
  agents,
  onOpenAccess,
  refreshRef,
}: {
  active: boolean;
  workspaceId: string | null;
  workspaceName: string;
  /// The workspace's agents: the rows of the matrix.
  agents: RosterAgent[];
  onOpenAccess: (agentId: string) => void;
  /// The page's own refresh, handed up so ⌘R reaches it.
  refreshRef?: MutableRefObject<(() => void) | null>;
}) {
  const p = usePlugins(workspaceId, active);
  const me = useMe();
  const [tab, setTab] = useState<PluginsTab>("connected");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ entry: CatalogEntry; existing: Plugin | null } | null>(null);
  const [adding, setAdding] = useState<{ name: string } | null>(null);
  const [editing, setEditing] = useState<{ skill: Skill | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  // Jump to → Plugins opens the plugin's detail; "Connect a plugin" opens the catalog.
  useJumpTarget("plugin", (t) => {
    setTab("connected");
    setOpenId(t.id);
  });
  useJumpTarget("catalog", () => setTab("catalog"));

  useEffect(() => {
    if (refreshRef) refreshRef.current = () => void p.reload();
    return () => {
      if (refreshRef) refreshRef.current = null;
    };
  }, [refreshRef, p.reload]);
  useEffect(() => setNow(Date.now()), [p.calls]);

  const connected = p.plugins;
  const connectedIds = useMemo(() => new Set(connected.map((x) => x.id)), [connected]);
  const open = connected.find((x) => x.id === openId) ?? null;
  const catalogLeft = p.catalog.filter((c) => !connectedIds.has(c.id));
  const counts: Record<PluginsTab, number> = {
    connected: connected.length,
    catalog: catalogLeft.length,
    skills: p.skills.length,
  };

  const grant = async (plugin: Plugin, agent: RosterAgent, on: boolean) => {
    if (await p.setGrant(plugin.id, agent.id, on)) toast(grantToast(agent.name, plugin.name, on), { icon: on ? <Check /> : <X />, ms: 2200 });
  };

  const reconnect = async (plugin: Plugin) => {
    const entry = p.catalog.find((c) => c.id === plugin.id);
    if (plugin.kind === "catalog" && entry && plugin.auth === "token") {
      setOpenId(null);
      setConnecting({ entry, existing: plugin });
      return;
    }
    try {
      await p.reconnect(plugin.id);
      setNotice(null);
      toast(`${plugin.name} is connected again`, { icon: <Plug /> });
    } catch (e) {
      setNotice(String(e));
    }
  };

  const refreshTools = async (plugin: Plugin) => {
    try {
      const r = await p.retest(plugin.id);
      if (r.ok) {
        setNotice(null);
        toast(`${r.tools.length} tool${r.tools.length === 1 ? "" : "s"} found on ${plugin.name}`, { icon: <Plug /> });
      } else setNotice(r.error ?? "It could not be reached.");
    } catch (e) {
      setNotice(String(e));
    }
  };

  const startConnect = (entry: CatalogEntry) => setConnecting({ entry, existing: null });

  const search = (
    <label className="flex h-[30px] w-[210px] items-center gap-2 rounded-(--r2) bg-s2 px-2.5 text-ink3 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--line3)]">
      <Search className="size-3.5 shrink-0" />
      <input
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink4"
        placeholder={`Search ${tab}`}
        aria-label={`Search ${tab}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
    </label>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 flex-none items-center gap-3 border-b border-line pr-4 pl-5">
        <h1 className="flex items-center gap-[9px] text-[14.5px] font-semibold tracking-[-0.01em]">
          <Plug className="size-4 text-ink3" /> Plugins
        </h1>
        <div className="ml-3.5 flex gap-0.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setQuery("");
              }}
              className={cn(
                "flex h-7 cursor-pointer items-center gap-1.5 rounded-(--r1) px-2.5 text-[12.5px] font-medium transition-colors",
                tab === t.key ? "bg-active text-ink" : "text-ink3 hover:text-ink2",
              )}
            >
              {t.label}
              <em className={cn("text-[11px] not-italic tabular-nums", tab === t.key ? "text-ink3" : "text-ink4")}>
                {counts[t.key]}
              </em>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {search}
          {tab === "skills" ? (
            <Button variant="outline" onClick={() => setEditing({ skill: null })} disabled={!workspaceId}>
              <Plus className="size-3.5" /> New skill
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setAdding({ name: "" })} disabled={!workspaceId}>
              <Plus className="size-3.5" /> Add MCP server
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1040px] px-9 pt-7 pb-[70px]">
          {(notice || p.error) && (
            <p className="mb-4 flex items-start gap-2 text-[13px] break-words text-red">
              <span className="min-w-0 flex-1">{notice ?? p.error}</span>
              {notice && (
                <button type="button" aria-label="Dismiss" className="cursor-pointer text-ink3 hover:text-ink" onClick={() => setNotice(null)}>
                  <X className="size-3.5" />
                </button>
              )}
            </p>
          )}
          {!workspaceId ? (
            <p className="text-[13px] text-ink3">Create a workspace first: plugins belong to one.</p>
          ) : !p.loaded ? (
            <PluginsSkeleton tab={tab} />
          ) : tab === "connected" ? (
            <ConnectedTab
              plugins={connected.filter((x) => matches(x.name, query))}
              all={connected}
              agents={agents}
              calls={p.calls}
              now={now}
              hoverCol={hoverCol}
              setHoverCol={setHoverCol}
              moreCount={catalogLeft.length}
              workspaceName={workspaceName}
              loaded={p.loaded}
              onOpen={setOpenId}
              onBrowse={() => setTab("catalog")}
              onGrant={grant}
              onOpenAccess={onOpenAccess}
            />
          ) : tab === "catalog" ? (
            <CatalogTab
              catalog={p.catalog}
              connectedIds={connectedIds}
              query={query}
              onConnect={startConnect}
              onAddAs={() => setAdding({ name: query.trim() })}
            />
          ) : (
            <SkillsTab
              skills={p.skills.filter((s) => matches(s.name, query))}
              agents={agents}
              meName={me.name}
              onOpen={(skill) => setEditing({ skill })}
              onNew={() => setEditing({ skill: null })}
            />
          )}
        </div>
      </div>

      <PluginSheet
        plugin={open}
        agents={agents}
        calls={p.calls}
        me={me}
        now={now}
        onClose={() => setOpenId(null)}
        onPolicy={(plugin, tool, policy) => void p.setPolicy(plugin.id, tool, policy)}
        onGrant={(plugin, agent, on) => void grant(plugin, agent, on)}
        onReconnect={reconnect}
        onRefresh={refreshTools}
        onDisconnect={(plugin) => {
          setOpenId(null);
          void p.disconnect(plugin.id).then((ok) => ok && toast(`${plugin.name} disconnected`, { icon: <Plug /> }));
        }}
      />

      <ConnectModal
        entry={connecting?.entry ?? null}
        existing={connecting?.existing ?? null}
        agents={agents}
        me={me}
        onClose={() => setConnecting(null)}
        onSignIn={(entry, creds) => p.connect(entry.id, creds)}
        onCancelSignIn={(entry) => void p.cancelConnect(entry.id)}
        onFinish={async (plugin, policies, grants) => {
          if (!(await p.configure(plugin.id, policies, grants))) return;
          setConnecting(null);
          setTab("connected");
          setQuery("");
          toast(`${plugin.name} is connected`, {
            icon: <Check />,
            action: { label: "Open", onClick: () => setOpenId(plugin.id) },
          });
        }}
      />

      <AddServerDialog
        open={!!adding}
        initialName={adding?.name ?? ""}
        onClose={() => setAdding(null)}
        onAdd={async (input, tested) => {
          if (!(await p.addCustom(input))) return false;
          setAdding(null);
          setTab("connected");
          setQuery("");
          toast(`${input.name.trim()} added${tested ? "" : " (not tested)"}. Give it to an agent below.`, { icon: <Plug /> });
          return true;
        }}
      />

      <SkillSheet
        open={!!editing}
        skill={editing?.skill ?? null}
        agents={agents}
        by={editing?.skill?.by && editing.skill.by !== "me" ? (agents.find((a) => a.id === editing.skill?.by)?.name ?? "an agent") : me.name}
        onClose={() => setEditing(null)}
        onSave={async (input) => {
          const fresh = !input.slug;
          if (!(await p.saveSkill(input))) return false;
          setTab("skills");
          const n = input.grants.length;
          toast(fresh ? `${input.name.trim() || "Untitled skill"} is ready for ${n || "no"} agent${n === 1 ? "" : "s"}` : "Saved", {
            icon: <Check />,
          });
          return true;
        }}
        onDelete={(skill) => {
          setEditing(null);
          void p.deleteSkill(skill.slug).then((ok) => ok && toast("Skill deleted", { icon: <BookOpen /> }));
        }}
      />
    </div>
  );
}

function ConnectedTab({
  plugins,
  all,
  agents,
  calls,
  now,
  hoverCol,
  setHoverCol,
  moreCount,
  workspaceName,
  loaded,
  onOpen,
  onBrowse,
  onGrant,
  onOpenAccess,
}: {
  plugins: Plugin[];
  all: Plugin[];
  agents: RosterAgent[];
  calls: ReturnType<typeof usePlugins>["calls"];
  now: number;
  hoverCol: string | null;
  setHoverCol: (id: string | null) => void;
  moreCount: number;
  workspaceName: string;
  loaded: boolean;
  onOpen: (id: string) => void;
  onBrowse: () => void;
  onGrant: (plugin: Plugin, agent: RosterAgent, on: boolean) => Promise<void>;
  onOpenAccess: (agentId: string) => void;
}) {
  const { on, all: total } = matrixCount(all, agents);
  return (
    <>
      {all.length === 0 && loaded && (
        <div className={cn(CARD, "mb-3 p-11 text-center text-[13px] text-ink3")}>
          Nothing is connected in {workspaceName} yet.{" "}
          <button type="button" className="cursor-pointer text-ink underline decoration-ink4 underline-offset-[3px]" onClick={onBrowse}>
            Browse the catalog
          </button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2.5 max-[900px]:grid-cols-2 max-[620px]:grid-cols-1">
        {plugins.map((pl) => {
          const users = holders(pl, agents);
          const week = callsThisWeek(calls, pl.id, now);
          return (
            <div
              key={pl.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(pl.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(pl.id)}
              className={cn(CARD, "flex cursor-pointer flex-col gap-3 p-4 transition-colors outline-none hover:bg-s2 focus-visible:ring-2 focus-visible:ring-ring/50")}
            >
              <div className="flex items-center gap-3">
                <PluginMark face={pl} size={40} />
                <div className="min-w-0">
                  <b className="block truncate text-sm font-semibold">{pl.name}</b>
                  <div className="mt-px text-xs text-ink4">
                    {pl.tools.length} tool{pl.tools.length === 1 ? "" : "s"}
                  </div>
                </div>
                <span className="ml-auto flex items-center gap-[5px] text-[11.5px] whitespace-nowrap text-ink3">
                  <i className={cn("size-1.5 rounded-full", pl.status === "connected" ? "bg-green" : "bg-amber")} />
                  {pl.status === "connected" ? "Connected" : "Reconnect"}
                </span>
              </div>
              <div className="min-h-[38px] text-[12.5px] leading-normal text-ink3">
                {pl.error ? <span className="line-clamp-2 text-red">{pl.error}</span> : pl.description}
              </div>
              <div className="flex items-center gap-2 text-[11.5px] text-ink4">
                {users.length > 0 ? (
                  <>
                    <Faces agents={users} />
                    <span>{week} call{week === 1 ? "" : "s"} this week</span>
                  </>
                ) : (
                  "Nobody uses it yet"
                )}
                <span className="ml-auto flex h-3.5 items-end gap-px" aria-hidden>
                  {spark(calls, pl.id, now).map((h, i) => (
                    <i key={i} className="w-[3px] rounded-[1px] bg-ink4" style={{ height: h }} />
                  ))}
                </span>
              </div>
            </div>
          );
        })}
        {moreCount > 0 && (
          <button
            type="button"
            onClick={onBrowse}
            className="grid cursor-pointer place-items-center rounded-(--r4) p-4 text-center text-ink3 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s1 hover:text-ink"
          >
            <div>
              <Plus className="mx-auto size-5" />
              <div className="mt-2 font-medium">Browse {moreCount} more</div>
              <div className="mt-0.5 text-xs text-ink4">Slack, Drive, Notion…</div>
            </div>
          </button>
        )}
      </div>

      {all.length > 0 && (
        <>
          <div className="mt-9 mb-3 flex items-baseline gap-2.5">
            <h3 className="text-[13px] font-semibold">Who can use what</h3>
            <span className="text-xs text-ink4">
              Click a square to give or take a plugin. A new grant reaches an agent when its next session starts; a taken one stops at once.
            </span>
          </div>
          <div className="overflow-hidden rounded-(--r4) shadow-[inset_0_0_0_1px_var(--line)]" onMouseLeave={() => setHoverCol(null)}>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="px-4 pt-3.5 pb-3 text-left text-xs font-medium text-ink4">Agent</th>
                  {all.map((pl) => (
                    <th
                      key={pl.id}
                      onClick={() => onOpen(pl.id)}
                      onMouseEnter={() => setHoverCol(pl.id)}
                      className={cn(
                        "cursor-pointer border-b border-line px-1.5 pt-3.5 pb-3 align-bottom text-xs font-medium text-ink2 hover:text-ink",
                        hoverCol === pl.id && "bg-hover",
                      )}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <PluginMark face={pl} size={26} />
                        <span>{pl.name}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="group/row">
                    <td
                      onClick={() => onOpenAccess(a.id)}
                      className="cursor-pointer border-b border-line py-[9px] pr-1.5 pl-3.5 group-last/row:border-b-0 group-hover/row:bg-hover"
                    >
                      <div className="flex items-center gap-[9px] text-[13px] font-medium">
                        <AgentTile id={a.id} kind={a.kind} color={a.color} size={24} />
                        {a.name}
                        <em className="text-[11.5px] font-normal text-ink4 not-italic">{a.role}</em>
                      </div>
                    </td>
                    {all.map((pl) => {
                      const has = pl.grants.includes(a.id);
                      return (
                        <td
                          key={pl.id}
                          onMouseEnter={() => setHoverCol(pl.id)}
                          className={cn(
                            "border-b border-line px-1.5 py-[9px] text-center group-last/row:border-b-0 group-hover/row:bg-hover",
                            hoverCol === pl.id && "bg-hover",
                          )}
                        >
                          <button
                            type="button"
                            role="switch"
                            aria-checked={has}
                            aria-label={`${a.name} can use ${pl.name}`}
                            title={`${a.name} · ${pl.name}`}
                            onClick={() => void onGrant(pl, a, !has)}
                            className={cn(
                              "inline-grid size-5 cursor-pointer place-items-center rounded-[6px] text-[#111] transition-[transform,background,box-shadow] duration-100 outline-none hover:scale-[1.08] focus-visible:ring-2 focus-visible:ring-ring/50",
                              has ? "shadow-none" : "shadow-[inset_0_0_0_1.5px_var(--line3)] hover:shadow-[inset_0_0_0_1.5px_var(--ink3)]",
                            )}
                            style={has ? { background: a.color } : undefined}
                          >
                            {has && <Check className="size-3" strokeWidth={3} />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {agents.length === 0 && <p className="px-4 py-5 text-[13px] text-ink3">There are no agents in this workspace yet.</p>}
            <div className="flex items-center gap-2 border-t border-line px-4 py-[11px] text-xs text-ink4">
              <Lock className="size-[13px]" /> Tools set to Ask wait for you in the Inbox.
              <span className="ml-auto">
                {on} of {total} on
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function CatalogTab({
  catalog,
  connectedIds,
  query,
  onConnect,
  onAddAs,
}: {
  catalog: CatalogEntry[];
  connectedIds: ReadonlySet<string>;
  query: string;
  onConnect: (entry: CatalogEntry) => void;
  onAddAs: () => void;
}) {
  const featured = catalog.find((c) => c.id === "slack");
  const groups = catalogGroups(catalog, connectedIds, query);
  const showFeatured = featured && !connectedIds.has(featured.id) && matches(featured.name, query);
  return (
    <>
      {showFeatured && (
        <div className="relative mb-1.5 flex items-center gap-[26px] overflow-hidden rounded-[20px] px-7 py-[26px] shadow-[inset_0_0_0_1px_var(--line)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.22]"
            style={{ background: `radial-gradient(ellipse 60% 120% at 0% 50%, ${featured.color}, transparent 70%)` }}
          />
          <span className="relative">
            <PluginMark face={featured} size={76} />
          </span>
          <div className="relative flex flex-1 flex-col gap-2">
            <span className="text-[11.5px] font-medium text-ink3">Featured</span>
            <h2 className="text-xl font-semibold tracking-[-0.02em]">Your agents, in Slack</h2>
            <p className="max-w-[460px] text-[13px] leading-[1.55] text-ink3">
              Let agents search, read and post in your Slack channels. Anything that posts asks you first.
            </p>
            <div className="mt-1.5">
              <Button variant="solid" onClick={() => onConnect(featured)}>
                Connect Slack
              </Button>
            </div>
          </div>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.category}>
          <div className="mt-9 mb-3 flex items-baseline gap-2.5">
            <h3 className="text-[13px] font-semibold">{g.category}</h3>
            <span className="text-xs text-ink4">{g.items.length}</span>
          </div>
          <div className="grid grid-cols-3 gap-2.5 max-[900px]:grid-cols-2 max-[620px]:grid-cols-1">
            {g.items.map((c) => {
              const note = authNote(c);
              return (
                <div
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onConnect(c)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onConnect(c)}
                  className={cn(CARD, "flex cursor-pointer flex-col gap-2.5 p-4 transition-colors outline-none hover:bg-s2 focus-visible:ring-2 focus-visible:ring-ring/50")}
                >
                  <div className="flex items-center gap-3">
                    <PluginMark face={c} size={36} />
                    <b className="min-w-0 truncate text-[13.5px] font-semibold">{c.name}</b>
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConnect(c);
                      }}
                    >
                      Connect
                    </Button>
                  </div>
                  <div className="text-[12.5px] leading-normal text-ink3">{c.description}</div>
                  {note && <div className="text-[11.5px] text-ink4">{note}</div>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {!showFeatured && groups.length === 0 && (
        <div className={cn(CARD, "p-11 text-center text-[13px] text-ink3")}>
          {query.trim() ? (
            <>
              Nothing in the catalog matches “{query.trim()}”.{" "}
              <button type="button" className="cursor-pointer text-ink underline decoration-ink4 underline-offset-[3px]" onClick={onAddAs}>
                Add it as an MCP server
              </button>
            </>
          ) : (
            "Everything in the catalog is connected."
          )}
        </div>
      )}
    </>
  );
}

function SkillsTab({
  skills,
  agents,
  meName,
  onOpen,
  onNew,
}: {
  skills: Skill[];
  agents: RosterAgent[];
  meName: string;
  onOpen: (skill: Skill) => void;
  onNew: () => void;
}) {
  const me = useMe();
  return (
    <div className="grid grid-cols-3 gap-2.5 max-[900px]:grid-cols-2 max-[620px]:grid-cols-1">
      {skills.map((s) => {
        const author = agents.find((a) => a.id === s.by);
        const users = agents.filter((a) => s.grants.includes(a.id));
        return (
          <div
            key={s.slug}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(s)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(s)}
            className={cn(CARD, "relative cursor-pointer px-[18px] pt-[18px] pb-4 transition-colors outline-none hover:bg-s2 focus-visible:ring-2 focus-visible:ring-ring/50")}
          >
            <div className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
              <BookOpen className="size-[15px] text-ink3" /> <span className="truncate">{s.name}</span>
            </div>
            <pre className="mt-3 h-[104px] overflow-hidden font-mono text-[11px] leading-[1.7] whitespace-pre-wrap text-ink3 [mask-image:linear-gradient(#000_50%,transparent)]">
              {s.md}
            </pre>
            <div className="mt-2.5 flex items-center gap-2 text-xs text-ink3">
              {author ? <AgentTile id={author.id} kind={author.kind} color={author.color} size={18} /> : <MeAvatar me={me} size={18} />}
              by {author?.name ?? meName}
              <span className="ml-auto">
                <Faces agents={users} />
              </span>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNew}
        className="grid min-h-[200px] cursor-pointer place-items-center rounded-(--r4) text-ink3 shadow-[inset_0_0_0_1px_var(--line)] transition-colors hover:bg-s1 hover:text-ink"
      >
        <div className="text-center">
          <Plus className="mx-auto size-5" />
          <div className="mt-2 font-medium">New skill</div>
          <div className="mt-0.5 text-xs text-ink4">A how-to any agent can follow</div>
        </div>
      </button>
    </div>
  );
}
