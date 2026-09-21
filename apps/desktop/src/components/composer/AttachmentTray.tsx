import { X } from "lucide-react";

import FileIcon from "@/components/FileIcon";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/events";

/// What is pinned to the composer, drawn above the text it will be sent with.
///
/// **Two presentations for two things that travel differently.** An image is
/// shown as pixels, because a thumbnail is the only label a screenshot has; a
/// file is handed to the model as a path, so it gets the row a path deserves —
/// the type glyph and the name. Neither is a "file preview": a tile says *this is
/// attached*, and opening it is the job of the editor the reader already has.
///
/// **The tray is the whole of the attachment's presence, and that is a reversal.**
/// An attachment used to be a token *inside* the draft — `📎 name size`, painted
/// as a pill by the mirror under the text, deleted with backspace — on the
/// argument that a chip in the message beats a list beside it. It reads worse
/// than it argues: the token is part of the prompt the model is given, so a photo
/// came back from the transcript as a colour emoji in the middle of a sentence,
/// and the size rode in the text where nobody could edit it. The reader asked for
/// the picture instead, so the picture is what is drawn.
///
/// Deleting is the `×`, and it is one gesture in the one place the reader is
/// looking. Hover reveals it — a full tray would otherwise be a row of crosses —
/// and it stays reachable by keyboard, which `opacity` preserves and `hidden` does
/// not.
///
/// Both tiles are the same height so a mixed tray still reads as one row.
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
    // Spacing from the composer is the caller's, which is the only side that
    // knows what sits below it.
    <ul className="flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <li
          key={attachment.path}
          // `group` so one hover lights the remove button on this tile alone.
          // Deliberately no `title`: the path is the one thing the reader already
          // knows — they picked the file a second ago — so a tooltip would be the
          // system reporting back what they just did.
          className="group relative"
        >
          {attachment.isImage && attachment.preview ? (
            <img
              src={attachment.preview}
              alt={attachment.name}
              className="size-14 rounded-lg border border-hairline-strong bg-card object-cover"
            />
          ) : (
            <div className="flex h-14 max-w-56 items-center gap-2 rounded-lg border border-hairline-strong bg-card px-2.5">
              <FileIcon path={attachment.path} className="size-5 shrink-0" />

              {/* `min-w-0` so the name truncates instead of setting the tile's
                  floor and pushing the rest of the tray out of the box. */}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-ui">{attachment.name}</span>
                <span className="text-ui text-muted-foreground/70">
                  {formatBytes(attachment.size)}
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => onRemove(attachment.path)}
            aria-label={`Remove ${attachment.name}`}
            className={cn(
              "absolute -top-1.5 -right-1.5 cursor-pointer rounded-full border border-border bg-secondary p-0.5 text-secondary-foreground opacity-0 transition-opacity",
              "group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none",
            )}
          >
            <X className="size-3" strokeWidth={2.5} />
          </button>
        </li>
      ))}

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
