import { useCallback, useEffect, useId, useState, type ReactNode } from "react";

import { invoke } from "@tauri-apps/api/core";
import { Activity, ChevronDown, ChevronRight, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, inputClassName } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { tracked } from "@/lib/slow";
import type { NewProvider, Provider, ProviderPreset } from "@/types/events";
import { cn } from "@/lib/utils";

/// Where models come from — **the one setup step hz has.**
///
/// The agent ships inside this app and arrives with no models at all: not one
/// of them is usable until the reader connects something, which is a base URL,
/// a dialect and a key. That is the whole of this screen, and connecting the
/// gateway hz knows about is one field of it.
///
/// **Two groups, in the order the reader needs them.** What is already
/// connected, then the ways to connect — a list and its own next step, rather
/// than the third kind of row mixed into the same column. With nothing
/// connected the list is replaced by a sentence saying what this screen is for,
/// because that reader has just come from an empty model picker and is the one
/// person here who has to be told.
///
/// **Adding happens in a dialog, not in the list.** The form used to open in
/// place: four fields appeared between the rows, the list moved under them, and
/// the preset path — one key and a button — had to be told apart from the
/// manual one by which fields were missing. A dialog is the reader asking for
/// something rather than the panel changing shape, and it gives the fields
/// their labels back.
///
/// **Nothing here is MiniMax's own account.** The CLI always reports the two
/// entries it keeps for that account, signed in or not, and the backend drops
/// them before they reach this screen: there is no login to draw and no key
/// field for one. A provider a reader connects is the only kind that exists
/// here.
///
/// **The key is written, never read back.** A connected provider reports
/// whether it *has* one and nothing else, because the app has no use for the
/// secret after handing it over — and a screen that drew one would be a screen
/// holding it.

const API_FORMATS = [
  { id: "anthropic-messages", label: "Anthropic messages" },
  { id: "openai-completions", label: "OpenAI chat completions" },
  { id: "openai-responses", label: "OpenAI responses" },
];

/// One row's own state, so a test result lands under the provider it was run
/// for rather than in one shared line at the bottom.
///
/// `busy` names **which** of the row's two actions is running, because the
/// spinner belongs where the press was: a bare dot beside the name said
/// "something is happening" and left the reader looking at the row to work out
/// what, and it left both buttons live-looking while one of them was out.
type RowState = { busy: null | "test" | "remove"; note: string | null; error: string | null };

const EMPTY_ROW: RowState = { busy: null, note: null, error: null };

