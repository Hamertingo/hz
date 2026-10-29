import { BookOpen, Check, Plug, Plus, Search, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState, type MutableRefObject } from "react";

import Dither from "@/components/Dither";
import AddServerDialog from "@/components/plugins/AddServerDialog";
import ConnectModal from "@/components/plugins/ConnectModal";
import { GoogleTile } from "@/components/plugins/GoogleApp";
import PluginSheet from "@/components/plugins/PluginSheet";
import PluginsSkeleton from "@/components/plugins/PluginsSkeleton";
import SkillSheet from "@/components/plugins/SkillSheet";
import { Faces, PluginMark, liftDark } from "@/components/plugins/parts";
import { Empty, Group, Row, UnderlineTabs, Val } from "@/components/kit/kit";
import { PageSheet } from "@/components/ui/page-sheet";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useMe } from "@/hooks/useMe";
import { usePlugins } from "@/hooks/usePlugins";
import {
  authNote,
  catalogGroups,
  grantToast,
  holders,
  matches,
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
  onOpenAccess: _onOpenAccess,
  onClose,
  refreshRef,
}: {
  active: boolean;
  onClose?: () => void;
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
    <label className="ml-auto flex h-[30px] w-[220px] items-center gap-2 rounded-(--r1) bg-s1 px-2.5 text-ink3 shadow-[inset_0_0_0_1px_var(--line2)] focus-within:shadow-[inset_0_0_0_1px_var(--line3)]">
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
    <PageSheet
      active={active}
      title="Connect apps"
      onClose={onClose}
      actions={
        tab === "skills" ? (
          <Button variant="outline" onClick={() => setEditing({ skill: null })} disabled={!workspaceId}>
            <Plus className="size-3.5" /> New skill
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setAdding({ name: "" })} disabled={!workspaceId}>
            <Plus className="size-3.5" /> Add MCP server
          </Button>
        )
      }
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-5">
        <UnderlineTabs
          className="border-0 px-0"
          value={tab}
          onChange={(next) => {
            setTab(next);
            setQuery("");
          }}
          options={TABS.map((t) => ({
            value: t.key,
            label: (
              <span className="flex items-center gap-1.5">
                {t.label}
                {t.key === "connected" && <em className="text-[11px] not-italic tabular-nums text-ink3">{counts.connected}</em>}
              </span>
            ),
          }))}
        />
        {search}
      </div>

      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-5">
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
              moreCount={catalogLeft.length}
              workspaceName={workspaceName}
              loaded={p.loaded}
              onOpen={setOpenId}
              onBrowse={() => setTab("catalog")}
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
    </PageSheet>
  );
}

