import { invoke } from "@tauri-apps/api/core";
import { useState, type ReactNode } from "react";

import AgentIcon from "@/components/AgentIcon";
import { Lead, SetHeading, StudioRow } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import Spinner from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CLI_ORDER, type CliRun, useClis } from "@/hooks/useUsage";
import { useStudio } from "@/lib/studio";
import { cn } from "@/lib/utils";
import type { CliInfo, Harness } from "@/types/events";

/// CLIs hz cannot drive yet, shown so the reader knows they were considered.
const MORE: { name: string; note: string }[] = [
  { name: "Gemini", note: "Speaks ACP, but hz has no Gemini engine yet." },
  { name: "Cursor", note: "cursor-agent has no ACP mode hz can drive yet." },
];

function Chip({ tone, children }: { tone: "green" | "amber" | "dim"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-[7px] py-px text-[11px] font-medium",
        tone === "green" && "bg-green/10 text-green",
        tone === "amber" && "bg-amber/10 text-amber",
        tone === "dim" && "bg-s3 text-ink3",
      )}
    >
      {children}
    </span>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-ink3">{label}</span>
      <code className="min-w-0 truncate font-mono text-[11.5px] text-ink2">{children}</code>
    </>
  );
}

/// A CLI card before its own read lands: the logo tile, the name and a chip, the
/// four metadata lines and the two buttons.
function CliSkeleton() {
  return (
    <SkeletonRegion
      label="Reading the CLIs"
      className="mt-2.5 flex items-start gap-3.5 rounded-(--r3) bg-s1 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)]"
    >
      <Skeleton className="size-10 rounded-[11px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
        <div className="mt-2.5 grid grid-cols-[86px_1fr] gap-x-3 gap-y-[9px]">
          {[["w-14", "w-24"], ["w-9", "w-64"], ["w-14", "w-40"], ["w-16", "w-48"]].map(([a, b], i) => (
            <span key={i} className="contents">
              <Skeleton className={cn("h-2.5", a)} />
              <Skeleton className={cn("h-2.5", b)} />
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Skeleton className="h-7 w-16 rounded-md" />
        <Skeleton className="h-7 w-[70px] rounded-md" />
      </div>
    </SkeletonRegion>
  );
}

function CliRow({
  cli,
  run,
  reading,
  checking,
  onCheck,
  onSignOut,
}: {
  cli: CliInfo;
  run: CliRun | undefined;
  /// Read again with this card's last answer still showing.
  reading: boolean;
  checking: boolean;
  onCheck: () => void;
  onSignOut: () => void;
}) {
  const busy = run !== undefined && !run.done;
  const act = (command: string) => invoke(command, { harness: cli.harness }).catch((e) => toast(String(e)));
  const last = run?.lines[run.lines.length - 1];

  return (
    <div className="mt-2.5 rounded-(--r3) bg-s1 px-4 py-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex items-start gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-s3">
          <AgentIcon harness={cli.harness as Harness} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm font-semibold text-ink">{cli.name}</b>
            {reading && <Spinner className="size-3 text-ink3" />}
            {!cli.installed ? (
              <Chip tone="dim">Not installed</Chip>
            ) : cli.signedIn ? (
              <Chip tone="green">Signed in</Chip>
            ) : (
              <Chip tone="dim">Signed out</Chip>
            )}
            {cli.latest && <Chip tone="amber">{cli.latest} available</Chip>}
            {cli.installed && !cli.adapterReady && <Chip tone="amber">Adapter not set up</Chip>}
          </div>
          <div className="mt-2.5 grid grid-cols-[86px_1fr] gap-x-3 gap-y-[5px] text-xs">
            <Meta label="Version">{cli.version ?? "—"}</Meta>
            <Meta label="Path">{cli.path ?? "—"}</Meta>
            <Meta label="Account">{cli.account ?? "—"}</Meta>
            <Meta label="Talks over">{cli.via}</Meta>
          </div>
        </div>

        {cli.installed && (
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {!cli.adapterReady ? (
              <Button size="sm" variant="default" disabled={busy} onClick={() => void act("cli_install_adapter")}>
                Set up adapter
              </Button>
            ) : cli.latest ? (
              <UpdateButton cli={cli} busy={busy} onClick={() => void act("cli_update")} />
            ) : (
              <Button variant="outline" size="sm" disabled={busy || checking} onClick={onCheck}>
                {checking && <Spinner />}
                Check
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => (cli.signedIn ? onSignOut() : void act("cli_sign_in"))}
            >
              {cli.signedIn ? "Sign out" : "Sign in"}
            </Button>
          </div>
        )}
      </div>

      {run && (
        <div
          className={cn(
            "mt-3 flex items-center gap-2 border-t border-line pt-2.5 text-xs",
            run.done && !run.ok ? "text-red" : "text-ink3",
          )}
          role="status"
        >
          {busy && <Spinner />}
          <span className="min-w-0 flex-1 truncate font-mono">{last}</span>
        </div>
      )}
    </div>
  );
}

function UpdateButton({ cli, busy, onClick }: { cli: CliInfo; busy: boolean; onClick: () => void }) {
  const can = cli.updateCommand !== null;
  const button = (
    <Button size="sm" variant="default" disabled={busy || !can} onClick={onClick}>
      {busy && <Spinner />}
      Update
    </Button>
  );
  if (can) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>hz can't tell how it was installed. Update it with the tool that installed it.</TooltipContent>
    </Tooltip>
  );
}

/// Settings → CLIs: the coding agents your agents run on, with your own install
/// and your own login. `extras` carries the rows that used to be pages of their
/// own (GitHub's CLI, the old model providers).
export default function ClisSettings({ extras }: { extras: ReactNode }) {
  const { byCli, reading, runs, checking, check } = useClis();
  const [prefs, set] = useStudio();
  const [signingOut, setSigningOut] = useState<CliInfo | null>(null);

  return (
    <>
      <Lead>
        The coding agents your agents run on. hz uses your own install and your own login, and never holds your keys.
      </Lead>

      <div className="-mt-4">
        {CLI_ORDER.map((h) => {
          const cli = byCli[h];
          return cli ? (
            <CliRow
              key={h}
              cli={cli}
              run={runs[h]}
              reading={reading[h] === true}
              checking={checking}
              onCheck={() => void check()}
              onSignOut={() => setSigningOut(cli)}
            />
          ) : (
            <CliSkeleton key={h} />
          );
        })}
      </div>

      <SetHeading>More agents</SetHeading>
      <div className="-mt-2">
        {MORE.map((m) => (
          <div
            key={m.name}
            className="mt-2.5 flex items-center gap-3.5 rounded-(--r3) bg-s1 px-4 py-3.5 opacity-70 shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-[11px] bg-s3 font-mono text-[11px] font-semibold">
              {m.name[0]}
            </span>
            <div className="min-w-0 flex-1">
              <b className="text-sm font-semibold text-ink">{m.name}</b>
              <div className="mt-1 text-xs text-ink3">{m.note} Not available yet.</div>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button variant="outline" size="sm" disabled>
                    Install
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Not available yet</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>

      <SetHeading>Behaviour</SetHeading>
      <div>
        <StudioRow label="Check for updates" hint="Once a day. hz never updates a CLI without asking.">
          <Switch
            aria-label="Check for updates"
            checked={prefs.updateCheck}
            onCheckedChange={(updateCheck) => set({ updateCheck })}
          />
        </StudioRow>
        <StudioRow label="Warm up" hint="Start the agent you are about to message while you type.">
          <Switch aria-label="Warm up" checked={prefs.warmUp} onCheckedChange={(warmUp) => set({ warmUp })} />
        </StudioRow>
      </div>

      {extras}

      <ConfirmDialog
        open={signingOut !== null}
        onOpenChange={(open) => !open && setSigningOut(null)}
        title={`Sign out of ${signingOut?.name}?`}
        description={`${signingOut?.name} will stop working for every agent on it until you sign in again.`}
        confirmLabel="Sign out"
        onConfirm={() => {
          const h = signingOut?.harness;
          setSigningOut(null);
          if (h) void invoke("cli_sign_out", { harness: h }).catch((e) => toast(String(e)));
        }}
      />
    </>
  );
}
