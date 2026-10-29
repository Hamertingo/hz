import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

import { KeyCard } from "@/components/chat/cards";
import { toast } from "@/components/ui/toast";
import { kit, type KeyAsk } from "@/lib/kit";

/// The keys an agent is waiting on (its `request_key` tool), as cards in its chat. The value goes from the field
/// to the keychain; the agent is told only that it was saved, and writes `{{NAME}}` from then on.
export default function KeyRequests({ agentId }: { agentId: string }) {
  const [asks, setAsks] = useState<KeyAsk[]>([]);

  useEffect(() => {
    let live = true;
    kit.keyRequests().then((a) => live && setAsks(a), () => {});
    const off = listen<KeyAsk[]>("key_requests_changed", (e) => live && setAsks(e.payload));
    return () => {
      live = false;
      void off.then((f) => f());
    };
  }, []);

  const mine = asks.filter((a) => a.agentId === agentId);
  if (mine.length === 0) return null;
  return (
    <>
      {mine.map((a) => (
        <div key={a.id} className="chat-rise">
          <KeyCard
            name={a.name}
            why={a.why}
            onSave={(value) => void kit.keySave(a.id, value).then(() => toast(`${a.name} saved to the keychain`), (e) => toast(String(e)))}
            onDismiss={() => void kit.keyDismiss(a.id)}
          />
        </div>
      ))}
    </>
  );
}
