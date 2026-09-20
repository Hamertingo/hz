import { getIconForFilePath } from "vscode-material-icons";

import { cn } from "@/lib/utils";

/// Where a path's Material mark is served from.
///
/// Split out from the component because the composer needs the *URL* and not the
/// element: a chip inside a textarea's mirrored text cannot hold an `<img>`, so
/// the mark is painted as a background image over the placeholder character that
/// reserved its space. One function, so the two ways of drawing the same mark
/// cannot name different files.
export function fileIconUrl(path: string): string {
  return `/file-icons/${getIconForFilePath(path)}.svg`;
}

/// The Material file glyph for a path — a React mark on `.tsx`, the TS mark on
/// `.ts`, and so on down to a plain sheet for anything unrecognized.
///
/// Served as a file rather than inlined: the set is ~900 SVGs keyed by name, so
/// bundling them would ship the whole theme to show a handful. Vite stages them
/// into `public/file-icons` (see vite.config.ts), and in a packaged app they are
/// local reads with no network in front of them.
///
/// These are full-colour brand marks, which is a deliberate exception to the
/// monochrome chrome around them: colour is the whole reason to prefer them over
/// one generic glyph, since it makes a file's type readable before its name is.
export default function FileIcon({ path, className }: { path: string; className?: string }) {
  return (
    <img
      src={fileIconUrl(path)}
      alt=""
      aria-hidden
      draggable={false}
      className={cn("size-4 shrink-0", className)}
    />
  );
}
