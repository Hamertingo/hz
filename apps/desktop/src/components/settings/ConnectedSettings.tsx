import { useCallback, useEffect, useState } from "react";

import AgentTile from "@/components/AgentTile";
import { Group, Row } from "@/components/kit/kit";
import { SetHeading, StudioRow } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fieldClassName } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { kit, type GoogleService, type Integrations } from "@/lib/kit";
import { useRoster } from "@/lib/roster";
import { cn } from "@/lib/utils";

const SERVICES: { key: GoogleService; label: string }[] = [
  { key: "gmail", label: "Gmail" },
  { key: "calendar", label: "Calendar" },
  { key: "drive", label: "Drive" },
  { key: "organize", label: "Tidy Gmail" },
];

/// What the backend says is connected, re-read after every change. `null` until it answers, and
/// for good on a build without the command, where the rows stay hidden.
export function useIntegrations() {
  const [state, setState] = useState<Integrations | null>(null);
  const reload = useCallback(() => {
    kit.integrations().then(setState, () => setState(null));
  }, []);
  useEffect(reload, [reload]);
  return { state, reload };
}

/// Runs a backend call, says what went wrong in a toast, and re-reads the state either way.
function useAct(reload: () => void) {
  return useCallback(
    async (fn: () => Promise<unknown>, done?: string) => {
      try {
        await fn();
        if (done) toast(done);
      } catch (e) {
        toast(String(e));
      } finally {
        reload();
      }
    },
    [reload],
  );
}

/// Settings → Privacy: the accounts agents can reach through hz, and the phone it buzzes.
/// Every key and token goes to the Keychain; nothing here is shown again once saved.
export default function ConnectedAccounts() {
  const { state, reload } = useIntegrations();
  const act = useAct(reload);
  if (!state) return null;
  return (
    <>
      <SetHeading>Connected accounts</SetHeading>
      <div>
        <GoogleRow g={state.google} act={act} />
        <ComposioRow c={state.composio} act={act} />
        <OnePasswordRow op={state.onepassword} act={act} />
      </div>
      <SetHeading>Your phone</SetHeading>
      <div>
        <BarkRow b={state.bark} act={act} />
      </div>
    </>
  );
}

type Act = ReturnType<typeof useAct>;

function GoogleRow({ g, act }: { g: Integrations["google"]; act: Act }) {
  const [picked, setPicked] = useState<GoogleService[]>(g.services.length ? g.services : ["gmail", "calendar", "drive"]);
  const [waiting, setWaiting] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);

  const signIn = async () => {
    setWaiting(true);
    await act(() => kit.googleSignIn(picked), "Google is connected");
    setWaiting(false);
  };

  const hint = g.connected
    ? `Signed in as ${g.email ?? "your account"} · ${g.services.map((s) => SERVICES.find((x) => x.key === s)?.label ?? s).join(", ")}. Pick which agents use it on the Plugins page.`
    : "Mail, events and files for the agents you pick. They can draft mail but never send it, and a new event asks you first.";

  return (
    <>
      <StudioRow label="Google" hint={hint} column={!g.connected && g.hasClient}>
        {g.connected ? (
          <Button variant="outline" size="sm" onClick={() => void act(kit.googleSignOut, "Signed out of Google")}>
            Sign out
          </Button>
        ) : !g.hasClient ? (
          <Button variant="outline" size="sm" onClick={() => setClientOpen(true)}>
            Add OAuth client
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {SERVICES.map((s) => {
              const on = picked.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(on ? picked.filter((x) => x !== s.key) : [...picked, s.key])}
                  className={cn(
                    "h-7 cursor-pointer rounded-full px-3 text-xs font-medium shadow-[inset_0_0_0_1px_var(--line2)] transition-colors",
                    on ? "bg-ink text-(--sheet)" : "text-ink2 hover:bg-s2",
                  )}
                >
                  {s.label}
                </button>
              );
            })}
            <span className="ml-auto flex gap-1.5">
              {waiting ? (
                <Button variant="outline" size="sm" onClick={() => void kit.googleCancel()}>
                  Cancel
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setClientOpen(true)}>
                  Change client
                </Button>
              )}
              <Button variant="solid" size="sm" disabled={waiting || picked.length === 0} onClick={() => void signIn()}>
                {waiting ? "Waiting for the browser…" : "Sign in with Google"}
              </Button>
            </span>
          </div>
        )}
      </StudioRow>
      <ClientDialog open={clientOpen} onClose={() => setClientOpen(false)} act={act} />
    </>
  );
}

