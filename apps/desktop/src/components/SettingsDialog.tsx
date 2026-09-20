import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  GitBranch,
  Info,
  Keyboard,
  Layers,
  Mic,
  Palette,
  Plug,
  Server,
  type LucideIcon,
} from "lucide-react";

import { openUrl } from "@tauri-apps/plugin-opener";

import AppIcon from "@/components/AppIcon";
import LinearIcon from "@/components/LinearIcon";
import { CommandChip, INSTALL_COMMAND, LOGIN_COMMAND } from "@/components/PrPanel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { inputClassName } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppSettings } from "@/hooks/useAppSettings";
import { resetFontSizes, setFontSize, useFontSizes } from "@/hooks/useFontSizes";
import type { useIntegrations } from "@/hooks/useIntegrations";
import { useSourceControl } from "@/hooks/useSourceControl";
import { useTheme } from "@/hooks/useTheme";
import { type ManualCheck, updateFailure } from "@/hooks/useUpdater";
import { downloadChromium, removeChromium, useChromium } from "@/lib/browser";
import { usePreference } from "@/lib/prefs";
import {
  FONT_MAX,
  FONT_MIN,
  FONT_SLOTS,
  isDefaultFontSizes,
} from "@/lib/fontSize";
import { chromiumBusy, chromiumPercent, describeChromium } from "@/lib/chromium";
import {
  cachedApps,
  fileOpenerChoices,
  load,
  OPEN_FILE_KEY,
  pickFileOpener,
} from "@/lib/openWith";
import ProviderSettings from "@/components/settings/ProviderSettings";
import ShortcutsSettings from "@/components/settings/ShortcutsSettings";
import SpacesSettings from "@/components/settings/SpacesSettings";
import TranscriptionSettings from "@/components/settings/TranscriptionSettings";
import { useTranscriptionSettings } from "@/hooks/useTranscription";
import { IS_MAC } from "@/lib/platform";
import { hasLightMode, THEMES, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type {
  ExternalApp,
  GhAccount,
  Project,
  SettingsView,
  UpdateChannel,
  UpdateStatus,
} from "@/types/events";

/// Where to send someone who wants to say something. Direct message rather than an
/// issue tracker: most feedback is a sentence, and a form is more than a sentence is
/// worth. The repo is beside it for the half who would rather send the fix.
const CONTACT_URL = "https://x.com/yogesharc";
const REPO_URL = "https://github.com/Hamertingo/hz";

/// The app's preferences, such as they are.
///
/// Mounted in `App` rather than beside the gear that opens it: the sidebar
/// unmounts when it collapses, and a dialog living there would take the ⌘,
/// shortcut with it — which is the one route into this that survives a
/// collapsed sidebar.
export default function SettingsDialog({
  open,
  onOpenChange,
  initialTab = "appearance",
  projects,
  spaces,
  startNamingSpace,
  onSetProjectSpace,
  onRemoveProject,
  onCreateSpace,
  onRenameSpace,
  onRemoveSpace,
  onMoveSpace,
  integrations,
  updateStatus,
  updateManual,
  updateBlocked,
  onCheckUpdates,
  onInstallUpdate,
  updateChannel,
  onUpdateChannelChange,
  onProvidersChanged,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /// Which tab to open on. The composer's mic button sends the reader straight
  /// to Transcription when no model is downloaded, which is the whole reason
  /// this is a prop rather than internal state.
  initialTab?: SettingsTab;
  /// Every attached project, not the active space's — this is where one is
  /// filed into a space, so a narrowed list would hide the rows to move.
  projects: Project[];
  spaces: string[];
  /// Opens the Spaces tab with its new-space field already up, which is where
  /// the sidebar's own "New space" lands.
  startNamingSpace?: boolean;
  onSetProjectSpace: (path: string, space: string | null) => void;
  onRemoveProject: (path: string) => void;
  onCreateSpace: (name: string) => void;
  onRenameSpace: (from: string, to: string) => void;
  onRemoveSpace: (name: string) => void;
  onMoveSpace: (name: string, delta: number) => void;
  /// Owned by `App`, because the issues page and the composer read it too.
  integrations: ReturnType<typeof useIntegrations>;
  /// The updater's state, owned by `App` — the sidebar's own `UpdateRow` draws
  /// the same fields, and a second copy of the hook would run its own check.
  updateStatus: UpdateStatus | null;
  updateManual: ManualCheck;
  /// A turn is in flight somewhere, so installing would kill a child mid-turn.
  updateBlocked: boolean;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
  /// Owned by `useUpdater`, for the reason its own doc comment gives: the row
  /// hands the pick back to the effect that re-arms the check on it.
  updateChannel: UpdateChannel;
  onUpdateChannelChange: (next: UpdateChannel) => void;
  /// A provider was added, removed or made active, so the model list the
  /// composer draws is stale — the app re-reads it.
  onProvidersChanged?: () => void;
}) {
  const { settings, setAnalyticsEnabled } = useAppSettings(open);
  const transcription = useTranscriptionSettings(open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Each row carries its own sentence, so there is no one description the
          dialog is described *by* — left unset, Radix warns about the missing
          `aria-describedby` and pointing it at a row would read that row's copy
          out as the dialog's purpose. */}
      {/* Wider than the dialog default. That default is sized for a question and
          two buttons; this holds prose, and at 25rem the analytics sentence broke
          across three lines with two words on the last one. */}
      <DialogContent
        aria-describedby={undefined}
        overlayClassName="bg-transparent"
        // **Full window, and every override neutralises one half of the
        // dialog's own frame** — a centred card of a dialog is the shape this
        // stopped being. The frame, the overlay and the fade stay: the overlay
        // is what hides the native browser view (see `judgeOcclusion`), the fade
        // is the same one every other surface opens with, and the centring,
        // radius, border, fill and blur are what a full-bleed surface cannot
        // carry. `bg-transparent` because the two columns paint themselves: the
        // nav stays see-through so the window keeps its glass, which is exactly
        // how the app's own sidebar is drawn.
        // **No animation at all, and that is a fix rather than a preference.** A
        // card can afford to fade: the reader keeps seeing the app they were in,
        // dimmed, and the card arrives over it. A surface that replaces the
        // window cannot — a fade from zero opacity *is* the app showing through
        // it, so the settings page arrives as a ghost of the transcript with the
        // window's own header over the top, which reads as a glitch rather than
        // as a transition. Measured before this: 0.11 → 1.0 over about 100ms,
        // every frame of it wrong, and the way out faded the same. So this
        // surface appears on one frame, the way every other in-app navigation
        // does.
        animated={false}
        className="top-0 left-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        {/* The window's own drag row, and it has to be here: this surface covers
            the app's, and a full-window page with nothing to drag by is a window
            that cannot be moved. */}
        <div
          className="flex h-(--titlebar-h) shrink-0 bg-background"
          data-tauri-drag-region="deep"
        />

        <SettingsSections initialTab={initialTab}>
          {{
            providers: <ProviderSettings onChanged={onProvidersChanged} />,
            appearance: (
              <>
                <Section>
                  <ThemeRow />
                  <ModeRow />
                </Section>
                <Section title="Font size">
                  <FontSizeRows />
                </Section>
              </>
            ),
            shortcuts: <ShortcutsSettings />,
            spaces: (
              <SpacesSettings
                projects={projects}
                spaces={spaces}
                startNaming={startNamingSpace}
                onSetProjectSpace={onSetProjectSpace}
                onRemoveProject={onRemoveProject}
                onCreateSpace={onCreateSpace}
                onRenameSpace={onRenameSpace}
                onRemoveSpace={onRemoveSpace}
                onMoveSpace={onMoveSpace}
              />
            ),
            transcription: (
              <TranscriptionSettings
                status={transcription.status}
                downloads={transcription.downloads}
                onDownload={transcription.download}
                onCancelDownload={transcription.cancelDownload}
                onDelete={transcription.remove}
                onSelectModel={transcription.selectModel}
                onSelectDevice={transcription.selectDevice}
                onSetMute={transcription.setMute}
              />
            ),
            sourceControl: <SourceControlSettings />,
            integrations: (
              <Section>
                <OpenFilesRow />
                <BrowserRow />
                {/* Draws nothing until something is connected, which is why it
                    carries no heading of its own — a heading left standing over
                    nothing names a group the reader cannot reach. Connecting
                    happens on the issues page. */}
                <IssueTrackerRow {...integrations} />
              </Section>
            ),
            about: (
              <>
                <Section>
                  <UpdatesRow
                    status={updateStatus}
                    manual={updateManual}
                    blocked={updateBlocked}
                    onCheck={onCheckUpdates}
                    onInstall={onInstallUpdate}
                  />
                  <BetaUpdatesRow
                    channel={updateChannel}
                    onChange={onUpdateChannelChange}
                  />
                  <AnalyticsRow view={settings} onChange={setAnalyticsEnabled} />
                </Section>
                {/* The one block here with no label of its own, so it is the one
                    that still wants a heading over it. */}
                <Section title="Feedback">
                  <ContactBlock />
                </Section>
              </>
            ),
          }}
        </SettingsSections>
      </DialogContent>
    </Dialog>
  );
}

