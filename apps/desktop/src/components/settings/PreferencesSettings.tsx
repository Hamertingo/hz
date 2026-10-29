import { Bell, Laptop } from "lucide-react";
import type { ReactNode } from "react";

import { MacTile, Pick, useSettingsNav } from "@/components/settings/parts";
import { useLocalStorage } from "@/hooks/useLocalStorage";

import ShortcutsSettings from "@/components/settings/ShortcutsSettings";
import MeAvatar from "@/components/MeAvatar";
import { Card1, SetHeading, StudioRow } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { setFontSize, useFontSizes } from "@/hooks/useFontSizes";
import { useMe } from "@/hooks/useMe";
import { useTheme } from "@/hooks/useTheme";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { inWorkspace, useRoster } from "@/lib/roster";
import { invoke } from "@tauri-apps/api/core";
import {
  NOTIFY_CHOICES,
  type NotifyLevel,
  type StudioPrefs,
  useStudio,
  validTime,
} from "@/lib/studio";
import { hasLightMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const LEVEL_LABEL: Record<NotifyLevel, string> = {
  bannerSound: "Banner and sound",
  banner: "Banner",
  badge: "Badge only",
  off: "Off",
};

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />;
}

function NotifyRow({ prefs, field, label, hint, set }: {
  prefs: StudioPrefs;
  field: keyof StudioPrefs["notify"];
  label: string;
  hint?: string;
  set: (patch: Partial<StudioPrefs>) => void;
}) {
  return (
    <StudioRow label={label} hint={hint}>
      <Segmented<NotifyLevel>
        label={label}
        value={prefs.notify[field]}
        onChange={(level) => set({ notify: { ...prefs.notify, [field]: level } })}
        options={NOTIFY_CHOICES[field].map((l) => ({ value: l, label: LEVEL_LABEL[l] }))}
      />
    </StudioRow>
  );
}

async function sendTest() {
  try {
    await invoke("notify_test");
  } catch (e) {
    toast(String(e));
  }
}

