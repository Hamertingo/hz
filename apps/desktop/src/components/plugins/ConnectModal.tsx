import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { AccountBox, AgentSwitchRow, PluginBand, ToolRow } from "@/components/plugins/parts";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { ignoreToaster } from "@/components/ui/sheet";
import Spinner from "@/components/ui/spinner";
import { withPolicy } from "@/lib/pluginsView";
import type { RosterAgent } from "@/lib/roster";
import { cn } from "@/lib/utils";
import type { CatalogEntry, ConnectCreds, Me, Plugin, ToolPolicy } from "@/types/events";

const STEPS = ["Sign in", "What it can do", "Who uses it"] as const;

/// The three steps of connecting a catalog server: sign in (really, in the
/// browser or with a pasted secret), choose what each of its tools may do, and
/// choose which agents hold it.
///
/// Step one is where the connection is made and the tool list is read, so step
/// two shows the server's own tools rather than a guess. Closing after that
/// leaves the plugin connected with nobody holding it, which is harmless and shows
/// on the Connected tab.
export default function ConnectModal({
  entry,
  existing,
  agents,
  me,
  onClose,
  onSignIn,
  onCancelSignIn,
  onFinish,
}: {
  entry: CatalogEntry | null;
  /// Set when signing in again to a plugin that is already here: it keeps its
  /// policies and grants, so the flow ends after the first step.
  existing: Plugin | null;
  agents: RosterAgent[];
  me: Me;
  onClose: () => void;
  onSignIn: (entry: CatalogEntry, creds: ConnectCreds) => Promise<Plugin>;
  onCancelSignIn: (entry: CatalogEntry) => void;
  onFinish: (plugin: Plugin, policies: ToolPolicy[], grants: string[]) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [plugin, setPlugin] = useState<Plugin | null>(null);
  const [policies, setPolicies] = useState<ToolPolicy[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const id = entry?.id;
  useEffect(() => {
    setStep(1);
    setPlugin(null);
    setPolicies([]);
    setPick(new Set(agents.slice(0, 1).map((a) => a.id)));
    setBusy(false);
    setError(null);
    setToken("");
    setClientId("");
    setClientSecret("");
    // Reset when a different entry opens, not when the roster re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!entry) return null;
  const auth = entry.auth;
  const needsToken = auth.kind === "token";
  const needsClient = auth.kind === "oauth_own";
  const ready = needsToken ? token.trim() !== "" || !!existing : needsClient ? clientId.trim() !== "" || !!existing : true;

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await onSignIn(entry, {
        token: needsToken && token.trim() ? token.trim() : undefined,
        clientId: needsClient && clientId.trim() ? clientId.trim() : undefined,
        clientSecret: needsClient && clientSecret.trim() ? clientSecret.trim() : undefined,
      });
      setPlugin(made);
      setPolicies(made.tools);
      if (existing) {
        onClose();
        return;
      }
      setStep(2);
    } catch (e) {
      const text = String(e);
      if (!/cancelled/.test(text)) setError(text);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (busy) onCancelSignIn(entry);
    onClose();
  };

  const finish = async () => {
    if (!plugin) return;
    setBusy(true);
    try {
      await onFinish(plugin, policies, [...pick]);
    } finally {
      setBusy(false);
    }
  };

  const signInText = needsToken
    ? (auth.hint ?? "Paste the secret. It stays in your Keychain.")
    : needsClient
      ? (auth.hint ?? "Paste your OAuth client.")
      : auth.kind === "none"
        ? "This server runs on your Mac. hz starts it to read its tools."
        : `${entry.name} asks you to approve access in your browser.`;

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && cancel()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-70 bg-black/55 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={ignoreToaster}
          className="fixed top-1/2 left-1/2 z-70 flex max-h-[calc(100vh-48px)] w-[min(500px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-[18px] bg-(--pop) px-6 pt-0 pb-[18px] text-ink shadow-(--shadow) ring-1 ring-line2 backdrop-blur-xl outline-none data-open:animate-pop-in"
        >
          <PluginBand face={entry} color={entry.color} height={92} markSize={56} className="-mx-6 rounded-t-[18px]" />
          <div className="mt-[18px]">
            <DialogPrimitive.Title className="text-[17px] font-semibold tracking-[-0.015em]">
              {existing ? `Sign in to ${entry.name} again` : `Connect ${entry.name}`}
            </DialogPrimitive.Title>
            <div className="mt-0.5 text-[13px] leading-normal text-ink3">{entry.description}</div>
          </div>

          {!existing && (
            <div className="flex items-center gap-2 text-xs text-ink4">
              {STEPS.map((label, i) => {
                const n = i + 1;
                return (
                  <span key={label} className="contents">
                    {i > 0 && <em className="h-px max-w-7 flex-1 bg-line3" />}
                    <span className={cn("flex items-center gap-[7px] font-medium", step === n && "text-ink", step > n && "text-ink3")}>
                      <i
                        className={cn(
                          "grid size-5 place-items-center rounded-full bg-s3 text-[11px] not-italic",
                          step === n && "bg-ink text-background",
                          step > n && "bg-green text-on-signal",
                        )}
                      >
                        {step > n ? <Check className="size-[11px]" strokeWidth={3} /> : n}
                      </i>
                      {label}
                    </span>
                  </span>
                );
              })}
            </div>
          )}

          {step === 1 && (
            <>
              <AccountBox
                me={me}
                size={30}
                title={needsToken || needsClient ? (auth.label ?? "Credentials") : auth.kind === "none" ? "Runs on this Mac" : "Sign in with your browser"}
                sub={signInText}
              />
              {needsToken && (
                <input
                  type="password"
                  autoFocus
                  className={cn(fieldClassName, "font-mono text-xs")}
                  placeholder={existing ? "Leave empty to keep the one saved" : (auth.label ?? "Secret")}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={busy}
                />
              )}
              {needsClient && (
                <div className="flex flex-col gap-2">
                  <input
                    autoFocus
                    className={cn(fieldClassName, "font-mono text-xs")}
                    placeholder={existing ? "Client ID (empty keeps the saved one)" : "Client ID"}
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    disabled={busy}
                  />
                  <input
                    type="password"
                    className={cn(fieldClassName, "font-mono text-xs")}
                    placeholder="Client secret, if it has one"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    disabled={busy}
                  />
                </div>
              )}
              {error && <p className="text-xs leading-normal break-words text-red">{error}</p>}
              <p className="text-xs leading-normal text-ink4">{entry.note}</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={cancel}>
                  Cancel
                </Button>
                <Button variant="solid" disabled={busy || !ready} onClick={() => void signIn()}>
                  {busy && <Spinner className="size-3.5" />}
                  {busy
                    ? auth.kind === "oauth" || needsClient
                      ? "Waiting for your browser…"
                      : "Connecting"
                    : auth.kind === "oauth" || needsClient
                      ? `Continue with ${entry.name}`
                      : "Connect"}
                </Button>
              </div>
            </>
          )}

          {step === 2 && plugin && (
            <>
              <div className="max-h-[320px] overflow-y-auto">
                {policies.length === 0 && <p className="py-2 text-[13px] text-ink3">The server lists no tools.</p>}
                {policies.map((t) => (
                  <ToolRow
                    key={t.name}
                    name={t.name}
                    description={t.description}
                    policy={t.policy}
                    onChange={(policy) => setPolicies((all) => withPolicy(all, t.name, policy))}
                  />
                ))}
              </div>
              <p className="text-xs leading-normal text-ink4">
                Reading is allowed and everything else asks you first. Ask waits in your Inbox until you answer.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Back
                </Button>
                <Button variant="solid" onClick={() => setStep(3)}>
                  Continue
                </Button>
              </div>
            </>
          )}

          {step === 3 && plugin && (
            <>
              <div>
                {agents.length === 0 && <p className="py-2 text-[13px] text-ink3">There are no agents in this workspace yet.</p>}
                {agents.map((a) => (
                  <AgentSwitchRow
                    key={a.id}
                    agent={a}
                    size={26}
                    on={pick.has(a.id)}
                    onChange={(on) =>
                      setPick((s) => {
                        const next = new Set(s);
                        if (on) next.add(a.id);
                        else next.delete(a.id);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
              <p className="text-xs leading-normal text-ink4">They get it when their next session starts.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setStep(2)}>
                  Back
                </Button>
                <Button variant="solid" disabled={busy} onClick={() => void finish()}>
                  {busy && <Spinner className="size-3.5" />}
                  Connect {entry.name}
                </Button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