export default function ProviderSettings({ onChanged }: { onChanged?: () => void }) {
  const [listed, setListed] = useState<Provider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  /// Which way in the dialog is open on, or `null` for no dialog. The two
  /// spellings are the two shapes of the form — see [`AddProviderDialog`].
  const [adding, setAdding] = useState<ProviderPreset | "custom" | null>(null);
  /// The row waiting to be told twice. One id for the whole screen, never a
  /// flag per row: two rows asking at once is one press answering two
  /// questions.
  const [confirming, setConfirming] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      setListed(await tracked("Reading this machine's providers", invoke<Provider[]>("list_providers")));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void read();
    // The presets come from the backend for the same reason the provider list
    // does: the URL and the dialect are facts about the agent's own gateway
    // wiring, and it is the side that talks to it.
    void invoke<ProviderPreset[]>("list_provider_presets")
      .then(setPresets)
      .catch(() => {});
  }, [read]);

  /// One provider's controls' state, and one place that clears it: a new
  /// action starts from what the row had and overwrites only what it says, so a
  /// test result is not wiped by the next click on something else.
  const setRow = (id: string, next: Partial<RowState>) =>
    setRows((prev) => {
      const current = prev[id] ?? EMPTY_ROW;
      return { ...prev, [id]: { ...current, ...next } };
    });

  /// Every mutation answers with the list as it stands after, so the screen
  /// never has to guess what the CLI did — and the model list is stale the
  /// moment a provider changes, which is what `onChanged` tells the composer.
  const apply = (providers: Provider[]) => {
    setListed(providers);
    onChanged?.();
  };

  /// A mutation: removes a provider and answers with the list as it stands.
  ///
  /// No note on success — the row that changed *is* the answer, and "Saved" was
  /// a line about nothing on a screen where every row already shows what it
  /// holds. The one sentence worth keeping is the one the add path writes,
  /// because it tells the reader where to go next.
  const act = async (id: string, action: "test" | "remove", work: () => Promise<Provider[]>) => {
    setConfirming(null);
    setRow(id, { busy: action, note: null, error: null });
    try {
      apply(await work());
      setRow(id, { busy: null });
    } catch (err) {
      setRow(id, { busy: null, error: String(err) });
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
      // the first row is the one `--use` tested when it was connected.
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

  if (!listed) {
    return (
      <div className="flex flex-col gap-8">
        {error ? (
          <p className="text-ui text-destructive">{error}</p>
        ) : (
          // **Rows, not a spinner.** The list is one CLI call, so this is either
          // a blink or a second of waiting, and a lone 14px arc at the top of an
          // otherwise empty pane read as the page having failed to draw. Two
          // provider-shaped rows hold the space the real ones will take, the way
          // `PickerMenu`'s own placeholder rows do — the heading is drawn too,
          // since it is where it will be.
          <>
            <p className="sr-only" role="status">
              Reading this machine's providers…
            </p>
            <section className="flex flex-col gap-2" aria-busy>
              <Heading>Connected</Heading>
              <div aria-hidden className="flex flex-col gap-2">
                {[
                  ["w-32", "w-40"],
                  ["w-24", "w-56"],
                ].map(([name, facts]) => (
                  // **The real row's own boxes, not a generic pair of bars**: a
                  // name line is a 28px row of its own because the two action
                  // buttons live on it, and a facts line is 20px of text. Bars
                  // sized to the shape that replaces them are the whole point —
                  // measured at 62px against the real row's 80, which moved
                  // everything below it when the list landed.
                  <div
                    key={name}
                    className="flex flex-col gap-2 rounded-xl border border-border/60 px-3.5 py-3"
                  >
                    <div className="flex h-7 items-center">
                      <span
                        className={cn("h-4 animate-pulse rounded bg-muted-foreground/20", name)}
                      />
                    </div>
                    <span
                      className={cn(
                        // `1.4em` against `text-ui` is the facts line's own box, so the
                        // placeholder tracks the interface size the reader picked rather
                        // than pinning a height only the default happens to agree with.
                        "h-[1.4em] animate-pulse rounded bg-muted-foreground/10 text-ui",
                        facts,
                      )}
                    />
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {error && <p className="text-ui text-destructive">{error}</p>}

      <section className="flex flex-col gap-2">
        {listed.length > 0 ? (
          <Heading>Connected</Heading>
        ) : (
          // **The one reader who has to be told.** They arrive here from a model
          // picker with nothing in it, so the sentence says what this screen is
          // for before drawing the ways to use it.
          <p className="max-w-prose text-ui text-muted-foreground">
            No provider is connected, so the agent has no models to run. Connect
            one below — hz asks it which models it serves, and the composer's own
            picker fills in by itself.
          </p>
        )}

        {listed.map((provider) => {
          const state = rows[provider.providerId] ?? EMPTY_ROW;
          return (
            <ConnectedRow
              key={provider.providerId}
              provider={provider}
              state={state}
              confirming={confirming === provider.providerId}
              onTest={() => void test(provider)}
              onAskDelete={() => setConfirming(provider.providerId)}
              onKeepIt={() => setConfirming(null)}
              onDelete={() => void remove(provider)}
            />
          );
        })}
      </section>

      <section className="flex flex-col gap-2">
        <Heading>Add a provider</Heading>

        {presets.map((preset) => (
          <ChoiceRow
            key={preset.name}
            name={preset.name}
            note={preset.note}
            onClick={() => setAdding(preset)}
          />
        ))}

        <ChoiceRow
          name="Something else"
          // The command's own name for it, since that is what the reader will
          // see in `mcode provider list` afterwards.
          note="Any OpenAI- or Anthropic-shaped gateway, by hand — a custom_provider."
          onClick={() => setAdding("custom")}
        />
      </section>

      {adding && (
        <AddProviderDialog
          // Keyed on the choice, so switching ways in remounts the form rather
          // than leaving the previous one's typed values in the new fields.
          key={typeof adding === "string" ? adding : adding.name}
          preset={adding === "custom" ? null : adding}
          onClose={() => setAdding(null)}
          onAdded={(providers) => {
            // **The row that was not there before is the one just connected**,
            // and it is the only place worth saying so: the reader lands back
            // on a list whose new entry already carries the model count, and
            // the next thing they do is pick one of them in the composer.
            const connected = providers.find(
              (next) => !listed.some((old) => old.providerId === next.providerId),
            );
            apply(providers);
            if (connected) {
              setRow(connected.providerId, { note: "Connected — pick a model in the composer" });
            }
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

/// The screen's own group heading, in the weight every group heading in this
/// panel wears — the pane's `<h2>` above already names the section.
function Heading({ children }: { children: ReactNode }) {
  return <h3 className="text-ui font-medium text-muted-foreground">{children}</h3>;
}

/// One connected provider: what it is, what is known about it, and the two
/// things a reader can do to it.
///
/// **The facts are one muted line, and the last thing that *happened* is
/// another.** They were a single `·`-joined string — "Key stored · 12 models ·
/// gpt-5, o3, claude" — which truncated the model list mid-id and read a test
/// result as one more inventory field. A row now says what it has on one line
/// and what was done to it on the next.
function ConnectedRow({
  provider,
  state,
  confirming,
  onTest,
  onAskDelete,
  onKeepIt,
  onDelete,
}: {
  provider: Provider;
  state: RowState;
  confirming: boolean;
  onTest: () => void;
  onAskDelete: () => void;
  onKeepIt: () => void;
  onDelete: () => void;
}) {
  // **A provider with no models cannot be used, and it is not a state this app
  // leaves one in.** The list is fetched from the gateway the moment the
  // provider is connected, so an empty one came from the agent's own TUI and
  // the fix is to connect it here, which fetches. It is the one thing on this
  // row marked as a problem, and the mark is the dot rather than a colour on
  // the sentence — the sentence is the same length either way.
  const empty = provider.models.length === 0;

  const facts = [
    provider.hasApiKey ? "Key stored" : "No key",
    empty ? "No models" : `${provider.models.length} models`,
  ].join(" · ");

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 px-3.5 py-3">
      <div className="flex items-center gap-2">
        {empty && (
          <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
          {provider.name}
        </span>

        {confirming ? (
          // Asked in the row rather than in a dialog, which would take the whole
          // window over a key the reader can paste again. Same shape the
          // transcription models use, down to the X that means "keep it".
          <>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={state.busy !== null}
              onClick={onDelete}
              aria-label={`Remove ${provider.name}`}
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
              aria-label={`Keep ${provider.name}`}
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
                  size="icon-sm"
                  variant="ghost"
                  disabled={state.busy !== null}
                  onClick={onTest}
                  aria-label={`Test ${provider.name}`}
                  className="cursor-pointer text-muted-foreground hover:text-foreground disabled:opacity-100"
                >
                  {/* **Progress where the press was.** The spinner replaces the
                      glyph inside the button that was pressed rather than
                      floating beside the name, which is the bargain the
                      dictation control makes — the state after a press should
                      say the app is working on what was asked, in the place
                      that was pressed. `disabled:opacity-100`, so the spinning
                      arc is not dimmed to invisible while it runs. */}
                  {state.busy === "test" ? <Spinner className="size-3.5" /> : <Activity />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Sends one prompt to this provider's first model, then reads the list back
              </TooltipContent>
            </Tooltip>

            {/* `readOnly` is the managed account's own entry, which this app
                neither shows nor writes — the check is here so the row cannot
                grow a Remove that the CLI would refuse. */}
            {!provider.readOnly && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={state.busy !== null}
                    onClick={onAskDelete}
                    aria-label={`Remove ${provider.name}`}
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Forget this provider and its key</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>

      <p className="text-ui text-muted-foreground">
        {facts}
        {empty && " · Connect it again to fetch its models"}
      </p>

      {state.note && <p className="text-ui text-muted-foreground">{state.note}</p>}
      {state.error && <p className="text-ui text-destructive">{state.error}</p>}
    </div>
  );
}

/// One way into the dialog — a preset, or the manual form.
///
/// **The row is the button.** Two of these and a heading are the whole of the
/// second group, so a `Connect` button on each would be three controls saying
/// one thing; a row that answers a click says it once, and the chevron is what
/// says the click opens something rather than doing it in place.
function ChoiceRow({
  name,
  note,
  onClick,
}: {
  name: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-border/60 px-3.5 py-2.5 text-left transition-colors outline-none hover:bg-sidebar-accent/50 focus-visible:bg-sidebar-accent/50"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui text-foreground">{name}</span>
        <span className="block truncate text-ui text-muted-foreground">{note}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

/// The add form, in two shapes behind one dialog.
///
/// **A preset asks for one thing: the key.** Everything else about the gateway
/// — its URL, its dialect — is a fact hz already holds, and drawing three
/// filled-in fields a reader is not meant to touch invites them to touch them.
/// So the preset's shape is the key and the button, with the two facts it
/// stands for stated above in the muted line they belong in.
///
/// **The manual shape is every field `provider add` takes as a flag**, because
/// that is exactly what a reader adding their own provider has to know. One
/// form rather than a wizard's third step: the fields are one decision, and the
/// CLI rejects half of it the same way either way.
function AddProviderDialog({
  preset,
  onClose,
  onAdded,
}: {
  /// What the reader picked, when they picked one. There is nothing left to
  /// edit but the key, which is the point of a preset.
  preset: ProviderPreset | null;
  onClose: () => void;
  onAdded: (providers: Provider[]) => void;
}) {
  const ids = useId();
  const [name, setName] = useState(preset?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(preset?.baseUrl ?? "");
  const [apiFormat, setApiFormat] = useState(preset?.apiFormat ?? API_FORMATS[0].id);
  const [models, setModels] = useState(preset?.models.join("\n") ?? "");
  const [apiKey, setApiKey] = useState("");
  const [makeDefault, setMakeDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);

    const spec: NewProvider = {
      name,
      baseUrl,
      apiFormat,
      // One id per line, and normally left empty: an empty list asks the
      // provider's own `/models` for everything it serves, which is the whole
      // point of connecting a gateway. Typing ids is the fallback for a
      // provider that publishes no list at all.
      models: models
        .split("\n")
        .map((model) => model.trim())
        .filter(Boolean),
      apiKey,
      // A preset is always the default: the reader has no other way to say
      // which provider a new session runs on, since the CLI has no
      // `provider use <id>` — the choice is made by the model they pick.
      makeDefault: preset ? true : makeDefault,
    };

    try {
      onAdded(await invoke<Provider[]>("add_provider", { provider: spec }));
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-110">
        <DialogHeader className="pr-6">
          <DialogTitle>{preset ? preset.name : "Add a provider"}</DialogTitle>
          <DialogDescription>
            {preset
              ? "One thing to fill in. hz asks the gateway which models it serves once the key is in."
              : "Every field the CLI needs to talk to a gateway. Models can be left empty — hz asks the provider for them."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {preset ? (
            // The facts the preset stands for, and the reason there is only one
            // field below: the reader is not meant to check them, only to see
            // what they are connecting to.
            <div className="flex flex-col gap-0.5 rounded-lg bg-muted/40 px-3 py-2">
              <span className="truncate text-ui text-muted-foreground">{preset.baseUrl}</span>
              <span className="truncate text-ui text-muted-foreground">
                {API_FORMATS.find((format) => format.id === preset.apiFormat)?.label ??
                  preset.apiFormat}
              </span>
            </div>
          ) : (
            <>
              <Field id={`${ids}-name`} label="Name">
                <Input
                  id={`${ids}-name`}
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

              <Field
                id={`${ids}-format`}
                label="Dialect"
                hint="How the gateway spells a request"
              >
                <div className="relative">
                  <select
                    id={`${ids}-format`}
                    className={cn(inputClassName, "appearance-none pr-8 text-ui md:text-ui")}
                    value={apiFormat}
                    onChange={(e) => setApiFormat(e.target.value)}
                  >
                    {API_FORMATS.map((format) => (
                      <option key={format.id} value={format.id}>
                        {format.label}
                      </option>
                    ))}
                  </select>
                  {/* `appearance-none` takes the platform's own arrow with it,
                      and a box with none reads as a field to type in. */}
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
            </>
          )}

          <Field
            id={`${ids}-key`}
            label="API key"
            hint="Written once, never read back"
          >
            <Input
              id={`${ids}-key`}
              type="password"
              autoFocus={preset !== null}
              value={apiKey}
              spellCheck={false}
              className="text-ui md:text-ui"
              onChange={(e) => setApiKey(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && apiKey && !busy) void submit();
              }}
            />
          </Field>

          {!preset && (
            <label className="flex items-center gap-2 text-ui text-muted-foreground">
              <Switch checked={makeDefault} onCheckedChange={setMakeDefault} />
              Use it for new sessions
            </label>
          )}

          {error && <p className="text-ui text-destructive">{error}</p>}

          {/* The connection test is the CLI's own and it runs the first model,
              so a connect is a few seconds of real work rather than a file
              write. Saying what it is doing beats a button that looks stuck. */}
          {busy && (
            <p className="text-ui text-muted-foreground">
              Testing the key and reading the model list…
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Two words for two paths: a preset is a gateway the reader is
              signing in to, the manual form is one they are describing. */}
          <Button size="sm" disabled={busy || !apiKey} onClick={() => void submit()}>
            {busy ? (
              <Spinner className="size-3.5" />
            ) : preset ? (
              "Connect"
            ) : (
              "Add provider"
            )}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/// Label, then the box, then what the box wants — the shape every form in a
/// dialog here wears. `RoleDialog` holds the same component for its own two
/// fields; a third caller is when it earns a home of its own.
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
