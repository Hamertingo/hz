import { Check, Copy, Lock } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { KeysRows } from "@/components/settings/AgentKeys";
import ConnectedAccounts from "@/components/settings/ConnectedSettings";
import { Card1, SetHeading, StudioRow } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { kit } from "@/lib/kit";

/// Settings → Privacy: the end-to-end key and its recovery code, the accounts agents can reach, the
/// keys other apps read hz with, then what leaves this Mac.
/// `children` carries the crash-report row, which the dialog owns with the rest of its app-level
/// settings.
export default function PrivacySettings({ children }: { children?: ReactNode }) {
  // null until the backend answers; a backend without the command stays null and the card says so.
  const [on, setOn] = useState<boolean | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    kit.e2eStatus().then((v) => live && setOn(v), () => live && setOn(null));
    return () => {
      live = false;
    };
  }, []);

  const create = async () => {
    try {
      setCode(await kit.e2eCreate());
      setOn(true);
    } catch (e) {
      toast(String(e));
    }
  };

  return (
    <>
      <Card1
        lead={
          <span className="relative grid size-9 place-items-center rounded-[10px] bg-s3 text-ink2">
            <Lock className="size-[18px]" />
            {on && <i className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-green shadow-[0_0_0_2px_var(--pop)]" />}
          </span>
        }
        title={on ? "End-to-end encryption is on" : on === false ? "End-to-end encryption is off" : "End-to-end encryption"}
        sub={
          on === null
            ? "Not available in this build yet."
            : "Only your devices can read chats and files. hz's servers see nothing."
        }
      >
        {on === false && <Button variant="solid" size="sm" onClick={() => void create()}>Turn on</Button>}
        {on && (
          <Button variant="outline" size="sm" disabled title="Pairing arrives with the iPhone app">
            Pair a device
          </Button>
        )}
      </Card1>

      <SetHeading>Keys</SetHeading>
      <div>
        <StudioRow
          label="Recovery code"
          hint="Write it down. It's the only way back in if you lose every device. It is shown once, when the key is made."
        >
          <Button variant="outline" size="sm" disabled={on !== false} onClick={() => void create()}>
            {on ? "Already shown" : "Create"}
          </Button>
        </StudioRow>
      </div>

      <ConnectedAccounts />
      <KeysRows />

      {children}

      <Dialog open={code !== null} onOpenChange={(o) => !o && setCode(null)}>
        <DialogContent className="max-w-[420px] rounded-[18px]">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-semibold">Your recovery code</DialogTitle>
            <DialogDescription>Write it down now. hz cannot show it again.</DialogDescription>
          </DialogHeader>
          <div className="rounded-(--r3) bg-s2 px-4 py-5 text-center font-mono text-[15px] tracking-[0.08em] break-words text-ink select-all">
            {code}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(code ?? "");
                setCopied(true);
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="solid" onClick={() => setCode(null)}>
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
