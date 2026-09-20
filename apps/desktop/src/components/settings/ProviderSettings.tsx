import { useId, useMemo, useState, type ReactNode } from "react";

import { invoke } from "@tauri-apps/api/core";
import { Activity, ChevronDown, Plus, Trash2, X } from "lucide-react";

import ProviderMark, { hostOf, presetFor } from "@/components/settings/ProviderMark";
import ProviderModels from "@/components/settings/ProviderModels";
import { Button } from "@/components/ui/button";
import { Input, inputClassName } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HIDDEN_MODELS_KEY, byBase, hiddenSet, rowShown } from "@/lib/modelVisibility";
import { usePreference } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import type { Model, ModelId, NewProvider, Provider, ProviderPreset } from "@/types/events";

/// Where models come from — **the one setup step hz has.**
///
/// The agent ships inside this app and arrives with no models at all: not one
/// of them is usable until the reader connects something, which is a base URL,
/// a dialect and a key. That is the whole of this screen.
///
/// **One list of gateways, not a list plus a way to add one.** What is
/// connected and what could be were two groups of identically-built cards
/// before — the working setup the reader scrolled past to reach the button,
/// under a heading calling it *add*. Nothing here is added: a gateway is
/// either connected, and the card says what it holds, or it is not, and the
/// same card offers the one field that changes that. That is the whole
/// vocabulary, so there is exactly one place to look for either answer.
///
/// **The form opens inside the row, not in a dialog.** Picking a gateway *is*
/// the click that opens it — the reader has already decided — so a modal in
/// between is a second confirmation for one decision, and it takes the list
/// away at the moment the row under the cursor is the thing being explained.
///
/// **And a connected card opens on the same gesture, onto its models.** The
/// question after "is it connected" is "which of these do I want in the picker",
/// and the answer is every model the provider serves, each with a switch — see
/// [`ProviderModels`](ProviderModels.tsx). That is why the two actions about the
/// *provider* rather than about its models moved into the footer of what opens:
/// the header is the button, and a button inside a button is neither.
///
/// **The switches are the composer's list, handed down.** A model is named by
/// the wire id the picker holds — `m:<provider>:<model>:v:<variant>` — and
/// `provider list`, which this screen reads for the connections, does not state
/// one. Reading the model list here instead would mean composing an id out of a
/// bare name and a guess at which variants the model has, so the two surfaces
/// would disagree about rows the reader is looking at in both.
///
/// **Nothing here is MiniMax's own account.** The CLI always reports the two
/// entries it keeps for that account, signed in or not, and the backend drops
/// them before they reach this screen: there is no login to draw and no key
/// field for one. A provider a reader connects is the only kind that exists
/// here.
///
/// **The key is written, and read back only as the agent redacts it.** What a
/// connected row draws is `maskedApiKey` — `sk-q****CXTE` — which the CLI
/// produces for its own list. The app still never holds the secret after
/// handing it over; four characters are enough to answer the one question a
/// row has about a key, which is whether it is the one just pasted.

const API_FORMATS = [
  { id: "anthropic-messages", label: "Anthropic messages" },
  { id: "openai-completions", label: "OpenAI chat completions" },
  { id: "openai-responses", label: "OpenAI responses" },
];

/// One gateway's own state, so a form's failure or a test's answer lands under
/// the card it was run for rather than in one shared line at the bottom.
///
/// `busy` names **which** action is running, because the spinner belongs where
/// the press was — a bare dot beside the name said "something is happening"
/// and left the reader looking at the row to work out what.
type RowState = {
  busy: null | "test" | "remove" | "connect";
  note: string | null;
  error: string | null;
};

const EMPTY_ROW: RowState = { busy: null, note: null, error: null };

/// A gateway as this screen draws it: a preset, whatever it is connected as,
/// or one the reader wrote by hand and which therefore belongs to no preset.
type Gateway = {
  /// Stable across renders — a preset's slug, or a provider id.
  key: string;
  /// Which mark to draw; empty for a gateway with none.
  markId: string;
  name: string;
  /// Why a reader would want it. Presets carry one; a hand-written provider
  /// does not need telling, it is the one they just described.
  note: string | null;
  preset: ProviderPreset | null;
  connected: Provider | null;
};

const CUSTOM_KEY = "custom";