function ConnectedTab({
  plugins,
  all,
  agents,
  calls,
  now,
  moreCount,
  workspaceName,
  loaded,
  onOpen,
  onBrowse,
}: {
  plugins: Plugin[];
  all: Plugin[];
  agents: RosterAgent[];
  calls: ReturnType<typeof usePlugins>["calls"];
  now: number;
  moreCount: number;
  workspaceName: string;
  loaded: boolean;
  onOpen: (id: string) => void;
  onBrowse: () => void;
}) {
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
      <div className="grid grid-cols-3 gap-2.5 max-[760px]:grid-cols-2 max-[560px]:grid-cols-1">
        <GoogleTile agents={agents} card={CARD} />
        {plugins.map((pl) => {
          const users = holders(pl, agents);
          return (
            <div
              key={pl.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(pl.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(pl.id)}
              className={cn(CARD, "flex cursor-pointer flex-col overflow-hidden rounded-(--r3) bg-transparent transition-[background,box-shadow] outline-none hover:bg-s1 hover:shadow-[inset_0_0_0_1px_var(--line2)] focus-visible:ring-2 focus-visible:ring-ring/50")}
            >
              <div className="relative h-[52px] overflow-hidden bg-s2">
                <Dither color={liftDark(pl.color)} seed={`${pl.id}:band`} cols={90} rows={20} light={0.8} />
              </div>
              <div className="flex flex-1 flex-col gap-[5px] px-3.5 pb-[13px]">
                <span className="relative z-[2] -mt-[19px] flex w-max rounded-[12px] bg-(--sheet) p-[3px]">
                  <PluginMark face={pl} size={40} />
                </span>
                <div className="flex items-center gap-2">
                  <b className="truncate text-[13.5px] font-semibold">{pl.name}</b>
                  <span className="ml-auto inline-flex items-center gap-[5px] text-[11.5px] whitespace-nowrap text-ink3">
                    <i className={cn("size-1.5 rounded-full", pl.status === "connected" ? "bg-green" : "bg-amber")} />
                    {pl.status === "connected" ? "Connected" : "Reconnect"}
                  </span>
                </div>
                <div className="flex-1 text-[12.5px] leading-normal text-ink3">
                  {pl.error ? <span className="line-clamp-2 text-red">{pl.error}</span> : pl.description}
                </div>
                <div className="mt-[5px] flex items-center gap-2 text-[11.5px] leading-normal text-ink3">
                  {users.length > 0 ? (
                    <>
                      <Faces agents={users} />
                      <span>
                        {users.length} agent{users.length === 1 ? "" : "s"}
                      </span>
                    </>
                  ) : (
                    "Nobody uses it yet"
                  )}
                  <span className="ml-auto flex h-3.5 items-end gap-0.5" aria-hidden>
                    {spark(calls, pl.id, now).map((h, i) => (
                      <i key={i} className="w-0.5 rounded-[2px] bg-ink4" style={{ height: h }} />
                    ))}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {moreCount > 0 && (
          <button
            type="button"
            onClick={onBrowse}
            className="flex min-h-[170px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-(--r3) border border-dashed border-line2 text-center text-[13px] font-medium text-ink3 transition-colors hover:bg-s1 hover:text-ink"
          >
            <Plus className="size-[22px]" />
            <span>Browse {moreCount} more</span>
          </button>
        )}
      </div>
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
  const groups = catalogGroups(catalog, connectedIds, query);
  const pool = groups.flatMap((g) => g.items);
  const featured = query.trim() ? undefined : (pool.find((c) => c.id === "slack") ?? pool[0]);
  const showFeatured = !!featured;
  const items = pool.filter((c) => c.id !== featured?.id);
  return (
    <>
      {featured && (
        <div className="relative mb-5 flex items-center gap-[22px] overflow-hidden rounded-(--r4) px-6 py-[22px] shadow-[inset_0_0_0_1px_var(--line)]">
          <div
            aria-hidden
            className="absolute inset-0 opacity-35 [mask-image:linear-gradient(90deg,transparent_25%,#000_90%)]"
          >
            <Dither color={liftDark(featured.color)} seed={`${featured.id}:feat`} cols={120} rows={30} light={0.8} />
          </div>
          <span className="relative flex">
            <PluginMark face={featured} size={72} />
          </span>
          <div className="relative flex flex-1 flex-col gap-1">
            <span className="text-[11.5px] font-medium text-ink3">Featured</span>
            <h2 className="text-lg font-semibold tracking-[-0.02em]">Your agents, in {featured.name}</h2>
            <p className="max-w-[420px] text-[13px] leading-[1.55] text-ink3">
              {featured.description.replace(/\.$/, "")}. Give it to the agents who need it; anything that writes asks you first.
            </p>
            <Button variant="solid" className="mt-2 w-max" onClick={() => onConnect(featured)}>
              Connect {featured.name}
            </Button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 max-[760px]:grid-cols-2 max-[560px]:grid-cols-1">
        {items.map((c) => {
          const note = authNote(c);
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => onConnect(c)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onConnect(c)}
              className="flex cursor-pointer flex-col gap-2 rounded-(--r3) p-[13px] shadow-[inset_0_0_0_1px_var(--line)] transition-colors outline-none hover:bg-s1 focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <div className="flex items-center gap-2.5">
                <PluginMark face={c} size={36} />
                <b className="min-w-0 truncate text-[13.5px] font-medium">{c.name}</b>
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
      {!showFeatured && items.length === 0 && (
        <Empty
          action={
            query.trim() ? (
              <Button variant="outline" size="sm" onClick={onAddAs}>
                <Plus /> Add an MCP server
              </Button>
            ) : undefined
          }
        >
          {query.trim() ? `Nothing in the catalog matches “${query.trim()}”.` : "Everything in the catalog is connected."}
        </Empty>
      )}
    </>
  );
}

function SkillsTab({
  skills,
  agents,
  onOpen,
  onNew,
}: {
  skills: Skill[];
  agents: RosterAgent[];
  onOpen: (skill: Skill) => void;
  onNew: () => void;
}) {
  return (
    <>
      <Group>
        {skills.map((s) => {
          const n = agents.filter((a) => s.grants.includes(a.id)).length;
          return (
            <Row
              key={s.slug}
              lead={<Zap />}
              title={s.name}
              sub={`${n} agent${n === 1 ? "" : "s"} use${n === 1 ? "s" : ""} it`}
              right={<Val kind="next" />}
              onClick={() => onOpen(s)}
            />
          );
        })}
        {skills.length === 0 && <Empty>No skill matches.</Empty>}
      </Group>
      <div className="mt-3.5 flex gap-1.5">
        <Button variant="outline" onClick={onNew}>
          <Plus className="size-3.5" /> New skill
        </Button>
      </div>
    </>
  );
}
