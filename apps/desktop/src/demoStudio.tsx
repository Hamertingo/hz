import React, { useState, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { Bell, Check, Copy, Trash2 } from "lucide-react";

import AgentTile from "@/components/AgentTile";
import BrandMark from "@/components/BrandMark";
import PixelBanner from "@/components/PixelBanner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuHint,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet } from "@/components/ui/sheet";
import { Toaster, toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BRANDS } from "@/lib/brands";
import { MASCOT_COLORS, MASCOT_KINDS } from "@/lib/mascots";
import "./App.css";

const SWATCHES = ["bg-s1", "bg-s2", "bg-s3", "bg-line", "bg-line2", "bg-line3", "bg-ink4", "bg-ink3", "bg-ink2", "bg-ink", "bg-amber", "bg-green", "bg-red", "bg-blue"];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium text-ink3">{title}</h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

type Which = null | "docked" | "centered" | "bare";

function Demo() {
  const [sheet, setSheet] = useState<Which>(null);
  const [confirm, setConfirm] = useState<"plain" | "typed" | null>(null);
  const [mode, setMode] = useState<"dark" | "light">("dark");
  const [checked, setChecked] = useState(true);
  const close = (o: boolean) => !o && setSheet(null);

  const body = (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-ink2">Body text sits on the panel. Press Escape inside a confirm: only the confirm closes.</p>
      <Button variant="destructive" onClick={() => setConfirm("typed")}>
        Delete workspace…
      </Button>
      <div className="h-[600px] rounded-(--r3) bg-s1 p-4 text-ink3 ring-1 ring-line">Tall content to scroll</div>
    </div>
  );
  const footer = (
    <>
      <Button variant="outline" onClick={() => setSheet(null)}>
        Cancel
      </Button>
      <Button className="ml-auto" onClick={() => { toast("Saved"); setSheet(null); }}>
        Save
      </Button>
    </>
  );

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background px-8 py-8 text-foreground">
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <div className="flex items-center gap-3">
            <h1 className="text-[17px] font-semibold tracking-[-0.015em]">Studio primitives</h1>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => {
                const next = mode === "dark" ? "light" : "dark";
                document.documentElement.dataset.mode = next;
                setMode(next);
              }}
            >
              {mode === "dark" ? "Light" : "Dark"}
            </Button>
          </div>

          <Section title="Tokens">
            {SWATCHES.map((s) => (
              <div key={s} className="flex flex-col items-center gap-1 text-[11px] text-ink3">
                <span className={`size-9 rounded-(--r2) ring-1 ring-line2 ${s}`} />
                {s.slice(3)}
              </div>
            ))}
          </Section>

          <Section title="Agent tiles">
            {MASCOT_KINDS.map((k, i) => (
              <AgentTile key={k} id={k} kind={k} color={MASCOT_COLORS[i % MASCOT_COLORS.length]} size={40} />
            ))}
            {[16, 22, 32, 64].map((s) => (
              <AgentTile key={s} id="fox" kind="fox" color="#e2814a" size={s} />
            ))}
          </Section>

          <Section title="Pixel banner">
            <div className="w-full overflow-hidden rounded-(--r3)">
              <PixelBanner id="atlas" kind="owl" color="#9a87ea" height={120} />
            </div>
          </Section>

          <Section title="Brand marks">
            {Object.keys(BRANDS).map((b) => (
              <BrandMark key={b} slug={b} size={32} />
            ))}
            <BrandMark slug="claude" bare size={22} />
            <BrandMark slug="nope" size={32} />
          </Section>

          <Section title="Menu">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Open menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60">
                <DropdownMenuLabel>Workspace</DropdownMenuLabel>
                <DropdownMenuItem>
                  <Copy /> Copy link <DropdownMenuHint>⌘L</DropdownMenuHint>
                </DropdownMenuItem>
                <DropdownMenuCheckboxItem checked={checked} onCheckedChange={setChecked}>
                  <Bell /> Notifications
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Trash2 /> Delete agent
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Section>

          <Section title="Toasts">
            <Button variant="outline" onClick={() => toast("Agent archived", { icon: <Check /> })}>
              Plain toast
            </Button>
            <Button
              variant="outline"
              onClick={() => toast("Agent deleted", { action: { label: "Undo", onClick: () => toast("Restored") }, ms: 6000 })}
            >
              With Undo
            </Button>
          </Section>

          <Section title="Confirm dialog">
            <Button variant="outline" onClick={() => setConfirm("plain")}>
              Plain confirm
            </Button>
            <Button variant="outline" onClick={() => setConfirm("typed")}>
              Type to confirm
            </Button>
          </Section>

          <Section title="Sheet">
            <Button variant="outline" onClick={() => setSheet("docked")}>
              Docked right
            </Button>
            <Button variant="outline" onClick={() => setSheet("centered")}>
              Centered
            </Button>
            <Button variant="outline" onClick={() => setSheet("bare")}>
              Centered, bare
            </Button>
          </Section>
        </div>

        <Sheet open={sheet === "docked"} onOpenChange={close} title="Inbox item" sub="Docked, read beside the chat" footer={footer}>
          {body}
        </Sheet>
        <Sheet open={sheet === "centered"} onOpenChange={close} mode="centered" width={680} title="Agent settings" sub="Centered, with a full-screen toggle" footer={footer}>
          {body}
        </Sheet>
        <Sheet open={sheet === "bare"} onOpenChange={close} mode="centered" width={680} bare title="Atlas">
          <PixelBanner id="atlas" kind="owl" color="#9a87ea" height={132} />
          <div className="px-6 py-5">{body}</div>
        </Sheet>

        <ConfirmDialog
          open={confirm === "plain"}
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Archive this chat?"
          description="It leaves the sidebar. You can bring it back from Archived."
          confirmLabel="Archive"
          danger={false}
          onConfirm={() => toast("Archived", { action: { label: "Undo", onClick: () => {} } })}
        />
        <ConfirmDialog
          open={confirm === "typed"}
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Delete Hyze Cloud?"
          description="Its agents, channels and memory are removed. This cannot be undone."
          confirmLabel="Delete workspace"
          typeToConfirm="Hyze Cloud"
          onConfirm={() => toast("Workspace deleted")}
        />
      </div>
      <Toaster />
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);
