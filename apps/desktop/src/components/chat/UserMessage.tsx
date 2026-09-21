import { openUrl } from "@tauri-apps/plugin-opener";
import { Image, Paperclip } from "lucide-react";
import { memo, type CSSProperties } from "react";

import SessionAvatar from "@/components/SessionAvatar";
import FileLink from "@/components/chat/FileLink";
import ImageRow from "@/components/chat/ImageRow";
import { inlineMark } from "@/components/chat/InlineMark";
import { useChatSession } from "@/hooks/useChatSession";
import { absolutePath } from "@/lib/filePath";
import {
  SEGMENT_COLOR,
  highlightSegments,
  splitMention,
  withLineBreaks,
  withPaths,
} from "@/lib/highlight";
import { issueUrl, parseIdentifier } from "@/lib/issue";
import { openLink } from "@/lib/openLink";
import { commandBrand } from "@/lib/pluginBrand";
import { ATTACHMENT_MARK, ATTACHMENT_SIZE } from "@/lib/attachmentToken";
import { stripSenderPrefix } from "@/lib/relay";
import { shortenPath } from "@/lib/tools";
import { cn } from "@/lib/utils";
import type { ImageRef, IssueRef, MessageSender } from "@/types/events";

/// The user's own text, echoed from the event log rather than local state — the
/// backend synthesizes and persists it, so this renders the same live or replayed.
///
/// A slash command and a file mention are coloured and nothing more — same size,
/// same weight, same line. Each stays part of the sentence it sits in, which a
/// chip or a monospace run made them stop being. The segments come from the same
/// function the composer's overlay uses, so a word coloured while typing is
/// still coloured once sent.
///
/// Images sit **outside the bubble**. The bubble is a container for speech, and
/// a picture given a fill and a padding reads as speech with a frame drawn round
/// it; unwrapped, the image is its own edge. They stay inside this component and
/// on its column, so the change is only what the reader sees.
///
/// A message relayed by `hz send` keeps the user's side of the transcript —
/// whoever wrote it, it is not this session's assistant speaking — and is named
/// above the bubble instead of being drawn as a second kind of speech. The name
/// comes off the event's own `from` field and never out of the text: the model
/// on the other end can write any line it likes, so prose is not attribution.
/// The line the backend writes into the prompt for the receiving agent is taken
/// back off here, since the row above already says who is talking — safe to
/// mute precisely because the field, not the prose, is what draws it.
///
/// An issue tag is the one coloured run that is also a *link*: it opens the
/// issue in the tracker, where the reader can act on it rather than only read
/// it. The URL comes off the event's own `issues` and never out of the text, so
/// a tag naming an issue that never resolved stays coloured and inert instead
/// of becoming a link to nowhere.
///
/// Memoised, and the row it protects is the most expensive of the small ones:
/// every render re-runs the mention, path, line-break and brand scans over the
/// prompt. All of its props are the prompt's own fields — strings, and the two
/// arrays the event payload owns — plus the opener, so identity holds across the
/// deltas of a running turn. A comparator is not the alternative: the text is
/// scanned from scratch either way, so a compare would pay for a scan it is
/// trying to avoid.
function UserMessage({
  text,
  images = [],
  issues = [],
  from = null,
  cwd: writtenIn = null,
  onOpenSession,
}: {
  text: string;
  images?: ImageRef[];
  /// What this prompt was tagged with. Not drawn — the tags are already in the
  /// sentence — but it is where a tag's link comes from, since a URL recovered
  /// from prose would be a guess.
  issues?: IssueRef[];
  /// The session that relayed this, or `null` for a prompt the user typed.
  from?: MessageSender | null;
  /// The working directory this prompt was written in, where it is not the
  /// session's own. Only a fork records one, and it is what keeps a copied
  /// `@mention` naming the tree it was typed in rather than the fork's own copy
  /// of the same file.
  cwd?: string | null;
  /// Opens the sending session. Absent where nothing can navigate, which draws
  /// the attribution as a plain line rather than hiding it.
  onOpenSession?: (sessionId: string) => void;
}) {
  // The recorded one wins where there is one. A fork carries its parent's
  // conversation into a different tree, so a mention resolved against the
  // session's own cwd there would open the fork's copy of the file rather than
  // the one this message named.
  const { cwd: sessionCwd } = useChatSession();
  const cwd = writtenIn ?? sessionCwd;
  const body = withLineBreaks(stripSenderPrefix(text, from));
  const segments = withPaths(highlightSegments(body));

  // A prompt running a branded plugin's own command. Null for everything else,
  // which is nearly every message.
  const brand = commandBrand(body);

  // An image with neither an archived copy nor bytes of its own — the file was
  // cleared out from under a transcript that still names it. `ImageRow` drops
  // those, so this row is what is left to say about them.
  const missing = images.filter((image) => !image.path && !image.url);

  return (
    <div className="flex flex-col items-end gap-1.5">
      {/* Topmost, above even the attachments: who is talking is read before
          anything they sent. The mark is generated from the session's id rather
          than fetched — a session is not an account and has no picture — so it
          is the same shape every time this session speaks. */}
      {from && (
        <button
          type="button"
          onClick={() => onOpenSession?.(from.sessionId)}
          disabled={!onOpenSession}
          className="flex max-w-[85%] cursor-pointer items-center gap-1 text-ui text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
        >
          <SessionAvatar sessionId={from.sessionId} name={from.title} />
          <span className="truncate">{from.title}</span>
        </button>
      )}

      {/* Above the text, matching the composer's own tray — what was attached is
          read before the sentence written about it, on the way in and on the way
          back out. `end` so the row grows leftwards from the same edge the
          bubble sits on. */}
      <ImageRow images={images} variant="sent" align="end" />

      {body && (
        // `none` in dark, where the bubble already reads as raised by being
        // lighter than the transcript behind it. In light every surface sits
        // within a few percent of white, so this is what separates the bubble
        // from the page. `--shadow-card`, not the composer's `--shadow-surface`:
        // this sits *in* the transcript rather than floating at the window's
        // edge, and the crisper one read as an edge cut under it.
        <div
          className="user-bubble max-w-[85%] rounded-xl bg-card px-3 py-2 text-card-foreground shadow-(--shadow-card)"
          // The colour rides in and App.css paints it — a palette that fills
          // this bubble has to answer differently to one that doesn't, and only
          // the palette knows which it is. `data-brand` is what the rules match
          // on, since a custom property can't be selected for.
          data-brand={brand ? "" : undefined}
          style={brand ? ({ "--brand": brand } as CSSProperties) : undefined}
        >
          {/* `wrap-anywhere` because a pasted path or URL has no whitespace to
              wrap at, and the bubble's `max-w` caps the box and not what is
              drawn in it — so the glyphs run out over the transcript's own
              background and set the scroll width of the whole column, moving
              every other message sideways. Anywhere rather than `break-words`:
              only `anywhere` shrinks min-content width, which is the part that
              sets that scroll width. */}
          <span className="text-chat whitespace-pre-wrap wrap-anywhere">
            {/* Plain runs concatenate back to `text` exactly, so the spacing the
                user typed survives — nothing here is rebuilt from a parse.
                A mention is the one run drawn shorter than it was sent: the
                directory is dropped and kept on the tooltip, since a deep path
                is most of a line and says little the filename doesn't. The
                composer can't do this — see `splitMention`. */}
            {segments.map((segment, i) => {
              // Bold, italic, code, strikethrough and links, drawn without
              // their delimiters. First, so the marks are read before the
              // coloured runs — they share no character, so the order is only
              // about keeping the coloured cases below reading as they did.
              const mark = inlineMark(segment, i);
              if (mark) return mark;

              if (segment.kind === "mention") {
                const { name } = splitMention(segment.text);
                const raw = segment.text.slice(1);
                // Written against the agent's own working directory, which is
                // what the context carries. Inert without one, the same resting
                // state an unresolved issue tag has.
                const path = absolutePath(raw, cwd);

                if (!path) {
                  return (
                    <span key={i} className={SEGMENT_COLOR.mention} title={raw}>
                      @{name}
                    </span>
                  );
                }

                return (
                  <FileLink key={i} path={path} title={raw} className={SEGMENT_COLOR.mention}>
                    @{name}
                  </FileLink>
                );
              }

              if (segment.kind === "quote") {
                // The `>` stays, dimmed, and the words take the quote's colour —
                // the same split a mention makes. The mark is how a reader knows
                // these are somebody else's words and not their own, and dropping
                // it would leave a paragraph of muted prose with no reason given.
                // Inline rather than a block, because every run here shares one
                // `whitespace-pre-wrap` span and a block would break the line box
                // the bubble's own breaks are drawn in.
                return (
                  <span key={i} className={SEGMENT_COLOR.quote}>
                    <span className="opacity-45">{"> "}</span>
                    {segment.text.slice(2)}
                  </span>
                );
              }

              // A path the reader typed rather than mentioned. Drawn the way a
              // mention is — `@` and the filename, the directory on the tooltip
              // — since the two name the same thing and a deep path is most of
              // a line. Relative resolves against the same cwd a mention does.
              // A locator stays on the name, inside the link: `@a.ts:12` is one
              // reference, and a link stopping short of it read as broken.
              if (segment.kind === "path") {
                const file = segment.inner ?? segment.text;
                const name =
                  (file.split("/").filter(Boolean).at(-1) ?? file) +
                  segment.text.slice(file.length);
                const path = absolutePath(file, cwd);

                if (!path) {
                  return (
                    <span key={i} className={SEGMENT_COLOR.path} title={segment.text}>
                      @{name}
                    </span>
                  );
                }

                return (
                  <FileLink
                    key={i}
                    path={path}
                    line={segment.line}
                    title={segment.text}
                    className={SEGMENT_COLOR.path}
                  >
                    @{name}
                  </FileLink>
                );
              }

              if (segment.kind === "issue") {
                const identifier = parseIdentifier(segment.text.slice(1));
                const url = identifier ? issueUrl(issues, identifier) : null;

                // Inert without a link, which is the resting state of a tag
                // whose issue never resolved — a button that opens nothing is
                // worse than a word that was never one.
                if (!url) {
                  return (
                    <span key={i} className={SEGMENT_COLOR.issue}>
                      {segment.text}
                    </span>
                  );
                }

                return (
                  <button
                    key={i}
                    type="button"
                    title={`Open ${identifier} in ${new URL(url).hostname}`}
                    // Underlined on hover rather than at rest: the colour
                    // already sets it apart from the sentence, and a permanent
                    // underline through a prompt reads as a correction.
                    className={cn(SEGMENT_COLOR.issue, "cursor-pointer hover:underline")}
                    onClick={() => void openUrl(url)}
                  >
                    {segment.text}
                  </button>
                );
              }

              if (segment.kind === "url") {
                return (
                  <button
                    key={i}
                    type="button"
                    className={cn(SEGMENT_COLOR.url, "cursor-pointer hover:decoration-current")}
                    onClick={(e) => openLink(segment.text, e)}
                  >
                    {segment.text}
                  </button>
                );
              }

              // **An attachment's run is drawn, not echoed.** The token is
              // `📎 name size` — a paperclip *character*, because that is the
              // only kind of mark a textarea can hold, and the composer paints
              // its icon over it. Left as plain words here, the same run put a
              // colour emoji in the middle of a monochrome sentence, which is
              // what a reader saw and called ugly. So the mark is dropped from
              // the glyphs and drawn as the icon both surfaces use, and the size
              // steps back from the name it qualifies. Still one line, still no
              // pill: this is the sentence the model was given, and a chip in it
              // would stop reading as one.
              if (segment.kind === "attachment") {
                const run = segment.text.slice(ATTACHMENT_MARK.length);
                const size = run.match(ATTACHMENT_SIZE);
                const name = (size ? run.slice(0, run.length - size[0].length) : run).trim();
                return (
                  <span key={i}>
                    <Paperclip
                      aria-hidden
                      className="mr-1 inline size-3.5 -translate-y-px align-baseline opacity-70"
                    />
                    <span className="font-mono">{name}</span>
                    {size && <span className="ml-1 opacity-60">{size[0].trim()}</span>}
                  </span>
                );
              }

              return (
                <span key={i} className={SEGMENT_COLOR[segment.kind]}>
                  {segment.text}
                </span>
              );
            })}
          </span>
        </div>
      )}

      {/* An image whose file is gone. Named rather than drawn as a broken frame,
          which says nothing about what was sent. */}
      {missing.map((image, i) => (
        <span key={i} className="flex items-center gap-1.5 text-chat text-muted-foreground">
          <Image className="size-3.5 shrink-0" />
          <span className="truncate">{image.path ? shortenPath(image.path) : "image"}</span>
        </span>
      ))}

    </div>
  );
}

export default memo(UserMessage);
