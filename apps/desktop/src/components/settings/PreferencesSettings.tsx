import { Bell } from "lucide-react";
import type { ReactNode } from "react";

import ShortcutsSettings from "@/components/settings/ShortcutsSettings";
import { Lead, SetHeading, StudioRow } from "@/components/settings/StudioRow";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { setFontSize, useFontSizes } from "@/hooks/useFontSizes";
import { useTheme } from "@/hooks/useTheme";
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

/// The preview chips, drawn in the palette each mode really uses: the Default theme's
/// `--background`, `--side` and `--surface-card` in App.css. Literal on purpose — a
/// chip that read the live tokens would show the current mode for both.
const PREVIEWS: { mode: ThemeMode; label: string; bg: string; side: string; main: string }[] = [
  { mode: "dark", label: "Dark", bg: "#121213", side: "#0e0e0f", main: "#18181a" },
  { mode: "light", label: "Light", bg: "#f4f3ef", side: "#e6e5e0", main: "#ffffff" },
  {
    mode: "system",
    label: "System",
    bg: "linear-gradient(90deg,#121213 50%,#f4f3ef 50%)",
    side: "linear-gradient(90deg,#0e0e0f 50%,#e6e5e0 50%)",
    main: "linear-gradient(90deg,#18181a 50%,#ffffff 50%)",
  },
];

function ThemePicker() {
  const { theme, mode, setMode } = useTheme();
  const light = hasLightMode(theme);
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-[repeat(3,120px)] gap-2.5">
      {PREVIEWS.map((p) => {
        const on = mode === p.mode;
        const disabled = !light && p.mode !== "dark";
        return (
          <button
            key={p.mode}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            title={disabled ? "The colour theme you picked is dark only" : undefined}
            onClick={() => setMode(p.mode)}
            className={cn(
              "cursor-pointer overflow-hidden rounded-(--r3) text-left shadow-[inset_0_0_0_1px_var(--line2)] outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40",
              on && "shadow-[0_0_0_2px_var(--ink)]",
            )}
          >
            <span className="flex h-16 gap-1 p-2" style={{ background: p.bg }}>
              <i className="block rounded-[3px]" style={{ width: "28%", background: p.side }} />
              <i className="block flex-1 rounded-[3px]" style={{ background: p.main }} />
            </span>
            <span className="block border-t border-line px-2.5 py-[7px] text-xs">{p.label}</span>
          </button>
        );
      })}
    </div>
  );
}

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
export default function PreferencesSettings({ extras }: { extras: { appearance: ReactNode; apps: ReactNode; about: ReactNode } }) {
  const [prefs, set] = useStudio();
  const sizes = useFontSizes();

  return (
    <>
      <Lead>How hz looks and behaves on this Mac.</Lead>

      <SetHeading>Appearance</SetHeading>
      <div>
        <StudioRow label="Theme">
          <ThemePicker />
        </StudioRow>
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
      <div className="flex flex-col gap-7">{extras.appearance}</div>

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
      <p className="-mt-2 text-xs text-ink3">Click a shortcut, then press the new keys.</p>
      <ShortcutsSettings />

      {extras.apps}
      {extras.about}
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
