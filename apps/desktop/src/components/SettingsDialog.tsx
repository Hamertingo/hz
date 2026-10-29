import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  Building2,
  Download,
  Gauge,
  GitBranch,
  Lightbulb,
  Lock,
  Settings2,
  SquareTerminal,
  User,
  Volume2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Group, Row, Val } from "@/components/kit/kit";
import { Card1 } from "@/components/settings/StudioRow";
import { MacTile } from "@/components/settings/parts";
import { Dialog as DialogPrimitive } from "radix-ui";

import AppIcon from "@/components/AppIcon";
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
import { Skeleton, SkeletonRegion } from "@/components/ui/skeleton";
import Spinner from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppSettings } from "@/hooks/useAppSettings";
import { resetFontSizes, setFontSize, useFontSizes } from "@/hooks/useFontSizes";
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
import { ROW_BOX } from "@/components/settings/StudioRow";
import { SettingsNav } from "@/components/settings/parts";
import ClisSettings from "@/components/settings/ClisSettings";
import DefaultsSettings from "@/components/settings/DefaultsSettings";
import PreferencesSettings from "@/components/settings/PreferencesSettings";
import ProfileSettings from "@/components/settings/ProfileSettings";
import UsageSettings from "@/components/settings/UsageSettings";
import WorkspaceSettings from "@/components/settings/WorkspaceSettings";
import MemoriesSettings from "@/components/settings/MemoriesSettings";
import PrivacySettings from "@/components/settings/PrivacySettings";
import VoiceSettings from "@/components/settings/VoiceSettings";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import TranscriptionSettings from "@/components/settings/TranscriptionSettings";
import { useTranscriptionSettings } from "@/hooks/useTranscription";
import { IS_MAC } from "@/lib/platform";
import { hasLightMode, THEMES } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type {
  ExternalApp,
  GhAccount,
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
  initialTab = "profile",
  updateStatus,
  updateManual,
  updateBlocked,
  onCheckUpdates,
  onInstallUpdate,
  updateChannel,
  onUpdateChannelChange,
  onOpenAgentAccess,
  onOpenAgentMemory,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /// Which tab to open on. The composer's mic button sends the reader straight
  /// to Transcription when no model is downloaded, which is the whole reason
  /// this is a prop rather than internal state.
  initialTab?: SettingsTab;
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
  /// Opens an agent's Access tab (the spend rows on Usage & limits), closing this.
  onOpenAgentAccess?: (agentId: string) => void;
  /// Opens an agent's Memory tab, closing this.
  onOpenAgentMemory?: (agentId: string) => void;
}) {
  const { settings, setAnalyticsEnabled } = useAppSettings(open);
  const transcription = useTranscriptionSettings(open);
  // Starts when the dialog opens, not when its tab is reached: a body is built on
  // arrival, and a read started there would leave the tab blank meanwhile.
  const sourceControl = useSourceControl(open);
  const [advanced, setAdvanced] = useLocalStorage("hz.advancedMode", false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Each row carries its own sentence, so there is no one description the
          dialog is described *by* — left unset, Radix warns about the missing
          `aria-describedby` and pointing it at a row would read that row's copy
          out as the dialog's purpose. */}
      {/* Wider than the dialog default. That default is sized for a question and
          two buttons; this holds prose, and at 25rem the analytics sentence broke
          across three lines with two words on the last one. */}
      {/* A centred sheet, the same frame the apps, routines and pull-request sheets wear. The
          overlay stays: it is what tells the browser tab a modal is over it (`judgeOcclusion`). */}
      <DialogContent
        aria-describedby={undefined}
        showClose={false}
        overlayClassName="bg-black/55 backdrop-blur-[2px]"
        className="top-1/2 left-1/2 flex h-[min(600px,calc(100vh-48px))] w-[min(920px,calc(100vw-48px))] max-w-none -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-(--r4) border-0 bg-(--sheet) p-0 text-ink shadow-(--shadow) ring-1 ring-line2 backdrop-blur-xl"
      >
        <SettingsSections initialTab={initialTab} advanced={advanced}>
          {{
            profile: <ProfileSettings />,
            prefs: (
              <PreferencesSettings
                advanced={advanced}
                onAdvanced={setAdvanced}
                extras={{
                  // The palettes the old Appearance page offered, kept under the
                  // mode picker: Theme above is light/dark/system, this is which
                  // colours.
                  theme: <ThemeRow />,
                  appearance: (
                    <Section title="Font size">
                      <FontSizeRows />
                    </Section>
                  ),
                  apps: (
                    <Section title="Apps">
                      <OpenFilesRow />
                      <BrowserRow />
                    </Section>
                  ),
                }}
              />
            ),
            voice: (
              <VoiceSettings>
                <Section title="Dictation">
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
                </Section>
              </VoiceSettings>
            ),
            privacy: (
              <PrivacySettings>
                <Section title="Reports">
                  <AnalyticsRow view={settings} onChange={setAnalyticsEnabled} />
                </Section>
              </PrivacySettings>
            ),
            workspace: <WorkspaceSettings onOpenAgent={onOpenAgentAccess} />,
            defaults: <DefaultsSettings />,
            memories: <MemoriesSettings onOpen={onOpenAgentMemory} />,
            usage: <UsageSettings onOpenAccess={(id) => onOpenAgentAccess?.(id)} />,
            clis: (
              <ClisSettings
                extras={
                  <>
                    <SourceControlSettings {...sourceControl} />
                  </>
                }
              />
            ),
            updates: (
              <>
                <div className="mt-1 flex flex-col gap-2">
                  <UpdatesRow
                    status={updateStatus}
                    manual={updateManual}
                    blocked={updateBlocked}
                    onCheck={onCheckUpdates}
                    onInstall={onInstallUpdate}
                  />
                </div>
                <div>
                  <BetaUpdatesRow channel={updateChannel} onChange={onUpdateChannelChange} />
                </div>
                <ContactBlock />
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
    <SettingRow id={id} asGroup label="Theme" description="The tone of backgrounds and text, in light and dark.">
      <div role="radiogroup" aria-labelledby={id} onKeyDown={onKeyDown} className="flex items-start gap-2">
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
            className="group flex min-w-[52px] cursor-pointer flex-col items-center gap-[5px] outline-none"
          >
            <span
              data-theme={name}
              data-mode={hasLightMode(name) ? resolvedMode : "dark"}
              className={cn(
                "theme-swatch h-9 w-[52px] rounded-[9px] border-0 transition-shadow",
                theme === name
                  ? "shadow-[0_0_0_2px_var(--ink)]"
                  : "shadow-[inset_0_0_0_1px_var(--line2)] group-hover:shadow-[inset_0_0_0_1px_var(--line3)] group-focus-visible:shadow-[0_0_0_2px_var(--ring)]",
              )}
            />
            <span className={cn("text-[11.5px] whitespace-nowrap", theme === name ? "text-ink" : "text-ink3")}>{label}</span>
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
      ? "No editor Hyze Code knows about is installed, so filenames open in Finder."
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
              {apps === null ? <Skeleton className="h-3 w-20" /> : <span className="truncate">{pick?.name ?? "None"}</span>}
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
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);

  return (
    <Card1
      lead={
        <MacTile dot={ready ? "bg-amber" : "bg-green"}>
          <Download className="size-[22px]" />
        </MacTile>
      }
      title={version ? `hz ${version}` : "hz"}
      sub={updateFailure(manual) ?? (ready ? `Version ${status.version} is ready to install.` : "Installs when no agent is mid-turn.")}
    >
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
    </Card1>
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
function SourceControlSettings({
  state,
  error,
  loading,
  recheck,
}: ReturnType<typeof useSourceControl>) {
  const [stillMissing, setStillMissing] = useState(false);

  const check = async () => {
    setStillMissing(false);
    await recheck();
    setStillMissing(true);
  };

  if (!state) {
    return (
      <Section>
        {error ? (
          <p className="text-ui text-muted-foreground">{`Could not read what is installed — ${error}`}</p>
        ) : (
          <SkeletonRegion label="Reading what is installed" className="flex items-center gap-3">
            <Skeleton className="size-5 rounded-[5px]" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-2.5 w-52" />
            </div>
            <Skeleton className="ml-auto h-7 w-16 rounded-md" />
          </SkeletonRegion>
        )}
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
            ? "Every checkout, branch and diff Hyze Code runs goes through it."
            : "Not on this machine, so there is nothing here for Hyze Code to diff."
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
          " Still not found — Hyze Code looks where your login shell does, so an install that landed somewhere else needs the app restarted."}
      </>
    );
  }

  if (gh.error) {
    return (
      <>
        <code className="text-foreground">{gh.tokenSource ?? "A credential"}</code> is set, and
        GitHub turned it down — {gh.error}. That is the token itself rather than anything Hyze Code can
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
          "Chromium will be downloaded again the next time Hyze Code starts."
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
    <Group>
      <Row lead={<Lightbulb />} title="Send feedback" sub="Tell me what's broken." right={<Val kind="next" />} onClick={() => void openUrl(CONTACT_URL)} />
      <Row lead={<GitBranch />} title="GitHub" sub="Or send a PR." right={<Val kind="next" />} onClick={() => void openUrl(REPO_URL)} />
    </Group>
  );
}

/// A run of rows, optionally under a quiet heading. The rows share hairlines and round at the
/// ends (see `SettingRow`), so there is no gap between them.
function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-3 flex flex-col first:mt-5">
      {title && <h2 className="mb-2 px-1 text-xs leading-normal font-medium text-ink3">{title}</h2>}
      {children}
    </section>
  );
}

/// Set *and* order, so a page added later is one entry plus one body. Grouped the way the
/// mockup's rail is: the reader, then the workspace, then the app.
const SETTINGS_TABS = [
  "profile",
  "prefs",
  "voice",
  "privacy",
  "workspace",
  "defaults",
  "memories",
  "usage",
  "clis",
  "updates",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

const TAB_LABELS: Record<SettingsTab, string> = {
  profile: "Profile",
  prefs: "Preferences",
  voice: "Voice",
  privacy: "Privacy",
  workspace: "Workspace",
  defaults: "Agents",
  memories: "Memories",
  usage: "Usage & limits",
  clis: "CLIs",
  updates: "Updates",
};

const TAB_GROUPS: { heading: string; tabs: readonly SettingsTab[] }[] = [
  { heading: "You", tabs: ["profile", "prefs", "voice", "privacy"] },
  { heading: "Workspace", tabs: ["workspace", "defaults", "memories", "usage", "clis"] },
  { heading: "hz", tabs: ["updates"] },
];

/// Usage & limits and CLIs are the technical pages; Advanced mode on Preferences shows them.
const ADVANCED_TABS: readonly SettingsTab[] = ["usage", "clis"];

const SECTION_ICONS: Record<SettingsTab, LucideIcon> = {
  profile: User,
  prefs: Settings2,
  voice: Volume2,
  privacy: Lock,
  workspace: Building2,
  defaults: Zap,
  memories: Brain,
  usage: Gauge,
  clis: SquareTerminal,
  updates: Download,
};

/// A rail down the left and the page beside it, in a centred sheet like the apps, routines and
/// pull-request sheets.
///
/// **A vertical tab list, so the keyboard promise is the vertical one.** Up and Down, Home and
/// End, one Tab stop; `aria-orientation` tells a screen reader which half of the four keys to
/// expect. The rail skips the advanced pages while Advanced mode is off, and the roving group is
/// told about the list that is drawn rather than the full one.
///
/// Bodies are switched, not hidden: mounting them all would run the external-app scan every time
/// this opens whichever page the reader wanted, and the pick resets on close for the same reason
/// the open state is not persisted.
function SettingsSections({
  initialTab,
  advanced,
  children,
}: {
  initialTab: SettingsTab;
  advanced: boolean;
  children: Record<SettingsTab, ReactNode>;
}) {
  const id = useId();
  // An initializer, not an effect: `DialogContent` unmounts on close, so every open builds this
  // fresh and the caller's page is simply where it starts.
  const [section, setSection] = useState<SettingsTab>(initialTab);

  const shown = SETTINGS_TABS.filter((t) => advanced || !ADVANCED_TABS.includes(t) || t === section);
  const index = Math.max(0, shown.indexOf(section));
  const { refs, onKeyDown } = useRovingGroup(shown.length, index, (next) => setSection(shown[next]));

  return (
    <SettingsNav.Provider value={(tab) => setSection(tab as SettingsTab)}>
    <div className="flex min-h-0 flex-1">
      <DialogHeader className="sr-only">
        <DialogTitle>Settings</DialogTitle>
      </DialogHeader>
      <div
        role="tablist"
        aria-label="Settings"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="flex w-[200px] shrink-0 flex-col gap-px scrollbar-none overflow-y-auto border-r border-line bg-(--side) px-2 py-4"
      >
        {TAB_GROUPS.map((group) => {
          const tabs = group.tabs.filter((t) => shown.includes(t));
          if (tabs.length === 0) return null;
          return (
            <Fragment key={group.heading}>
              <div className="px-2.5 pt-3.5 pb-1 text-[11px] font-medium text-ink4 first:pt-0.5">{group.heading}</div>
              {tabs.map((value) => {
                const i = shown.indexOf(value);
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
                      "flex h-8 cursor-pointer items-center gap-2.5 rounded-(--r1) px-2.5 text-left text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                      active ? "bg-s3 text-ink" : "text-ink2 hover:bg-s2 hover:text-ink",
                    )}
                  >
                    <Icon className={cn("size-4 shrink-0", active ? "text-ink" : "text-ink3")} aria-hidden />
                    <span className="truncate">{TAB_LABELS[value]}</span>
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </div>

      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${section}`} className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-3 px-6 pt-[18px] pb-1.5">
          <h2 className="flex-1 text-[18px] leading-[1.3] font-semibold tracking-[-0.015em]">{TAB_LABELS[section]}</h2>
          <DialogPrimitive.Close
            aria-label="Close"
            className="grid size-[26px] cursor-pointer place-items-center rounded-md text-ink2 transition-colors outline-none hover:bg-s3 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <X className="size-[15px]" aria-hidden />
          </DialogPrimitive.Close>
        </div>
        {/* `key` on the scroll box, so a page opens at its own top: the container is the same
            element across a switch, and a reader who scrolled Preferences would otherwise land
            in the next page somewhere past its heading. */}
        <div key={section} className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-6">
          <div className="flex w-full flex-col gap-2 [&>*]:shrink-0">{children[section]}</div>
        </div>
      </div>
    </div>
    </SettingsNav.Provider>
  );
}

/// Label and reason on the left, control on the right, in the same hairline row `StudioRow`
/// draws, so the pages built from either read as one. `stacked` puts the control under the label
/// at full width, for a picker too wide to share a line.
///
/// `description` is optional only for a control that shows the reader the answer instead of
/// telling them (the theme swatches). For a switch it is never optional, and a control that has
/// gone *disabled* always takes one, since that sentence is then the only place the reason can
/// be said. `asGroup` is for a control that is several elements: `htmlFor` only reaches a
/// labelable element, so a radio group names its label by id instead.
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
  /// A node, not a string: a row whose reason is best said with a mark beside it should not have
  /// to reach past this for the privilege.
  description?: ReactNode;
  asGroup?: boolean;
  stacked?: boolean;
  children: ReactNode;
}) {
  const text = (
    <div className="min-w-0 flex-1">
      <label id={asGroup ? id : undefined} htmlFor={asGroup ? undefined : id} className="block text-[13px] leading-[1.4] font-medium">
        {label}
      </label>
      {description && <p className="mt-px text-xs leading-[1.45] text-ink3">{description}</p>}
    </div>
  );

  return (
    <div
      className={cn(
        ROW_BOX,
        stacked ? "flex flex-col gap-2.5" : "flex items-center gap-[11px]",
      )}
    >
      {text}
      <div className={cn(stacked ? "min-w-0" : "shrink-0")}>{children}</div>
    </div>
  );
}