/// Settings → Preferences: how hz looks and behaves on this Mac. The sections
/// that used to be pages of their own (code theme, apps, dictation, updates)
/// arrive as `extras`, since their rows are owned by the dialog.
export default function PreferencesSettings({
  extras,
  advanced,
  onAdvanced,
}: {
  extras: { theme: ReactNode; appearance: ReactNode; apps: ReactNode };
  advanced: boolean;
  onAdvanced: (next: boolean) => void;
}) {
  const [prefs, set] = useStudio();
  const sizes = useFontSizes();
  const me = useMe();
  const { active } = useWorkspaces();
  const roster = useRoster();
  const here = active ? roster.agents.filter((a) => inWorkspace(a, active.id)).length : roster.agents.length;

  const { theme, mode, setMode } = useTheme();
  const nav = useSettingsNav();
  const [paused, setPaused] = useLocalStorage("hz.pauseAll", false);
  const modes: { value: ThemeMode; label: string }[] = [
    { value: "system", label: "Follow the system" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <>
      <Card1
        title="Advanced mode"
        sub="Shows Usage & limits and CLIs, plus the technical controls: tokens, spend, raw JSON for routines. Nothing is deleted either way."
      >
        <Toggle label="Advanced mode" checked={advanced} onChange={onAdvanced} />
      </Card1>
      <Card1 lead={<MeAvatar me={me} size={46} />} title={me.name} sub={me.calls || `${me.language} · ${me.status}`}>
        <Button variant="outline" onClick={() => nav("profile")}>
          Edit profile
        </Button>
      </Card1>
      <Card1
        lead={
          <MacTile dot={paused ? "bg-amber" : "bg-green"}>
            <Laptop className="size-[22px]" />
          </MacTile>
        }
        title="Agents are ready on this Mac"
        sub={paused ? "Everything is paused" : `${here} ${here === 1 ? "agent" : "agents"} here. They work while hz is open.`}
      >
        <span className="text-[13px] text-ink2">Pause all</span>
        <Toggle label="Pause all" checked={paused} onChange={setPaused} />
      </Card1>

      <SetHeading className="mt-4">Appearance</SetHeading>
      <div>
        <StudioRow label="Light or dark">
          <Pick
            label="Light or dark"
            value={mode}
            options={modes.filter((m) => m.value === "dark" || hasLightMode(theme))}
            onChange={setMode}
          />
        </StudioRow>
        {extras.theme}
        <StudioRow label="Density" hint="Comfortable spaces messages out. Compact fits more on screen.">
          <Segmented
            label="Density"
            value={prefs.density}
            onChange={(density) => set({ density })}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </StudioRow>
        <StudioRow label="Text size" hint="Messages in the chat.">
          <Segmented
            label="Text size"
            value={String(Math.min(16, Math.max(13, sizes.chat)))}
            onChange={(px) => setFontSize("chat", Number(px))}
            options={["13", "14", "15", "16"].map((px) => ({ value: px, label: px }))}
          />
        </StudioRow>
        <StudioRow label="Living faces" hint="Blinks, the working pill and the dither shimmer.">
          <Toggle label="Living faces" checked={prefs.livingFaces} onChange={(livingFaces) => set({ livingFaces })} />
        </StudioRow>
      </div>
      {extras.appearance}

      <SetHeading>Chat</SetHeading>
      <div>
        <StudioRow label="Send with" hint="Shift and Enter is a new line either way.">
          <Segmented
            label="Send with"
            value={prefs.sendKey}
            onChange={(sendKey) => set({ sendKey })}
            options={[
              { value: "enter", label: "⏎ Enter" },
              { value: "modEnter", label: "⌘ ⏎" },
            ]}
          />
        </StudioRow>
        <StudioRow label="Show steps while working" hint="The live checklist under a message in progress.">
          <Toggle label="Show steps while working" checked={prefs.showSteps} onChange={(showSteps) => set({ showSteps })} />
        </StudioRow>
        <StudioRow label={"Open “See what it did”"} hint="Show an agent's steps expanded once it finishes.">
          <Toggle label="Open See what it did" checked={prefs.openTrace} onChange={(openTrace) => set({ openTrace })} />
        </StudioRow>
        <StudioRow label="Clock" hint="Used by every time hz shows.">
          <Segmented
            label="Clock"
            value={prefs.clock}
            onChange={(clock) => set({ clock })}
            options={[
              { value: "24h", label: "24h" },
              { value: "12h", label: "12h" },
            ]}
          />
        </StudioRow>
      </div>

      <SetHeading>Notifications</SetHeading>
      <div>
        <NotifyRow prefs={prefs} set={set} field="needsYou" label="An agent needs you" hint="Approvals and questions." />
        <NotifyRow prefs={prefs} set={set} field="finishes" label="An agent finishes" />
        <NotifyRow prefs={prefs} set={set} field="mentions" label="Mentions in channels" />
        <StudioRow label="Quiet hours" hint="No banners between these times. The badge still counts.">
          <Toggle
            label="Quiet hours"
            checked={prefs.quiet.on}
            onChange={(on) => set({ quiet: { ...prefs.quiet, on } })}
          />
          <TimeField label="From" value={prefs.quiet.from} onChange={(from) => set({ quiet: { ...prefs.quiet, from } })} />
          <span className="text-xs text-ink3">to</span>
          <TimeField label="Until" value={prefs.quiet.to} onChange={(to) => set({ quiet: { ...prefs.quiet, to } })} />
        </StudioRow>
        <StudioRow label="Try it" hint="A real banner, to see whether macOS lets hz show one.">
          <Button variant="outline" size="sm" onClick={() => void sendTest()}>
            <Bell />
            Send a test notification
          </Button>
        </StudioRow>
      </div>

      <SetHeading>Shortcuts</SetHeading>
      <p className="-mt-2 px-1 text-xs text-ink3">Click a shortcut, then press the new keys.</p>
      <ShortcutsSettings />

      {extras.apps}
    </>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => validTime(e.target.value) && onChange(e.target.value)}
      className={cn(fieldClassName, "w-[110px] px-2.5 py-1.5 font-mono")}
    />
  );
}