export default function ProviderSettings({
  listed,
  presets,
  error,
  apply,
  models = [],
  onRefreshModels,
  loadingModels,
}: {
  /// What the agent has configured, and the two ways it changes — read and owned
  /// by [`useProviders`](../hooks/useProviders.ts), which starts that read when
  /// **Settings** opens. This screen is built when the reader arrives at it, so a
  /// read started here would leave it blank for as long as the CLI takes.
  listed: Provider[] | null;
  presets: ProviderPreset[];
  error: string | null;
  /// Every mutation answers with the list as it stands after, so this screen
  /// never has to guess what the CLI did.
  apply: (providers: Provider[]) => void;
  /// Every model the agent serves, which is the **composer's own list** rather
  /// than anything read here. The switches decide which of these rows the picker
  /// draws, so the two sides have to be speaking about the same rows — and a
  /// model is named here by the wire id the picker holds, which `provider list`
  /// does not state. A provider serving nothing the probe found falls back to
  /// what the CLI itself reports; see `count` below.
  models?: Model[];
  onRefreshModels?: () => void;
  /// The composer's own read of that list, so a refresh started here shows the
  /// same spinner it would there.
  loadingModels?: boolean;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  /// Which gateway's body is open — the key field where it is not connected, the
  /// model list where it is. One at a time, because two bodies on screen is two
  /// things being read at once and only one can be the answer to a click.
  const [open, setOpen] = useState<string | null>(null);
  /// The row waiting to be told twice. One id for the whole screen, never a
  /// flag per row: two rows asking at once is one press answering two
  /// questions.
  const [confirming, setConfirming] = useState<string | null>(null);
  /// Which models the reader has switched off — the composer's picker reads the
  /// same preference, so a switch here is a row that leaves the menu there.
  const [hidden, setHidden] = usePreference(HIDDEN_MODELS_KEY, null);
  // `null` is "none hidden", and every reader below wants the list itself.
  const hiddenModels = hidden ?? [];

  /// One gateway's controls' state, and one place that clears it: a new action
  /// starts from what the row had and overwrites only what it says, so a test
  /// result is not wiped by the next click on something else.
  const setRow = (key: string, next: Partial<RowState>) =>
    setRows((prev) => {
      const current = prev[key] ?? EMPTY_ROW;
      return { ...prev, [key]: { ...current, ...next } };
    });

  /// A mutation: removes a provider and answers with the list as it stands.
  ///
  /// No note on success — the card that changed *is* the answer, and "Saved"
  /// was a line about nothing on a screen where every row already shows what
  /// it holds. The one sentence worth keeping is the one a connect writes,
  /// because it tells the reader where to go next.
  const act = async (key: string, action: "remove", work: () => Promise<Provider[]>) => {
    setConfirming(null);
    setRow(key, { busy: action, note: null, error: null });
    try {
      apply(await work());
      setRow(key, { busy: null });
    } catch (err) {
      setRow(key, { busy: null, error: String(err) });
    }
  };

  /// Runs the CLI's own connection test and shows **its** sentence.
  ///
  /// Not through [`act`] like the mutations: that one reports "Saved" when its
  /// work lands, so a test routed through it reported saving a list nobody
  /// changed and threw the gateway's answer away — the test said nothing, in
  /// other words. Nothing about a test writes, so it takes its own path.
  const test = async (provider: Provider) => {
    setConfirming(null);
    setRow(provider.providerId, { busy: "test", note: null, error: null });
    try {
      // One model, named, rather than the provider as a whole: a gateway can
      // answer for a provider and still refuse the model the reader picked, and
      // the first row is the one the connect tested when it was made.
      const note = await invoke<string>("test_provider", {
        providerId: provider.providerId,
        model: provider.models[0]?.modelId ?? null,
      });
      setRow(provider.providerId, { busy: null, note });
    } catch (err) {
      setRow(provider.providerId, { busy: null, error: String(err) });
    }
  };

  const remove = (provider: Provider) =>
    act(provider.providerId, "remove", () =>
      invoke<Provider[]>("remove_provider", { providerId: provider.providerId }),
    );

  /// Connects a gateway and reports where to go next.
  ///
  /// **The card that was not there before is the one just connected**, and it
  /// is the only place worth saying so: the reader lands back on a list whose
  /// new entry already carries its model count, and the next thing they do is
  /// pick one of them in the composer.
  const connect = async (key: string, spec: NewProvider, before: Provider[]) => {
    setRow(key, { busy: "connect", note: null, error: null });
    try {
      const after = await invoke<Provider[]>("add_provider", { provider: spec });
      const added = after.find(
        (next) => !before.some((old) => old.providerId === next.providerId),
      );
      apply(after);
      setOpen(null);
      // The note rides the *provider's* key, which is the row the card becomes
      // once `listed` lands — the preset's own key is gone by then.
      setRow(added?.providerId ?? key, {
        busy: null,
        note: "Connected — pick a model in the composer",
      });
    } catch (err) {
      setRow(key, { busy: null, error: String(err) });
    }
  };

  if (!listed) {
    return (
      <div className="flex flex-col gap-3">
        {error ? (
          <p className="text-ui text-destructive">{error}</p>
        ) : (
          // **Rows, not a spinner.** The list is one CLI call, so this is either
          // a blink or a second of waiting, and a lone 14px arc at the top of
          // an otherwise empty pane read as the page having failed to draw.
          // Each placeholder is built from the real card's own boxes — the
          // 36px mark, then a name line and a note line of the sizes they take
          // — so nothing below moves when the list lands.
          <>
            <p className="sr-only" role="status">
              Reading this machine's providers…
            </p>
            <div aria-hidden aria-busy className="flex flex-col gap-3">
              {[0, 1].map((row) => (
                <div
                  key={row}
                  className="flex items-center gap-3.5 rounded-xl border border-border/60 px-4 py-3.5"
                >
                  <span className="size-9 shrink-0 animate-pulse rounded-lg bg-muted-foreground/15" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="h-[1.4em] w-32 animate-pulse rounded bg-muted-foreground/20" />
                    <span className="h-[1.4em] w-56 animate-pulse rounded bg-muted-foreground/10" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const byPreset = new Map<string, Provider>();
  const extras: Provider[] = [];
  for (const provider of listed) {
    const preset = presetFor(provider, presets);
    if (preset) byPreset.set(preset.id, provider);
    else extras.push(provider);
  }

  // Preset order is the order on screen and stays that way as things connect:
  // a row that jumped to the top under the reader's cursor would move the form
  // they are typing into. A hand-written provider has no preset to sit under,
  // so it goes last.
  const gateways: Gateway[] = [
    ...presets.map((preset) => ({
      key: preset.id,
      markId: preset.id,
      name: preset.name,
      note: preset.note,
      preset,
      connected: byPreset.get(preset.id) ?? null,
    })),
    ...extras.map((provider) => ({
      key: provider.providerId,
      markId: "",
      name: provider.name,
      note: null,
      preset: null,
      connected: provider,
    })),
  ];

  return (
    <div className="flex flex-col gap-7">
      {error && <p className="text-ui text-destructive">{error}</p>}

      <div className="flex flex-col gap-3">
        {listed.length === 0 && (
          // **The one reader who has to be told.** They arrive here from a model
          // picker with nothing in it, so the sentence says what this screen is
          // for before drawing the ways to use it.
          <p className="max-w-prose text-ui text-muted-foreground">
            No provider is connected, so the agent has no models to run. Connect one below — hz
            asks it which models it serves, and the composer's own picker fills in by itself.
          </p>
        )}

        {gateways.map((gateway) => {
          const state = rows[gateway.key] ?? EMPTY_ROW;
          const connected = gateway.connected;
          return connected ? (
            <ConnectedCard
              key={gateway.key}
              gateway={gateway}
              provider={connected}
              models={models}
              hidden={hiddenModels}
              onHiddenChange={setHidden}
              onRefreshModels={() => onRefreshModels?.()}
              loadingModels={loadingModels ?? false}
              open={open === gateway.key}
              onToggle={() => setOpen((prev) => (prev === gateway.key ? null : gateway.key))}
              state={state}
              confirming={confirming === connected.providerId}
              onTest={() => void test(connected)}
              onAskDelete={() => setConfirming(connected.providerId)}
              onKeepIt={() => setConfirming(null)}
              onDelete={() => void remove(connected)}
            />
          ) : (
            <ConnectCard
              key={gateway.key}
              gateway={gateway}
              open={open === gateway.key}
              state={state}
              onToggle={() => setOpen((prev) => (prev === gateway.key ? null : gateway.key))}
              onConnect={(spec) => void connect(gateway.key, spec, listed)}
            />
          );
        })}

        {/* **Discreet, and last.** A gateway hz has never heard of is the rare
            case, and a fourth card of equal weight would read as a third
            recommendation — the list above is two gateways the reader was
            brought here to connect, and this is the door out of it. */}
        <CustomGateway
          open={open === CUSTOM_KEY}
          state={rows[CUSTOM_KEY] ?? EMPTY_ROW}
          onToggle={() => setOpen((prev) => (prev === CUSTOM_KEY ? null : CUSTOM_KEY))}
          onConnect={(spec) => void connect(CUSTOM_KEY, spec, listed)}
        />
      </div>
    </div>
  );
}

/// One connected gateway: what it is, what the agent says it holds, and — under
/// it — every model it serves with a switch on each.
///
/// **The card is the button, and what it opens is the models.** That is the whole
/// reason a connected provider is a card rather than a row: the reader's next
/// question after "is it connected" is "which of these do I actually want in the
/// picker", and the answer is forty rows that would have nowhere to go if they
/// were always drawn. The two things that act on the *provider* rather than on
/// its models — test it, forget it — ride in the footer of what opens, which is
/// also what keeps them from sitting a stray click away on a card the reader only
/// meant to read.
///
/// **The facts are one muted line**, and the connection state is a chip beside
/// the name rather than a word repeated in it. They were a single `·`-joined
/// string once — "Key stored · 12 models · gpt-5, o3, claude" — which truncated
/// the model list mid-id and read a test result as one more inventory field.
///
/// **A provider the agent lists with no models cannot be used, and it is not a
/// state this app leaves one in.** The list is fetched from the gateway the
/// moment it is connected, so an empty one came from the agent's own TUI and
/// the fix is to connect it here, which fetches. It is the one thing on this
/// card marked as a problem, and the mark is a chip of its own rather than a
/// colour on the sentence — the sentence is the same length either way.
function ConnectedCard({
  gateway,
  provider,
  models,
  hidden,
  onHiddenChange,
  onRefreshModels,
  loadingModels,
  open,
  onToggle,
  state,
  confirming,
  onTest,
  onAskDelete,
  onKeepIt,
  onDelete,
}: {
  gateway: Gateway;
  provider: Provider;
  /// Every model the agent serves, narrowed below to this provider's.
  models: Model[];
  hidden: ModelId[];
  onHiddenChange: (next: ModelId[]) => void;
  onRefreshModels: () => void;
  loadingModels: boolean;
  open: boolean;
  onToggle: () => void;
  state: RowState;
  confirming: boolean;
  onTest: () => void;
  onAskDelete: () => void;
  onKeepIt: () => void;
  onDelete: () => void;
}) {
  /// This provider's own rows, taken from the **composer's list** rather than
  /// from `provider list`: the switches decide which of those rows the picker
  /// draws, and a model there is named by a wire id this screen would otherwise
  /// have to compose out of a name and a guess at its variants.
  const rows = useMemo(
    () => byBase(models.filter((model) => model.provider === provider.providerId)),
    [models, provider.providerId],
  );
  // The agent's own count where the probe has nothing to say about this provider
  // — a session's list is what it will accept right now, `provider list` what it
  // holds, and the two can differ for a moment after a connect.
  const count = rows.length || provider.models.length;
  const empty = count === 0;
  const hiddenCount = rows.filter((row) => !rowShown(row, hiddenSet(hidden))).length;

  const facts = [
    hostOf(provider.baseUrl),
    API_FORMATS.find((format) => format.id === provider.apiFormat)?.label ?? provider.apiFormat,
    count > 0 ? `${count} ${count === 1 ? "model" : "models"}` : null,
    // **The summary the collapsed card owes**, since a switched-off model is
    // otherwise invisible until the card is opened — and the list itself says
    // the same thing once it is, so this is the one place it is said.
    hiddenCount > 0 ? `${hiddenCount} hidden` : null,
    provider.maskedApiKey,
  ]
    .filter((part): part is string => part != null)
    .join(" · ");

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border transition-colors",
        open ? "border-ring/60 bg-card/30" : "border-border/60 bg-card/30 hover:border-border",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left outline-none focus-visible:bg-sidebar-accent/50"
      >
        <ProviderMark id={gateway.markId} name={gateway.name} />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-ui font-medium text-foreground">{gateway.name}</span>
            {empty ? <Chip tone="bad">No models</Chip> : <Chip tone="good">Connected</Chip>}
          </div>
          {facts && <p className="text-ui text-muted-foreground">{facts}</p>}
        </div>

        {/* The word is what says a click opens something, rather than that the
            card does something on its own — the chevron alone is the same glyph
            the composer's picker wears for the same reason, and a reader sent
            here with no models is looking for exactly this. */}
        <span className="flex shrink-0 items-center gap-1.5 text-ui text-muted-foreground">
          Models
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>

      {open && (
        <>
          {rows.length > 0 ? (
            <div className="border-t border-border/60">
              <ProviderModels
                rows={rows}
                hidden={hidden}
                onHiddenChange={onHiddenChange}
                onRefresh={onRefreshModels}
                loading={loadingModels}
              />
            </div>
          ) : (
            <p className="border-t border-border/60 px-4 py-3 text-ui text-muted-foreground">
              The agent lists no models for it. Connect it again to fetch them.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-4 py-2.5">
            {confirming ? (
              // Asked in the card rather than in a dialog, which would take the
              // whole window over a key the reader can paste again. Same shape
              // the transcription models use, down to the X that means "keep it".
              <>
                <span className="mr-1 text-ui text-muted-foreground">
                  Forget this provider and its key?
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={state.busy !== null}
                  onClick={onDelete}
                  aria-label={`Remove ${gateway.name}`}
                  className="cursor-pointer"
                >
                  {state.busy === "remove" ? <Spinner className="size-3.5" /> : "Remove"}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={state.busy !== null}
                  onClick={onKeepIt}
                  aria-label={`Keep ${gateway.name}`}
                  className="cursor-pointer text-muted-foreground hover:text-foreground"
                >
                  <X />
                </Button>
              </>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={state.busy !== null}
                      onClick={onTest}
                      className="cursor-pointer disabled:opacity-100"
                    >
                      {/* **Progress where the press was.** The spinner replaces
                          the glyph that was there rather than floating beside
                          the name, which is the bargain the dictation control
                          makes — the state after a press should say the app is
                          working on what was asked, in the place that was
                          pressed. `disabled:opacity-100`, so the spinning arc is
                          not dimmed to invisible while it runs. */}
                      {state.busy === "test" ? <Spinner className="size-3.5" /> : <Activity />}
                      Test connection
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Sends one prompt to this provider's first model, then reads the list back
                  </TooltipContent>
                </Tooltip>

                {/* `readOnly` is the managed account's own entry, which this app
                    neither shows nor writes — the check is here so the card
                    cannot grow a Remove that the CLI would refuse. */}
                {!provider.readOnly && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={state.busy !== null}
                    onClick={onAskDelete}
                    className="cursor-pointer text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 />
                    Remove
                  </Button>
                )}
              </>
            )}

            {state.note && <p className="text-ui text-muted-foreground">{state.note}</p>}
            {state.error && <p className="text-ui text-destructive">{state.error}</p>}
          </div>
        </>
      )}
    </div>
  );
}

/// A gateway that is not connected: the pitch, and — on click — its one field.
///
/// **The card is the button**, so a `Connect` button beside it would be a second
/// control saying the same thing at a different distance from the cursor. The
/// chevron and the word are what say the click opens something underneath
/// rather than doing it in place, and the word flips to `Cancel` once it has.
function ConnectCard({
  gateway,
  open,
  state,
  onToggle,
  onConnect,
}: {
  gateway: Gateway;
  open: boolean;
  state: RowState;
  onToggle: () => void;
  onConnect: (spec: NewProvider) => void;
}) {
  const preset = gateway.preset;
  const busy = state.busy === "connect";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border transition-colors",
        // The open one takes the ring colour rather than a second border, so
        // the card the reader is typing into is the one that looks focused —
        // the same signal `focus-visible` gives a field.
        open
          ? "border-ring/60 bg-card/30"
          : "border-border/60 hover:border-border hover:bg-sidebar-accent/40",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left outline-none focus-visible:bg-sidebar-accent/50"
      >
        <ProviderMark id={gateway.markId} name={gateway.name} />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-ui font-medium text-foreground">{gateway.name}</span>
          {gateway.note && (
            <span className="text-ui text-muted-foreground">{gateway.note}</span>
          )}
        </div>

        <span className="flex shrink-0 items-center gap-1.5 text-ui text-muted-foreground">
          {open ? "Cancel" : "Connect"}
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </span>
      </button>

      {open && preset && (
        <div className="border-t border-border/60 px-4 pt-4 pb-4">
          <KeyForm
            host={hostOf(preset.baseUrl)}
            busy={busy}
            error={state.error}
            onSubmit={(apiKey) =>
              onConnect({
                name: preset.name,
                baseUrl: preset.baseUrl,
                apiFormat: preset.apiFormat,
                // Empty is the ordinary case: it means "ask the provider", and
                // the backend fills it in from the gateway's own list endpoint
                // before the CLI is called. Naming two ids here would hand the
                // reader a fraction of what they paid for.
                models: [],
                apiKey,
                // A preset is always the default: the reader has no other way
                // to say which provider a new session runs on, since the CLI
                // has no `provider use <id>` — the choice is made by the model
                // they pick.
                makeDefault: true,
              })
            }
          />
        </div>
      )}
    </div>
  );
}

/// The key field, which is the whole of connecting a preset.
///
/// **One field, because everything else is a fact hz already holds.** The URL
/// and the dialect are stated above the box rather than drawn as two filled-in
/// inputs a reader is not meant to touch — fields nobody is meant to touch
/// invite touching, and the CLI's own default for `provider add` is
/// `anthropic-messages`, which is the field a reader would get wrong by hand.
function KeyForm({
  host,
  busy,
  error,
  onSubmit,
}: {
  host: string | null;
  busy: boolean;
  error: string | null;
  onSubmit: (apiKey: string) => void;
}) {
  const id = useId();
  const [apiKey, setApiKey] = useState("");

  const submit = () => {
    if (!apiKey.trim() || busy) return;
    onSubmit(apiKey);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-ui font-medium">
          API key
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={id}
            // The reader opened this form to type in it, and it is its only
            // field.
            autoFocus
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            placeholder="sk-…"
            className="flex-1 text-ui md:text-ui"
            onChange={(e) => setApiKey(e.currentTarget.value)}
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy || !apiKey.trim()}
            className="cursor-pointer"
          >
            {busy ? <Spinner className="size-3.5" /> : "Save"}
          </Button>
        </div>
      </div>

      <p className="text-ui text-muted-foreground">
        {host ? (
          <>
            hz sends it to <span className="text-foreground">{host}</span> and registers the
            models that come back. The key is handed to the agent, and this screen shows only
            what the agent redacts.
          </>
        ) : (
          "hz asks the gateway which models it serves and registers them."
        )}
      </p>

      {/* The connection test is the CLI's own and it runs the first model, so a
          connect is a few seconds of real work rather than a file write. Saying
          what it is doing beats a button that looks stuck. */}
      {busy && (
        <p className="text-ui text-muted-foreground">
          Testing the key and reading the model list…
        </p>
      )}
      {error && <p className="text-ui text-destructive">{error}</p>}
    </form>
  );
}

/// The door out of the preset list: any OpenAI- or Anthropic-shaped gateway,
/// described by hand.
///
/// Folded away behind a plain line rather than drawn as an equal card. The two
/// presets are what the reader was sent here to connect; this is for the one
/// who already knows they are running something else, and they will find it —
/// the alternative is a third card that reads as a third recommendation.
function CustomGateway({
  open,
  state,
  onToggle,
  onConnect,
}: {
  open: boolean;
  state: RowState;
  onToggle: () => void;
  onConnect: (spec: NewProvider) => void;
}) {
  const ids = useId();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiFormat, setApiFormat] = useState(API_FORMATS[0].id);
  const [models, setModels] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const busy = state.busy === "connect";

  const submit = () => {
    if (busy) return;
    onConnect({
      name,
      baseUrl,
      apiFormat,
      // One id per line, and normally left empty: an empty list asks the
      // provider's own `/models` for everything it serves. Typing ids is the
      // fallback for a provider that publishes no list at all.
      models: models
        .split("\n")
        .map((model) => model.trim())
        .filter(Boolean),
      apiKey,
      makeDefault,
    });
  };

  // Closed, it is a line of text and nothing more. Open, it is the same card
  // the presets use — the reader is in that flow now, and a form floating on
  // its own under a link reads as something that fell out of the list.
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        className="flex w-fit cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-ui text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:bg-sidebar-accent/50"
      >
        <Plus className="size-3.5" aria-hidden />
        Connect another gateway
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ring/60 bg-card/30">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded
        className="flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left outline-none focus-visible:bg-sidebar-accent/50"
      >
        {/* The same tile with the same glyph the preset cards wear `Plus` in —
            a gateway with no mark is still a gateway, and a bare link here
            would be the one row in the column shaped like nothing else. */}
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted"
        >
          <Plus className="size-5 text-foreground/80" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-ui font-medium text-foreground">Another gateway</span>
          <span className="text-ui text-muted-foreground">
            Any OpenAI- or Anthropic-shaped API, described by hand.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-ui text-muted-foreground">
          Cancel
          <ChevronDown className="size-4 rotate-180" aria-hidden />
        </span>
      </button>

      <div className="border-t border-border/60 px-4 pt-4 pb-4">
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field id={`${ids}-name`} label="Name">
            <Input
              id={`${ids}-name`}
              // The reader opened this form to fill it in.
              autoFocus
              value={name}
              placeholder="OpenRouter"
              spellCheck={false}
              className="text-ui md:text-ui"
              onChange={(e) => setName(e.currentTarget.value)}
            />
          </Field>

          <Field id={`${ids}-url`} label="Base URL">
            <Input
              id={`${ids}-url`}
              value={baseUrl}
              placeholder="https://openrouter.ai/api/v1"
              spellCheck={false}
              className="text-ui md:text-ui"
              onChange={(e) => setBaseUrl(e.currentTarget.value)}
            />
          </Field>

          <Field id={`${ids}-format`} label="Dialect" hint="How the gateway spells a request">
            <div className="relative">
              <select
                id={`${ids}-format`}
                className={cn(inputClassName, "appearance-none pr-8 text-ui md:text-ui")}
                value={apiFormat}
                onChange={(e) => setApiFormat(e.currentTarget.value)}
              >
                {API_FORMATS.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.label}
                  </option>
                ))}
              </select>
              {/* `appearance-none` takes the platform's own arrow with it, and
                  a box with none reads as a field to type in. */}
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </Field>

          <Field
            id={`${ids}-models`}
            label="Model ids"
            hint="One per line — empty takes every model it serves"
          >
            <textarea
              id={`${ids}-models`}
              value={models}
              spellCheck={false}
              placeholder={"anthropic/claude-opus-5\nopenai/gpt-6"}
              className={cn(inputClassName, "h-20 resize-y py-2 text-ui md:text-ui")}
              onChange={(e) => setModels(e.currentTarget.value)}
            />
          </Field>

          <Field id={`${ids}-key`} label="API key" hint="Written once, never shown">
            <Input
              id={`${ids}-key`}
              type="password"
              autoComplete="off"
              value={apiKey}
              spellCheck={false}
              className="text-ui md:text-ui"
              onChange={(e) => setApiKey(e.currentTarget.value)}
            />
          </Field>

          <label className="flex items-center gap-2 text-ui text-muted-foreground">
            <Switch checked={makeDefault} onCheckedChange={setMakeDefault} />
            Use it for new sessions
          </label>

          {busy && (
            <p className="text-ui text-muted-foreground">
              Testing the key and reading the model list…
            </p>
          )}
          {state.error && <p className="text-ui text-destructive">{state.error}</p>}

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={busy || !name.trim() || !baseUrl.trim() || !apiKey.trim()}
              className="cursor-pointer"
            >
              {busy ? <Spinner className="size-3.5" /> : "Connect"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onToggle}
              className="cursor-pointer"
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/// A word where a control would go, ending the line a gateway's name is on.
///
/// Two words' worth of state, and the only coloured thing on a card — which is
/// what makes the list scannable for *which* of these is done.
function Chip({ children, tone }: { children: ReactNode; tone: "good" | "bad" }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-2 py-px text-ui",
        tone === "good"
          ? "border-accent-add/30 bg-accent-add/10 text-accent-add"
          : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

/// Label, then the box, then what the box wants — the shape every form in this
/// dialog wears.
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-ui font-medium">
          {label}
        </label>
        {hint && <span className="text-ui text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
