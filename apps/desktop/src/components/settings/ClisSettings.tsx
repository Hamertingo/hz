import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactNode } from "react";

import AgentIcon from "@/components/AgentIcon";
import { Group, Row } from "@/components/kit/kit";
import { SetHeading, StudioRow } from "@/components/settings/StudioRow";
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

/// A CLI row before its own read lands: the mark, two lines and a button.
function CliSkeleton() {
  return (
    <SkeletonRegion label="Reading the CLIs" className="flex items-center gap-[11px] px-3 py-[9px]">
      <Skeleton className="size-[18px] rounded-[5px]" />
      <div className="flex-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-1.5 h-2.5 w-44" />
      </div>
      <Skeleton className="h-[26px] w-16 rounded-md" />
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
  /// Read again with this row's last answer still showing.
  reading: boolean;
  checking: boolean;
  onCheck: () => void;
  onSignOut: () => void;
}) {
  const busy = run !== undefined && !run.done;
  const act = (command: string) => invoke(command, { harness: cli.harness }).catch((e) => toast(String(e)));
  const last = run?.lines[run.lines.length - 1];

  return (
    <div title={cli.path ?? undefined}>
      <Row
        lead={<AgentIcon harness={cli.harness as Harness} className="size-[18px]" />}
        title={
          <span className="flex items-center gap-2">
            {cli.name}
            {reading && <Spinner className="size-3 text-ink3" />}
          </span>
        }
        sub={
          <>
            <span className="font-mono text-xs">
              {cli.installed ? (cli.version ?? "—") : "Not installed"}
              {cli.installed && (cli.latest ? ` · ${cli.latest} available` : " · up to date")}
            </span>
            {cli.installed && !cli.adapterReady && <span className="text-amber"> · Adapter not set up</span>}
            <br />
            {!cli.installed ? "Install it, then sign in." : cli.signedIn ? `Signed in${cli.account ? ` as ${cli.account}` : ""}` : "Not signed in"}
          </>
        }
        right={
          cli.installed ? (
            <>
              {!cli.adapterReady ? (
                <Button size="sm" variant="solid" disabled={busy} onClick={() => void act("cli_install_adapter")}>
                  Set up adapter
                </Button>
              ) : cli.latest ? (
                <UpdateButton cli={cli} busy={busy} onClick={() => void act("cli_update")} />
              ) : (
                <Button variant="ghost" size="sm" disabled={busy || checking} onClick={onCheck}>
                  {checking && <Spinner />}
                  Check
                </Button>
              )}
              <Button
                variant={cli.signedIn ? "ghost" : "outline"}
                size="sm"
                disabled={busy}
                onClick={() => (cli.signedIn ? onSignOut() : void act("cli_sign_in"))}
              >
                {cli.signedIn ? "Sign out" : "Sign in"}
              </Button>
            </>
          ) : undefined
        }
      />
      {run && (
        <div
          className={cn("flex items-center gap-2 px-3 pb-2.5 text-xs", run.done && !run.ok ? "text-red" : "text-ink3")}
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
    <Button size="sm" variant="solid" disabled={busy || !can} onClick={onClick}>
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
  const { byCli, reading, runs, checking, check, autoCheck } = useClis();
  const [prefs, set] = useStudio();
  useEffect(() => {
    if (prefs.updateCheck) void autoCheck();
  }, [prefs.updateCheck, autoCheck]);
  const [signingOut, setSigningOut] = useState<CliInfo | null>(null);

  return (
    <>
      <Group className="mt-1">
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
      </Group>
      <p className="px-1 text-xs leading-normal text-ink3">hz uses the CLIs you already have. Nothing is installed for you.</p>

      <SetHeading>More agents</SetHeading>
      <Group>
        {MORE.map((m) => (
          <Row
            key={m.name}
            className="opacity-70"
            lead={<span className="grid size-[18px] place-items-center font-mono text-[11px] font-semibold">{m.name[0]}</span>}
            title={m.name}
            sub={`${m.note} Not available yet.`}
            right={
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
            }
          />
        ))}
      </Group>

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