/// One row per text class, and nothing derived: the three sit at different
/// sizes by default and a single slider would hide which one the reader moved.
/// In px rather than an abstract Small/Large because px is what the reader can
/// compare against their editor.
function FontSizeRows() {
  const sizes = useFontSizes();
  return (
    <>
      {/* Tighter than the section's own gap: these rows are a word and a
          box each, with no sentence under them to hold apart. */}
      <div className="flex flex-col gap-1.5">
        {FONT_SLOTS.map((slot) => (
          <FontSizeRow key={slot.id} slot={slot} value={sizes[slot.id]} />
        ))}
      </div>
      {!isDefaultFontSizes(sizes) && (
        <Button variant="outline" size="sm" className="self-start" onClick={resetFontSizes}>
          Reset font sizes
        </Button>
      )}
    </>
  );
}

/// The field keeps its own text while focused: a value in range is applied on
/// every keystroke so the transcript moves behind the dialog, one outside it is
/// left alone until blur, where it is clamped. Clamping on change is the trap —
/// a controlled field snapping `1` to `10` turns a typed `15` into `105`.
///
/// Not `type="number"`: its spinner arrows are the one thing it adds and they
/// are not wanted, so ↑/↓ step the value by hand. The box is the outer span,
/// drawn with the input's own classes, and the field inside it is bare — a
/// unit positioned over a padded input collides with the number the moment
/// the interface size it is set in grows.
function FontSizeRow({
  slot,
  value,
}: {
  slot: (typeof FONT_SLOTS)[number];
  value: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const step = (delta: number) => {
    setFontSize(slot.id, value + delta);
    setDraft(null);
  };
  return (
    <SettingRow id={id} label={slot.label}>
      <label
        htmlFor={id}
        className={cn(
          inputClassName,
          "flex h-7 w-fit cursor-text items-center gap-1 px-2.5 text-ui focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
        )}
      >
        <input
          id={id}
          inputMode="numeric"
          value={draft ?? value}
          onChange={(e) => {
            setDraft(e.target.value);
            const px = Number(e.target.value);
            if (px >= FONT_MIN && px <= FONT_MAX) setFontSize(slot.id, px);
          }}
          onBlur={(e) => {
            const px = Number(e.target.value);
            if (e.target.value.trim() && Number.isFinite(px)) setFontSize(slot.id, px);
            setDraft(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") (e.preventDefault(), step(1));
            if (e.key === "ArrowDown") (e.preventDefault(), step(-1));
          }}
          className="w-[2.5ch] bg-transparent text-right outline-none"
        />
        <span className="text-muted-foreground select-none">px</span>
      </label>
    </SettingRow>
  );
}

/// The palette, picked by looking at it.
///
/// Each swatch carries `data-theme` and `data-mode` itself, so the palette blocks in
/// App.css match it exactly as they match `<html>` and it paints that theme's own
/// backdrop — gradient and all. A swatch therefore cannot drift from the theme it
/// stands for, which a table of colours in this file could and eventually would.
///
/// Names are drawn, not hovered for. A colour says what a theme *looks* like and the
/// name says which one it is, and both are wanted at once — hiding either behind a
/// tooltip makes the reader work for half the answer. It also puts the name inside
/// the button, so the accessible name is the visible one rather than an `aria-label`
/// that can drift from it.
///
/// **The one row here with no description**, deliberately: the control is the
/// explanation. A sentence saying "the palette everything uses" next to two visible,
/// named palettes is words spent on something the reader has already seen.
function ThemeRow() {
  const id = useId();
  const { theme, resolvedMode, setTheme } = useTheme();
  const index = THEMES.findIndex((t) => t.id === theme);
  const { refs: swatches, onKeyDown } = useRovingGroup(THEMES.length, index, (next) =>
    setTheme(THEMES[next].id),
  );

  return (
    <SettingRow id={id} asGroup stacked label="Theme">
      <div
        role="radiogroup"
        aria-labelledby={id}
        onKeyDown={onKeyDown}
        className="flex items-start gap-3"
      >
        {THEMES.map(({ id: name, label }, i) => (
          <button
            key={name}
            ref={(el) => {
              swatches.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={theme === name}
            tabIndex={theme === name ? 0 : -1}
            onClick={() => setTheme(name)}
            className="group flex cursor-pointer flex-col items-center gap-1.5 outline-none"
          >
            <span
              data-theme={name}
              // Its own mode, not the document's. A dark-only theme in light
              // mode matches no palette block and falls through to the light
              // ramp's neutrals — so the swatch would draw a light Default that
              // clicking it does not give you, `modeFor` having forced dark.
              data-mode={hasLightMode(name) ? resolvedMode : "dark"}
              className={cn(
                "theme-swatch size-12 rounded-md border transition-colors",
                // The offset has to be the dialog's own fill rather than
                // `--background`: this floats over the sidebar, which has none.
                theme === name
                  ? "border-transparent ring-2 ring-ring ring-offset-2 ring-offset-popover"
                  : "border-border group-hover:border-muted-foreground/60 group-focus-visible:border-ring",
              )}
            />
            <span
              className={cn(
                "text-ui",
                theme === name ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </button>
        ))}
      </div>
    </SettingRow>
  );
}

/// Which app a filename in the transcript opens in.
///
/// Finder is the default and the fallback, and it *reveals* rather than opens —
/// which is also what the link did before this setting existed, so an
/// uninstalled editor or a launch that fails costs the preference and never the
/// click. The menu offers editors and Finder only: a terminal is in the panel
/// button's list because it can be handed a directory, and handing it one file
/// answers nothing.
///
/// Drawn disabled rather than hidden wherever it cannot apply, since the
/// sentence underneath is then the only place the reason can be said. Off macOS
/// there is no detection at all; on macOS with no editor installed there is a
/// list of one, which is a menu that cannot change anything.
function OpenFilesRow() {
  const id = useId();
  const [stored, setStored] = usePreference(OPEN_FILE_KEY, null);
  // `null` until the first read lands, so an empty list can still mean "this
  // machine has nothing" rather than "nobody has asked yet".
  const [apps, setApps] = useState<ExternalApp[] | null>(() => {
    const warm = cachedApps();
    return warm.length ? warm : null;
  });

  /// Asks again, on mount and whenever the menu opens — an editor installed
  /// while hz was running is otherwise absent until a restart, and the menu
  /// opening is the one moment the list has to be current.
  const refresh = useCallback(() => {
    void load().then(setApps);
  }, []);

  useEffect(refresh, [refresh]);

  const choices = fileOpenerChoices(apps ?? []);
  const pick = pickFileOpener(apps ?? [], stored);
  const editors = choices.filter((app) => app.kind === "editor");

  const unavailable = !IS_MAC
    ? "Opening a file in another app is macOS-only for now."
    : apps !== null && editors.length === 0
      ? "No editor hz knows about is installed, so filenames open in Finder."
      : null;

  return (
    <SettingRow
      id={id}
      label="Open files with"
      description={
        unavailable ??
        "Where a filename in the chat opens. Markdown opens in the panel instead, and Finder selects a file rather than opening it."
      }
    >
      {/* Opening the menu re-reads the list — see `refresh`. */}
      <DropdownMenu onOpenChange={(open) => open && refresh()}>
        <DropdownMenuTrigger asChild>
          <Button
            id={id}
            variant="outline"
            size="sm"
            // `apps === null` is the read not having landed. Disabled rather
            // than drawn from a guess, the same bargain the analytics switch
            // makes — either guess is wrong for somebody.
            disabled={apps === null || unavailable !== null}
            className="justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              {pick && <AppIcon app={pick} className="size-4" />}
              {/* "None" rather than "Finder" where nothing was detected: off
                  macOS the reveal is some other file manager, and naming
                  Finder there would be a control lying about what it does. */}
              <span className="truncate">{pick?.name ?? "None"}</span>
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>

        {/* Aligned to the end because the control sits at the dialog's right
            edge, where a start-aligned menu opens past it.

            Sized to the longest app name, floored at the trigger's own width.
            The default is the other way round — `w-(--radix-…-trigger-width)`
            pins the menu *to* the trigger — which is right for a control that
            fills its row and wrong for one that has shrunk to a single app
            name, where it made the menu narrower than its own items. */}
        <DropdownMenuContent
          align="end"
          className="w-auto min-w-(--radix-dropdown-menu-trigger-width)"
        >
          {choices.map((app, i) => (
            <Fragment key={app.path}>
              {/* An inset dotted rule between the editors and Finder,
                  `PickerMenu`'s own idiom and the same one the panel's split
                  button uses. Finder is a different kind of answer, and a flat
                  list of both reads as one. */}
              {i > 0 && choices[i - 1].kind !== app.kind && (
                <DropdownMenuSeparator className="mx-2 my-1 h-0 border-t border-dotted border-border/80 bg-transparent" />
              )}
              <DropdownMenuItem
                onSelect={() => setStored(app.path)}
                className="cursor-pointer"
              >
                <AppIcon app={app} className="size-4" />
                <span className="flex-1 truncate">{app.name}</span>
                {app.path === pick?.path && <Check className="size-3.5 shrink-0" />}
              </DropdownMenuItem>
            </Fragment>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingRow>
  );
}

/// Set *and* order, so a mode added later is one entry. System leads because it is
/// the answer for anyone who has already told their OS once.
const MODES: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/// Three segments rather than a switch, because there are three answers.
///
/// A switch can only ask light-or-dark, which leaves `system` — the one most people
/// want, and the only one that keeps following the OS after it is set — reachable
/// from nowhere. Driven off `mode` as *chosen*, never `resolvedMode`: the whole point
/// of System is that it reads Dark today and Light tonight, and a control drawn from
/// what is on screen would show Dark and lose the distinction.
///
/// The group disables whole on a dark-only theme rather than dropping its light
/// segments. Two segments where there were three reads as the control being broken,
/// and it would still be lying — `system` is not offerable either, since the OS can
/// resolve it to light. `modeFor` already forces dark, so the selected segment is
/// honest about what is rendering.
function ModeRow() {
  const id = useId();
  const { theme, mode, setMode } = useTheme();
  const available = hasLightMode(theme);

  const index = MODES.findIndex((m) => m.id === mode);
  const { refs, onKeyDown } = useRovingGroup(MODES.length, index, (next) =>
    setMode(MODES[next].id),
  );

  return (
    <SettingRow
      id={id}
      asGroup
      stacked
      label="Mode"
      // Nothing to say while it works — the segments name themselves. The one
      // sentence here is the reason it does not, which is the whole of why a
      // setting that cannot apply is disabled rather than hidden.
      description={
        available ? undefined : "This theme is dark only for now — the others carry both."
      }
    >
      <div
        role="radiogroup"
        aria-labelledby={id}
        onKeyDown={available ? onKeyDown : undefined}
        // Track and thumb, the way a segmented control reads everywhere: the
        // selected one is a raised card sitting *in* a recessed rail, so the
        // group says "one of these" before any label is read.
        className={cn(
          "inline-flex w-fit gap-0.5 rounded-lg bg-muted p-0.5",
          !available && "opacity-50",
        )}
      >
        {MODES.map(({ id: value, label }, i) => (
          <button
            key={value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={mode === value}
            disabled={!available}
            tabIndex={mode === value ? 0 : -1}
            onClick={() => setMode(value)}
            className={cn(
              "rounded-[calc(var(--radius)-4px)] px-3 py-1 text-ui transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              available && "cursor-pointer",
              mode === value
                ? "bg-card text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </SettingRow>
  );
}

/// Arrow keys inside one Tab stop, with selection following focus.
///
/// Shared by both pickers above rather than written twice. `role="radiogroup"` is a
/// promise to a screen reader that the keyboard behaves this way, and two copies of
/// it is two chances for one to quietly stop keeping it. Roving `tabIndex` is the
/// other half and lives at the call site: without it every option is its own Tab
/// stop, so tabbing through the dialog walks the palettes one at a time.
///
/// Selection follows focus because both groups are cheap to try — here trying one
/// *is* seeing it, which is the case the pattern exists for.
function useRovingGroup(
  count: number,
  index: number,
  onPick: (next: number) => void,
) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (next: number) => {
    onPick(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Home and End are part of the same promise the arrows are: a screen reader
    // told this is a radio group or a tab list expects all four.
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      move(e.key === "Home" ? 0 : count - 1);
      return;
    }

    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    move((index + step + count) % count);
  };

  return { refs, onKeyDown };
}

/// Which manifest updates come from.
///
/// A button that arms a confirm, the disconnect row's shape exactly — and not a
/// switch, which was the first draft. The change wants confirming, because it
/// makes the app start downloading a different build on its own; a switch that
/// must be confirmed cannot move on click, and a switch that does not move
/// reads as broken. A button carries the ask honestly: its label names the act
/// (Turn on / Turn off), which also says which channel is live.
///
/// Sits in About because that tab is where the app talks about itself: which
/// build you are running, and what it reports back.
///
/// The description is one line, and deliberately not the mechanism. An earlier
/// draft spent a second sentence on the fact that switching back is not a
/// downgrade — true, and nobody asked: the reader wants to know what they get,
/// not how the updater compares versions. `useUpdater`'s own comments hold
/// that. It also stays put while the confirm is up.
function BetaUpdatesRow({
  channel,
  onChange,
}: {
  channel: UpdateChannel;
  onChange: (next: UpdateChannel) => void;
}) {
  const id = useId();
  /// The channel the reader is about to move to, or null at rest. Resets with
  /// the dialog, since the tab bodies are switched rather than hidden.
  const [confirming, setConfirming] = useState<UpdateChannel | null>(null);

  return (
    <SettingRow
      id={id}
      label="Beta updates"
      description="Get new versions early, before they're fully tested."
    >
      {confirming ? (
        <div className="flex items-center gap-1.5">
          {/* Takes the focus the unmounting button just dropped — not stealing,
              since a keyboard user was on this very spot. Cancel, not the verb,
              so Enter pressed twice out of habit changes nothing. */}
          <Button
            autoFocus
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(null)}
          >
            Cancel
          </Button>
          {/* Not the verb again — the button just pressed said that, and the
              same word twice reads as the press not having landed. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onChange(confirming);
              setConfirming(null);
            }}
          >
            Confirm
          </Button>
        </div>
      ) : (
        <Button
          id={id}
          variant="outline"
          size="sm"
          onClick={() => setConfirming(channel === "beta" ? "stable" : "beta")}
        >
          {channel === "beta" ? "Turn off" : "Turn on"}
        </Button>
      )}
    </SettingRow>
  );
}

/// Check for updates, and install one that has already downloaded.
///
/// The same answer the menu item gives, in a place a collapsed sidebar cannot
/// take away — `UpdateRow` lives inside `<aside>`, so "Check for Updates…" had
/// nowhere to report to while the sidebar was shut.
///
/// **One button, and its label is the whole state.** Checking, up to date,
/// downloading and ready are four answers to one question, so a sentence under
/// the row would say a second time what the label already says — and the label
/// is where the reader is looking, having just pressed it. The verdicts retire
/// themselves after a few seconds, so the button settles back to the offer.
///
/// It draws whatever the updater is doing rather than only what this button
/// started: a background check that already found something leaves the row
/// offering the restart, which is the more useful of the two answers. A blocked
/// install takes `UpdateRow`'s treatment exactly — `aria-disabled` and a
/// tooltip, never `disabled`, which fires no pointer events to open one.
function UpdatesRow({
  status,
  manual,
  blocked,
  onCheck,
  onInstall,
}: {
  status: UpdateStatus | null;
  manual: ManualCheck;
  blocked: boolean;
  onCheck: () => void;
  onInstall: () => void;
}) {
  const id = useId();
  const ready = status?.state === "ready";
  const downloading = status?.state === "downloading";

  const label = ready
    ? `Restart to update (v${status.version})`
    : downloading
      ? `Downloading${status.percent === null ? "…" : ` ${status.percent}%`}`
      : manual === "checking"
        ? "Checking…"
        : manual === "up_to_date"
          ? "Up to date"
          : manual === "failed"
            ? "Couldn't check"
            : "Check for updates";

  const button = (
    <Button
      id={id}
      variant="outline"
      size="sm"
      // Only the install has a reason worth a tooltip, so only it gives up
      // `disabled` for the aria form. A download in flight is its own answer,
      // and the hook's in-flight guard would refuse a second check anyway.
      aria-disabled={ready && blocked}
      disabled={!ready && (manual === "checking" || downloading)}
      onClick={() => {
        if (!ready) return onCheck();
        if (!blocked) onInstall();
      }}
      className="aria-disabled:cursor-default aria-disabled:opacity-50"
    >
      {manual === "checking" && !ready && <Spinner className="size-3.5" />}
      {label}
    </Button>
  );

  // The same sentence the sidebar row draws, since this dialog covers it — a
  // reader who pressed the button here would otherwise get no answer at all.
  return (
    <SettingRow id={id} label="Updates" description={updateFailure(manual)}>
      {ready && blocked ? (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="top">
            Waiting for the running turn to finish.
          </TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
    </SettingRow>
  );
}

/// Two sentences: what it is for, and what it never touches.
///
/// The second one is the row's whole job. "Analytics" reads as behavioural
/// tracking to most people, and for a tool that watches you work on your own
/// code, saying plainly that conversations and activity are not collected is
/// the part worth the space. Kept short on purpose — an itemised list of
/// fields reads as something to be wary of rather than something to skim.
function AnalyticsRow({
  view,
  onChange,
}: {
  view: SettingsView | null;
  onChange: (next: boolean) => void;
}) {
  const id = useId();

  return (
    <SettingRow
      id={id}
      label="Share basic analytics"
      description={
        view?.analyticsLocked
          ? // Disabled and saying why, rather than hidden or — worse — drawn
            // from the stored value and sitting at `on` while nothing is sent.
            "Turned off for this run by HZ_NO_ANALYTICS."
          : // Says what is actually sent. It read "your conversations and
            // activity are never collected" while a launch was the only event,
            // and that stopped being true the moment features were reported —
            // a privacy line that overpromises is worse than no line. Errors
            // are named for the same reason, and named as *where*: what goes is
            // a stage or a `file:line`, never the message beside it.
            "Counts launches, which features get used, and where errors happen, under a random id. Your prompts, code and conversations are never collected."
      }
    >
      <Switch
        id={id}
        // `null` until the first read lands. Disabled rather than guessing a
        // value: either guess is wrong for somebody, and the dialog's own open
        // animation is longer than a local file read.
        disabled={view === null || view.analyticsLocked}
        checked={view?.analyticsEnabled ?? false}
        onCheckedChange={onChange}
      />
    </SettingRow>
  );
}

/// A word where a control would go, on a row whose answer is a fact about this
/// machine rather than something to set.
///
/// The same chip shape the pull-requests header counts rows with, because it is
/// the same kind of thing: a short answer at the end of a line that a control
/// would otherwise sit at the end of.
function StatusChip({ children, bad }: { children: ReactNode; bad?: boolean }) {
  return (
    <span
      className={cn(
        "max-w-72 shrink-0 truncate rounded-full border px-2 py-px text-ui",
        bad ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/// What the pull-request screens actually run on, and who they run as.
///
/// **The third question is the one nothing else in the app can answer.** "Is
/// `gh` installed" and "is it signed in" both surface where they are needed —
/// the PR tab has its own install prompt — but a credential that is present and
/// *refused* looks exactly like a working one until a read comes back with
/// GitHub's answer, and that answer is one error per field path rather than a
/// sentence. So the account and its scopes are here, where a failure of that
/// kind has somewhere to be looked at.
function SourceControlSettings() {
  const { state, error, loading, recheck } = useSourceControl();
  const [stillMissing, setStillMissing] = useState(false);

  const check = async () => {
    setStillMissing(false);
    await recheck();
    setStillMissing(true);
  };

  if (!state) {
    return (
      <Section>
        <p className="text-ui text-muted-foreground">
          {error
            ? `Could not read what is installed — ${error}`
            : "Reading what is installed…"}
        </p>
      </Section>
    );
  }

  return (
    <Section>
      <SettingRow
        id="source-control-git"
        asGroup
        label="Git"
        description={
          state.git
            ? "Every checkout, branch and diff hz runs goes through it."
            : "Not on this machine, so there is nothing here for hz to diff."
        }
      >
        <StatusChip bad={!state.git}>{state.git ?? "Not installed"}</StatusChip>
      </SettingRow>

      <GitHubCliRow gh={state.gh} loading={loading} onRecheck={check} stillMissing={stillMissing} />
    </Section>
  );
}

/// The `gh` half, in the four states it can be in.
///
/// Split out rather than inlined because the states are the whole of it, and
/// two of the four are the ones a reader arrives here to find: a credential
/// GitHub turned down, and a signed-in account whose scopes do not reach what
/// the pull-request reads ask for.
function GitHubCliRow({
  gh,
  loading,
  onRecheck,
  stillMissing,
}: {
  gh: GhAccount | null;
  loading: boolean;
  onRecheck: () => void;
  stillMissing: boolean;
}) {
  const chip = !gh
    ? { text: "Not installed", bad: true }
    : gh.error
      ? { text: "Refused", bad: true }
      : gh.login
        ? { text: `Signed in as ${gh.login}`, bad: false }
        : { text: "Not signed in", bad: true };

  const command = !gh ? INSTALL_COMMAND : gh.login || gh.error ? null : LOGIN_COMMAND;

  return (
    <SettingRow
      id="source-control-gh"
      asGroup
      label="GitHub CLI"
      description={<GhDescription gh={gh} stillMissing={stillMissing} />}
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <StatusChip bad={chip.bad}>{chip.text}</StatusChip>
        <Button
          variant="ghost"
          size="sm"
          className="cursor-pointer"
          disabled={loading}
          onClick={onRecheck}
        >
          {loading ? "Looking…" : "Recheck"}
        </Button>
      </span>
      {command && <CommandChip command={command} />}
    </SettingRow>
  );
}

/// Why the row says what it says, in the words of what to do about it.
function GhDescription({ gh, stillMissing }: { gh: GhAccount | null; stillMissing: boolean }) {
  if (!gh) {
    return (
      <>
        Pull requests, their checks and their reviews all read through it.
        {stillMissing &&
          " Still not found — hz looks where your login shell does, so an install that landed somewhere else needs the app restarted."}
      </>
    );
  }

  if (gh.error) {
    return (
      <>
        <code className="text-foreground">{gh.tokenSource ?? "A credential"}</code> is set, and
        GitHub turned it down — {gh.error}. That is the token itself rather than anything hz can
        fix: replace it with <code className="text-foreground">gh auth login</code>, or with a token
        that carries the permissions below.
      </>
    );
  }

  if (!gh.login) {
    return (
      <>
        Nothing is signed in, so every pull-request read comes back empty rather than wrong. The tab
        in a session offers this same command where the failure is met.
      </>
    );
  }

  // **Where the credential comes from decides which cure is available**, so it
  // is said first. `gh` prefers a token in the environment over the one its own
  // `gh auth login` stored, and a shell that exports one silently overrides a
  // working keyring account — the app inherits that environment, so the two
  // accounts `gh auth status` lists are not both in play.
  const fromEnvironment = gh.tokenSource && gh.tokenSource !== "keyring" ? gh.tokenSource : null;

  return (
    <>
      On {gh.host ?? "GitHub"}, signed in as <code className="text-foreground">{gh.login}</code>
      {fromEnvironment ? (
        <>
          , using the token in <code className="text-foreground">{fromEnvironment}</code> rather
          than the one <code className="text-foreground">gh auth login</code> stored. gh prefers
          the environment, so unsetting it is a cure in itself — and the app has to be started
          from a shell that does not set it.
        </>
      ) : (
        <>, {gh.tokenSource === "keyring" ? "through gh's own login" : "signed in"}.</>
      )}

      {/* **An empty scope list is not a fault, and must not be drawn as one.**
          Every fine-grained personal access token reports no scopes at all —
          its permissions live on GitHub, so a read it is not allowed is refused
          with nothing here to show for it. Naming the two permissions that
          matter is the most this row can do about that. */}
      {gh.scopes.length === 0 ? (
        <>
          {" "}
          gh reports no scopes, which is how a fine-grained personal access token always reads.
          What it may read is set per repository on GitHub: pull requests and checks need{" "}
          <strong className="font-medium text-foreground">Checks: Read</strong> and{" "}
          <strong className="font-medium text-foreground">Commit statuses: Read</strong> beside
          the Contents and Pull requests ones.
        </>
      ) : (
        <>
          {" "}
          Scopes: {gh.scopes.join(", ")}.
          {!gh.scopes.includes("repo") && (
            <>
              {" "}
              <code className="text-foreground">repo</code> is not among them, and reading a
              repository's pull requests needs it —{" "}
              <code className="text-foreground">gh auth refresh -s repo</code> adds it.
            </>
          )}
        </>
      )}
    </>
  );
}

/// The in-app browser's Chromium: downloaded after install rather than shipped,
/// so this is where the reader sees it land, retries a failed fetch, or takes
/// the 300MB back. Nothing to draw in a build without the browser, where the
/// status read fails and stays `null`.
///
/// Remove asks twice in the row, the way the model list does — the file comes
/// back with one press, but only after a download the reader may not want
/// twice on a slow link.
function BrowserRow() {
  const id = useId();
  const status = useChromium();
  const [confirming, setConfirming] = useState(false);
  // Why the last Remove was refused — once CEF has loaded the framework the
  // answer is "quit and reopen", and a button that swallows that looks like
  // one that does nothing.
  const [error, setError] = useState<string | null>(null);

  if (!status) return null;

  return (
    <SettingRow
      id={id}
      label="Browser"
      description={
        error ? (
          <span className="text-destructive">{error}</span>
        ) : confirming ? (
          "Chromium will be downloaded again the next time hz starts."
        ) : (
          describeChromium(status)
        )
      }
    >
      {chromiumBusy(status) ? (
        status.state === "downloading" ? (
          <span className="text-ui tabular-nums text-muted-foreground">
            {chromiumPercent(status)}%
          </span>
        ) : (
          <Spinner className="size-4 text-muted-foreground" />
        )
      ) : status.state === "ready" ? (
        confirming ? (
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                try {
                  await removeChromium();
                  setConfirming(false);
                  setError(null);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Remove
            </Button>
          </div>
        ) : (
          <Button id={id} variant="outline" size="sm" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )
      ) : (
        <Button id={id} variant="outline" size="sm" onClick={() => void downloadChromium()}>
          {status.state === "failed" ? "Retry" : "Download"}
        </Button>
      )}
    </SettingRow>
  );
}

/// The connected issue tracker — and **only** when there is one.
///
/// Connecting happens on the issues page, not here. That page is the surface
/// with nothing to show without a key, so it is where the field that fixes it
/// belongs; a second copy in this dialog would be a second form for one slot,
/// and a settings row offering to connect something the reader has never seen
/// is a row they cannot judge. What is left here is what settings are actually
/// for: seeing what is connected, and taking it back.
function IssueTrackerRow({
  integrations,
  busy,
  error,
  disconnect,
}: ReturnType<typeof useIntegrations>) {
  const id = useId();
  /// The button arms a confirm that replaces it — the same shape the sidebar's
  /// delete and the PR panel's merge use. Asked for because the key is not
  /// recoverable from here: taking it back means finding the tracker's own
  /// settings page and minting a new one, which is a long way to be sent by a
  /// button pressed on the way to somewhere else.
  const [confirming, setConfirming] = useState(false);

  const account = integrations?.linear ?? null;

  // Nothing connected is nothing to say. The reader is not missing a control:
  // the Issues page in the sidebar is where this starts.
  if (!account) return null;

  return (
    <div className="flex flex-col gap-2">
        <SettingRow
          id={id}
          label="Issue tracker"
          description={
            confirming
              ? "hz will forget the key. Sessions keep the issues they are tagged with."
              : // The mark rather than the word, since the word is already the row's
                // subject — and it is what makes this row findable at a glance in a
                // dialog of sentences.
                <span className="flex items-center gap-1.5">
                  <LinearIcon className="size-3.5" />
                  {account.orgName}, as {account.userName}
                </span>
          }
        >
          {confirming ? (
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  await disconnect();
                  setConfirming(false);
                }}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
          )}
        </SettingRow>

      {error && <p className="text-ui text-destructive">{error}</p>}
    </div>
  );
}

/// Two ways out of the app, and deliberately not a `SettingRow`.
///
/// Nothing here is a setting — there is no state to read back — so the label a row
/// would demand ("Get in touch") sits under a heading that already says Feedback and
/// earns nothing but a third line. A sentence and the two buttons it names is the
/// whole block.
///
/// Both go through `openUrl` — the same route the PR panel and transcript links
/// take, so a link from here lands in the reader's own browser rather than turning
/// the app window into one.
function ContactBlock() {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-ui text-muted-foreground">
        Tell me what&apos;s broken, or send a PR.
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => void openUrl(CONTACT_URL)}>
          Message me
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void openUrl(REPO_URL)}>
          GitHub
        </Button>
      </div>
    </div>
  );
}

/// A run of rows, optionally under a quiet heading.
///
/// The heading is the exception now that the groups are tabs: the tab's own
/// label already names what is below it, so a heading repeating it is a second
/// copy of one word. What still earns one is a block carrying no label of its
/// own, which is the feedback links and nothing else.
///
/// Untitled it is still worth being: the tab panel spaces its groups apart at
/// `gap-7` and this holds rows together at `gap-4`, which is the whole of how a
/// heading ends up nearer what it names than what it follows.
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      {title && <h2 className="text-ui font-medium text-muted-foreground">{title}</h2>}
      {children}
    </section>
  );
}

/// Set *and* order, so a group added later is one entry plus one body.
const SETTINGS_TABS = [
  "appearance",
  "spaces",
  "transcription",
  // Beside Integrations rather than inside it: both are "things that leave the
  // machine", and this one is what the pull-request screens run on. It is the
  // only place that can answer why they will not load.
  "sourceControl",
  // After Transcription, among the occasional setup rather than heading the
  // rail: connecting a provider is done once and then left alone, and the
  // reader who has never done it is sent here by the empty model picker rather
  // than by looking down this list. Named for the providers rather than for the
  // agent: it is the only screen in here that is about *what the agent runs
  // on*, and "Agent" said nothing about what the reader was going to do on it.
  "providers",
  "integrations",
  "shortcuts",
  "about",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

const TAB_LABELS: Record<SettingsTab, string> = {
  providers: "Providers",
  appearance: "Appearance",
  shortcuts: "Shortcuts",
  spaces: "Spaces",
  transcription: "Transcription",
  sourceControl: "Source control",
  integrations: "Integrations",
  about: "About",
};

/// A nav rail down one side and the section's rows in the pane beside it — the
/// shape a settings surface takes once it owns the window.
///
/// **Tabs across the top were right for a 34rem dialog and wrong for a window.**
/// They fit one line there by using the width a card had to spare; here the same
/// seven across the top read as a web form, and the reader hunting one setting
/// scans a horizontal row whose labels are all the same weight. The rail also
/// buys the thing the tabs could not: an icon per group, so Appearance is found
/// by shape as well as by word.
///
/// **A vertical tab list, so the keyboard promise is the vertical one.** Up and
/// Down, Home and End, one Tab stop; `aria-orientation` is what tells a screen
/// reader which half of the four keys to expect.
///
/// **About holds privacy and feedback**, which is the one grouping worth
/// arguing about. Both answer what the app does with you rather than what it
/// does for you: what is collected, and how to reach the person who wrote it.
/// Privacy alone was too thin to be a section and reads oddly next to Appearance.
///
/// Bodies are switched, not hidden, unlike the right panel's. There is no
/// scroll position or expensive render to preserve here, and mounting them all
/// would have the external-app scan run every time this opens whichever section
/// the reader wanted. The pick resets on close for the same reason the open state
/// is not persisted.
function SettingsSections({
  initialTab,
  children,
}: {
  initialTab: SettingsTab;
  children: Record<SettingsTab, ReactNode>;
}) {
  const id = useId();
  // An initializer, not an effect: `DialogContent` unmounts on close, so every
  // open builds this fresh and the caller's section is simply where it starts.
  // That is also what keeps "the pick resets on close" true.
  const [section, setSection] = useState<SettingsTab>(initialTab);

  const index = SETTINGS_TABS.indexOf(section);
  const { refs, onKeyDown } = useRovingGroup(SETTINGS_TABS.length, index, (next) =>
    setSection(SETTINGS_TABS[next]),
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div
        role="tablist"
        aria-label="Settings"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="flex w-56 shrink-0 flex-col border-r border-sidebar-border bg-background"
      >
        {/* The rail's own heading, in the muted weight every group heading in
            the pane wears — the pane's `<h2>` names the section, and this names
            the surface. It is also the dialog's `DialogTitle`, which is why it
            is a heading rather than a word in a `div`. */}
        <DialogHeader className="px-4 pt-1 pb-3">
          <DialogTitle className="text-ui text-muted-foreground">Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-0.5 px-2">
          {SETTINGS_TABS.map((value, i) => {
            const Icon = SECTION_ICONS[value];
            const active = section === value;
            return (
              <button
                key={value}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-${value}`}
                aria-selected={active}
                aria-controls={`${id}-panel`}
                tabIndex={active ? 0 : -1}
                onClick={() => setSection(value)}
                className={cn(
                  "flex h-8 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-ui outline-none transition-colors",
                  // The app's one selected-row token, so a lit section reads the
                  // same as a lit session or a lit file.
                  active
                    ? "bg-sidebar-accent text-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{TAB_LABELS[value]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${section}`}
        className="flex min-w-0 flex-1 flex-col bg-background"
      >
        {/* `key` on the scroll box, so a section opens at its own top: the
            container is the same element across a switch, and Shortcuts is long
            enough that a reader who scrolled it would otherwise land in About
            somewhere past its heading. */}
        <div key={section} className="min-h-0 flex-1 overflow-y-auto px-10 pb-10">
          {/* **Capped, and the heading is inside the cap.** A row is a label and
              a control that want an edge to sit against, and the same row spread
              across a 1400px window leaves the control a page away from the
              sentence explaining it. Centred rather than pinned left, like the
              transcript — and the section's own name belongs to the top of that
              column rather than to the pane's edge, or the heading and the rows
              it names start at two different places and read as two blocks. */}
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 [&>*]:shrink-0">
            {/* Named here as well as in the rail, and that is not repetition: a
                section whose own name is only in the rail while the pane starts
                mid-sentence makes the reader check the rail to know where they
                are. */}
            <h2 className="pt-1 text-lg font-medium">{TAB_LABELS[section]}</h2>

            {children[section]}
          </div>
        </div>
      </div>
    </div>
  );
}

/// One glyph per section, and the rail is the only place they appear.
///
/// Chosen for the word beside them rather than for the app's own vocabulary:
/// these are the reader's questions (`Keyboard` for what key does what, `Mic`
/// for the thing that listens), not the internals behind them.
const SECTION_ICONS: Record<SettingsTab, LucideIcon> = {
  providers: Server,
  appearance: Palette,
  spaces: Layers,
  transcription: Mic,
  sourceControl: GitBranch,
  integrations: Plug,
  shortcuts: Keyboard,
  about: Info,
};

/// Label and control on the top line, reason at full width underneath — and
/// `stacked` for when even that is the wrong shape.
///
/// Side by side was the first shape, and it broke on the widest control here: two
/// buttons pushed the sentence into a third of the dialog, where four words took
/// three lines and the row's height jumped every time the control changed. The
/// description is prose and wants a measure; the control is a fixed thing and wants
/// an edge to sit against.
///
/// `stacked` goes further and puts the control *under* the label at full width. That
/// is for a control too wide to share a line at all — the theme swatches, the mode
/// segments — and it is also where a picker wants to be: options ranged along one
/// edge rather than pushed against the far one.
///
/// `description` is optional only for a control that shows the reader the answer
/// instead of telling them: the theme swatches, and the mode segments while they
/// work. For a switch it is never optional — a switch is a word and a state, and the
/// sentence under it is the only place "why is this off by default" can live. A
/// control that has gone *disabled* always takes one too, whatever its shape, since
/// that sentence is then the only place the reason can be said.
///
/// `asGroup` is for a control that is several elements rather than one input:
/// `htmlFor` only reaches a labelable element, so a radio group has to be pointed the
/// other way and name the label by id instead.
function SettingRow({
  id,
  label,
  description,
  asGroup = false,
  stacked = false,
  children,
}: {
  id: string;
  label: string;
  /// A node, not a string: a row whose reason is best said with a mark beside
  /// it should not have to reach past this for the privilege.
  description?: ReactNode;
  asGroup?: boolean;
  stacked?: boolean;
  children: ReactNode;
}) {
  const labelEl = (
    <label
      id={asGroup ? id : undefined}
      htmlFor={asGroup ? undefined : id}
      className="text-ui font-medium"
    >
      {label}
    </label>
  );
  const descriptionEl = description && (
    <p className="text-ui text-muted-foreground">{description}</p>
  );

  if (stacked) {
    return (
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          {labelEl}
          {descriptionEl}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        {labelEl}
        <div className="shrink-0">{children}</div>
      </div>
      {descriptionEl}
    </div>
  );
}
