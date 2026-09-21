import { X } from "lucide-react";

import FileIcon from "@/components/FileIcon";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/events";

/// What is pinned to the composer, drawn above the text it will be sent with.
///
/// **Two shapes for two things that travel differently.** An image is shown as
/// pixels, because a thumbnail is the only label a screenshot has; a file is
/// handed to the model as a path, so it gets a chip a path deserves — the type
/// glyph and the name. Neither is a "file preview": a tile says *this is
/// attached*, and opening it is the job of the editor the reader already has.
///
/// **The two are sized apart on purpose, and the trade is deliberate.** A
/// thumbnail is 36px, not the 56px a gallery would give it: this row is part of
/// the composer, and a picture big enough to *read* here would push the text it
/// belongs to down the window. A file's chip is one line tall, because a name has
/// nothing to show and a box around it was only pretending otherwise.
///
/// **The tray is the whole of an attachment's presence, and that is a reversal.**
/// An attachment used to be a token *inside* the draft — `📎 name size`, painted
/// as a pill by the mirror under the text, deleted with backspace — on the
/// argument that a chip in the message beats a list beside it. It reads worse than
/// it argues: the token is part of the prompt the model is given, so a photo came
/// back from the transcript as a colour emoji in the middle of a sentence, and the
/// size rode in the text where nobody could edit it.
///
/// Deleting is the `×`, in the one place the reader is looking: on the picture's
/// own corner for an image, inline for a name, and only for the tile under the
/// cursor. It stays reachable by keyboard, which `group-hover` plus
/// `focus-visible` gives and `hidden` would not.
export default function AttachmentTray({
  attachments,
  onRemove,
  modelTakesImages = true,
}: {
  attachments: Attachment[];
  onRemove: (path: string) => void;
  /// Whether the picked model can be handed an image at all. mcode declares
  /// `image: false`, so every image is sent as a path — and the harness's own
  /// refusal says so in words where a guess made here could not.
  modelTakesImages?: boolean;
}) {
  if (!attachments.length) return null;

  // Said, not enforced: removing the tile or refusing the drop would act on a
  // guess about what the model takes.
  const warn = !modelTakesImages && attachments.some((attachment) => attachment.isImage);

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {attachments.map((attachment) => {
        const image = attachment.isImage && attachment.preview;

        return (
          <li
            key={attachment.path}
            // `group` so one hover lights the remove button on this tile alone,
            // and the path on hover because a name is not always enough to tell
            // two of them apart — the reader picked it a second ago, but a tray
            // of three screenshots is where that stops being true.
            title={attachment.path}
            className="group relative flex min-w-0 items-center"
          >
            {image ? (
              <img
                src={image}
                alt={attachment.name}
                draggable={false}
                className="size-9 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-9 min-w-0 items-center gap-1.5 rounded-lg bg-muted/50 pr-1 pl-1.5">
                <FileIcon path={attachment.path} className="size-4 shrink-0" />
                <span className="min-w-0 max-w-40 truncate text-ui">{attachment.name}</span>
                <span className="shrink-0 text-ui text-muted-foreground/60">
                  {formatBytes(attachment.size)}
                </span>
              </span>
            )}

            <button
              type="button"
              onClick={() => onRemove(attachment.path)}
              aria-label={`Remove ${attachment.name}`}
              className={cn(
                "grid shrink-0 cursor-pointer place-items-center rounded-full transition-opacity",
                image
                  ? // On the picture's corner, always drawn: a thumbnail has no
                    // room to explain itself, and the cross is the only control
                    // it has.
                    "absolute -top-1 -right-1 size-5 border border-border bg-secondary text-secondary-foreground"
                  : // Beside the name, and only while the tile is hovered or the
                    // button is focused — a row of crosses is louder than the
                    // files it holds.
                    "size-4 text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100",
              )}
            >
              <X className="size-3" strokeWidth={2.5} />
            </button>
          </li>
        );
      })}

      {warn && (
        // Inside the list so it wraps with the tiles it is about, and full width
        // so it reads as a line under them rather than a tile of its own.
        <li className="w-full text-ui text-muted-foreground">
          This model takes text only — the image will be sent as a path, and the
          provider may refuse it.
        </li>
      )}
    </ul>
  );
}
