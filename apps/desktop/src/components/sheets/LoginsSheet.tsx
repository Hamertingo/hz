import { Globe, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import AgentAvatar from "@/components/AgentAvatar";
import { Group, Row } from "@/components/kit/kit";
import Modal, { Hint } from "@/components/sheets/Modal";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { kit } from "@/lib/kit";
import type { RosterAgent } from "@/lib/roster";

type Login = { site: string; user: string; used: string };

/// Reads the sites an agent's browser is signed in to, or null while that is unknown. A backend that cannot
/// answer yet reads as none, so the sheet shows its empty state instead of an error.
export function useLogins(agentId: string, active: boolean) {
  const [logins, setLogins] = useState<Login[] | null>(null);
  const reload = useCallback(() => {
    kit
      .logins(agentId)
      .then(setLogins)
      .catch(() => setLogins([]));
  }, [agentId]);
  useEffect(() => {
    if (!active) return;
    setLogins(null);
    reload();
  }, [active, reload]);
  return { logins, reload };
}

/// The sites an agent's browser stays signed in to. Only the session reaches the agent, never the password.
export default function LoginsSheet({ agent, open, onOpenChange }: { agent: RosterAgent; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { logins, reload } = useLogins(agent.id, open);

  const signOut = async (site: string) => {
    try {
      await kit.loginRemove(agent.id, site);
      toast(`Signed out of ${site}`, { ms: 1500 });
      reload();
    } catch (e) {
      toast(String(e));
    }
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Browser logins" width={520} lead={<AgentAvatar agent={agent} size={34} />}>
      <Hint>Sites {agent.name}'s browser is signed in to. Passwords never reach the agent; only the session does.</Hint>
      <Group>
        {(logins ?? []).map((l) => (
          <Row
            key={l.site}
            bareLead
            lead={<span className="grid size-[26px] place-items-center rounded-[7px] bg-s3 text-ink2 [&_svg]:size-3.5"><Globe /></span>}
            title={l.site}
            sub={`${l.user} · used ${l.used}`}
            right={
              <Button variant="ghost" size="sm" onClick={() => void signOut(l.site)}>
                Sign out
              </Button>
            }
          />
        ))}
        {logins !== null && logins.length === 0 && <div className="px-3 py-3.5 text-[12.5px] text-ink3">No sites yet. Sign in to one and the session is kept here.</div>}
        <Row lead={<Plus />} title="Sign in to a site…" onClick={() => toast("A browser opens. Sign in there and the agent keeps the session.", { ms: 2200 })} />
      </Group>
    </Modal>
  );
}