function ClientDialog({ open, onClose, act }: { open: boolean; onClose: () => void; act: Act }) {
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const save = async () => {
    await act(() => kit.googleSetClient(id, secret));
    setId("");
    setSecret("");
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[460px] rounded-[18px]">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-semibold">Your Google OAuth client</DialogTitle>
          <DialogDescription>
            hz signs in with a client from your own Google Cloud project, so no one else's app holds your mail. In the
            Cloud console, turn on the Gmail, Calendar and Drive APIs, then create an OAuth client of type Desktop app and
            paste its ID and secret here.
          </DialogDescription>
        </DialogHeader>
        <input aria-label="Client ID" placeholder="…apps.googleusercontent.com" value={id} onChange={(e) => setId(e.target.value)} className={fieldClassName} />
        <input aria-label="Client secret" type="password" placeholder="Client secret" value={secret} onChange={(e) => setSecret(e.target.value)} className={fieldClassName} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="solid" disabled={!id.trim() || !secret.trim()} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComposioRow({ c, act }: { c: Integrations["composio"]; act: Act }) {
  const { active } = useWorkspaces();
  const [key, setKey] = useState("");
  const here = !!active && c.workspaces.includes(active.id);
  return (
    <StudioRow
      label="Composio"
      hint={
        here
          ? "Connected. Agents you give it on the Plugins page can link more apps: they show you a Connect card."
          : "One key from composio.dev lets agents connect GitHub, Slack, Notion and hundreds more through a card you press."
      }
    >
      {here ? (
        <Button variant="outline" size="sm" onClick={() => void act(kit.composioDisconnect, "Composio removed")}>
          Remove
        </Button>
      ) : (
        <>
          <input
            aria-label="Composio key"
            type="password"
            placeholder="Paste your key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={cn(fieldClassName, "w-[180px] px-2.5 py-1.5")}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!key.trim() || !active}
            onClick={() => active && void act(() => kit.composioConnect(active.id, key), "Composio is connected").then(() => setKey(""))}
          >
            Connect
          </Button>
        </>
      )}
    </StudioRow>
  );
}

function OnePasswordRow({ op, act }: { op: Integrations["onepassword"]; act: Act }) {
  const { agents } = useRoster();
  const set = (enabled: boolean, list: string[]) => void act(() => kit.opSet(enabled, list));
  return (
    <StudioRow
      label="1Password"
      column={op.enabled}
      hint={
        op.installed
          ? "Sign-in cards can fill a login from 1Password after Touch ID. The password goes into the page, never to the agent. Only the agents you pick."
          : "Install the 1Password CLI (op) and turn on its app integration to fill sign-ins from your vault."
      }
    >
      <Switch aria-label="Fill sign-ins from 1Password" disabled={!op.installed && !op.enabled} checked={op.enabled} onCheckedChange={(on) => set(on, op.agents)} />
      {op.enabled && (
        <Group className="w-full">
          {agents.map((a) => (
            <Row
              key={a.id}
              bareLead
              lead={<AgentTile id={a.id} kind={a.kind} color={a.color} shape={a.shape} look={a.look} photo={a.photo} size={22} />}
              title={a.name}
              right={
                <Switch
                  aria-label={`${a.name} can fill from 1Password`}
                  checked={op.agents.includes(a.id)}
                  onCheckedChange={(on) => set(true, on ? [...op.agents, a.id] : op.agents.filter((x) => x !== a.id))}
                />
              }
            />
          ))}
        </Group>
      )}
    </StudioRow>
  );
}

function BarkRow({ b, act }: { b: Integrations["bark"]; act: Act }) {
  const [key, setKey] = useState("");
  const [enc, setEnc] = useState("");
  return (
    <StudioRow
      label="Push with Bark"
      column={!b.connected}
      hint={
        b.connected
          ? `When hz is in the background and an agent needs you or finishes, your phone buzzes through ${b.server.replace(/^https?:\/\//, "")}.`
          : "Install Bark on your iPhone and paste the key it shows. A push says who and what kind, nothing more, unless you add an encryption key."
      }
    >
      {b.connected ? (
        <>
          <label className="mr-1 flex items-center gap-2 text-xs text-ink3">
            Show the text
            <Switch
              aria-label="Show the text in pushes"
              disabled={!b.encrypted}
              checked={b.fullText}
              onCheckedChange={(on) => void act(() => kit.barkFullText(on))}
            />
          </label>
          <Button variant="outline" size="sm" onClick={() => void act(kit.barkTest, "Test push sent")}>
            Test
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void act(kit.barkClear, "Bark removed")}>
            Remove
          </Button>
        </>
      ) : (
        <div className="flex w-full flex-wrap items-center gap-1.5">
          <input
            aria-label="Bark key"
            placeholder="Key, or the https://api.day.app/… link"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={cn(fieldClassName, "min-w-[220px] flex-1 px-2.5 py-1.5")}
          />
          <input
            aria-label="Bark encryption key"
            type="password"
            placeholder="Encryption key (optional, 32 characters)"
            value={enc}
            onChange={(e) => setEnc(e.target.value)}
            className={cn(fieldClassName, "min-w-[220px] flex-1 px-2.5 py-1.5")}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!key.trim()}
            onClick={() => void act(() => kit.barkSet(key, enc || null, false), "Bark is set up").then(() => (setKey(""), setEnc("")))}
          >
            Save
          </Button>
        </div>
      )}
    </StudioRow>
  );
}
