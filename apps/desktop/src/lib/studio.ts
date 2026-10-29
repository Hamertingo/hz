import { readPreference, usePreference, writePreference } from "@/lib/prefs";

/// The Preferences page's picks, stored as one object under `hz.studio` in
/// `~/.hz/settings.json`. One object because Rust reads a few of them
/// (`studio.rs`: notification levels, quiet hours, warm-up, update check) and
/// the rest are the webview's; the field names here are the ones that file uses.

export type Density = "comfortable" | "compact";
export type SendKey = "enter" | "modEnter";
export type ClockFormat = "24h" | "12h";
export type NotifyLevel = "bannerSound" | "banner" | "badge" | "off";

export interface StudioPrefs {
  density: Density;
  /// Blinks, the working pill and the dither shimmer.
  livingFaces: boolean;
  sendKey: SendKey;
  showSteps: boolean;
  openTrace: boolean;
  clock: ClockFormat;
  notify: { needsYou: NotifyLevel; finishes: NotifyLevel; mentions: NotifyLevel };
  quiet: { on: boolean; from: string; to: string };
  warmUp: boolean;
  updateCheck: boolean;
}

export const DEFAULT_STUDIO: StudioPrefs = {
  density: "comfortable",
  livingFaces: true,
  sendKey: "enter",
  showSteps: true,
  openTrace: false,
  clock: "24h",
  notify: { needsYou: "bannerSound", finishes: "badge", mentions: "banner" },
  quiet: { on: false, from: "22:00", to: "08:00" },
  warmUp: true,
  updateCheck: true,
};

/// The levels each event may be set to, as the mockup offers them.
export const NOTIFY_CHOICES: Record<keyof StudioPrefs["notify"], readonly NotifyLevel[]> = {
  needsYou: ["bannerSound", "banner", "off"],
  finishes: ["banner", "badge", "off"],
  mentions: ["banner", "badge", "off"],
};

const LEVELS: readonly NotifyLevel[] = ["bannerSound", "banner", "badge", "off"];

/// `HH:MM`, 00:00 to 23:59.
export function validTime(text: unknown): text is string {
  return typeof text === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

function pick<T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T {
  return typeof raw === "string" && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function flag(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

/// Whatever is stored, made safe: unknown fields dropped, anything of the wrong
/// type or out of range replaced by its default. Never throws, since it runs on
/// every render of every timestamp.
export function coerceStudio(raw: unknown): StudioPrefs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const notify = (o.notify && typeof o.notify === "object" ? o.notify : {}) as Record<string, unknown>;
  const quiet = (o.quiet && typeof o.quiet === "object" ? o.quiet : {}) as Record<string, unknown>;
  const d = DEFAULT_STUDIO;

  return {
    density: pick(o.density, ["comfortable", "compact"], d.density),
    livingFaces: flag(o.livingFaces, d.livingFaces),
    sendKey: pick(o.sendKey, ["enter", "modEnter"], d.sendKey),
    showSteps: flag(o.showSteps, d.showSteps),
    openTrace: flag(o.openTrace, d.openTrace),
    clock: pick(o.clock, ["24h", "12h"], d.clock),
    notify: {
      needsYou: pick(notify.needsYou, LEVELS, d.notify.needsYou),
      finishes: pick(notify.finishes, LEVELS, d.notify.finishes),
      mentions: pick(notify.mentions, LEVELS, d.notify.mentions),
    },
    quiet: {
      on: flag(quiet.on, d.quiet.on),
      from: validTime(quiet.from) ? quiet.from : d.quiet.from,
      to: validTime(quiet.to) ? quiet.to : d.quiet.to,
    },
    warmUp: flag(o.warmUp, d.warmUp),
    updateCheck: flag(o.updateCheck, d.updateCheck),
  };
}

/// What the page holds now, read without subscribing: for code that is not a
/// component (a timestamp formatter, the composer's key handler).
export function readStudio(): StudioPrefs {
  return coerceStudio(readPreference("hz.studio", null));
}

/// Changes some of the picks and stores the whole object.
export function patchStudio(patch: Partial<StudioPrefs>): void {
  writePreference("hz.studio", { ...readStudio(), ...patch });
}

/// The picks, and a setter that merges a patch. Re-renders on any change.
export function useStudio(): readonly [StudioPrefs, (patch: Partial<StudioPrefs>) => void] {
  const [raw] = usePreference("hz.studio", null);
  return [coerceStudio(raw), patchStudio];
}

/// Whether a key press in the composer sends the message, under the reader's
/// pick: Enter alone, or ⌘/Ctrl+Enter. Shift+Enter is always a newline.
export function sendsOnKey(
  e: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  sendKey: SendKey,
): boolean {
  if (e.key !== "Enter" || e.shiftKey || e.altKey) return false;
  const mod = e.metaKey || e.ctrlKey;
  return sendKey === "enter" ? !mod : mod;
}

/// Stamps `<html>` with the two picks the stylesheet reads: `data-density` and
/// `data-faces` (`still` when living faces are off).
export function applyStudioAttributes(prefs: StudioPrefs, el: HTMLElement = document.documentElement): void {
  el.dataset.density = prefs.density;
  el.dataset.faces = prefs.livingFaces ? "alive" : "still";
}
