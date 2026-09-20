import { cn } from "@/lib/utils";
import type { Provider, ProviderPreset } from "@/types/events";

/// A gateway's mark, in the vendor's own path data.
///
/// **One tile, one glyph, one ink — the rule [`ModelMark`] states for models,
/// applied to the gateways they arrive through.** Both marks here are a shape
/// cut out of a filled square, so drawn in `currentColor` they carry the same
/// weight in every palette; a mark that brought its own black tile would go
/// invisible on a dark page, which is the one thing a logo may not do.
///
/// The paths are the vendors' and are used to name what the reader is about to
/// connect to. Command Code's is the glyph from its own app icon, with the
/// rounded-square plate dropped — the plate is the tile this draws it in.
///
/// `rule` is only set where the glyph's holes depend on it: OpenCode's is
/// specified `evenodd` by its own set, and Command Code's leans on the winding
/// its path already carries, so adding one there would fill its four rings in.
///
/// **The viewBox is the glyph's own bounding box, not the file's.** Both
/// vendors ship theirs inside a square plate with padding around it, and drawn
/// at that size the mark sits in the tile at two thirds of the height it was
/// given — measured on screen, the one thing a logo may not look like is small
/// for its own box.
const MARKS: Record<string, { viewBox: string; path: string; rule?: "evenodd" }> = {
  "command-code": {
    // A square 83.77 across, centred at (68, 68): the four rings' outer edges.
    viewBox: "26.18 26.18 83.77 83.77",
    path: "m93.6604 26.1784c-8.982 0-16.2887 7.3067-16.2887 16.2888v6.9809h-18.6158v-6.9809c0-8.9821-7.3067-16.2888-16.2887-16.2888-8.9821 0-16.2888 7.3067-16.2888 16.2888s7.3067 16.2887 16.2888 16.2887h6.9809v18.6158h-6.9809c-8.9821 0-16.2888 7.3067-16.2888 16.2888 0 8.9825 7.3067 16.2885 16.2888 16.2885 8.982 0 16.2887-7.306 16.2887-16.2885v-6.981h18.6158v6.981c0 8.9825 7.3067 16.2885 16.2887 16.2885 8.9826 0 16.2886-7.306 16.2886-16.2885 0-8.9821-7.306-16.2888-16.2886-16.2888h-6.9809v-18.6158h6.9809c8.9826 0 16.2886-7.3066 16.2886-16.2887s-7.306-16.2888-16.2886-16.2888zm-6.9809 23.2697v-6.9809c0-3.8628 3.1182-6.9809 6.9809-6.9809 3.8628 0 6.9806 3.1181 6.9806 6.9809 0 3.8627-3.1178 6.9809-6.9806 6.9809zm-44.2123 0c-3.8628 0-6.9809-3.1182-6.9809-6.9809 0-3.8628 3.1181-6.9809 6.9809-6.9809 3.8627 0 6.9809 3.1181 6.9809 6.9809v6.9809zm16.2887 27.9236v-18.6158h18.6158v18.6158zm34.9045 23.2693c-3.8627 0-6.9809-3.1178-6.9809-6.9805v-6.981h6.9809c3.8628 0 6.9806 3.1182 6.9806 6.981 0 3.8627-3.1178 6.9805-6.9806 6.9805zm-51.1932 0c-3.8628 0-6.9809-3.1178-6.9809-6.9805 0-3.8628 3.1181-6.981 6.9809-6.981h6.9809v6.981c0 3.8627-3.1182 6.9805-6.9809 6.9805z",
  },
  "opencode-go": {
    // 16 wide by 20 tall, from (4, 2).
    viewBox: "4 2 16 20",
    path: "M16 6H8v12h8V6zm4 16H4V2h16v20z",
    rule: "evenodd",
  },
};

/// The tile a gateway is drawn as.
///
/// A size up from the marks in the model picker: there the mark is a footnote
/// beside a name the reader is scanning, and here it is the thing the row is
/// *about* — which gateway this is. `id` is a preset's own slug, and anything
/// unrecognised falls back to the gateway's initial, the same bargain
/// [`ModelMark`] makes: half a list of logos with holes between them reads as
/// broken images, and a letter claims nothing.
export default function ProviderMark({
  id,
  name,
  className,
}: {
  id: string;
  /// What a markless gateway is initialled from.
  name?: string;
  className?: string;
}) {
  const mark = MARKS[id];

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted",
        className,
      )}
    >
      {mark ? (
        <svg
          viewBox={mark.viewBox}
          fillRule={mark.rule}
          className="size-6 fill-current text-foreground/80"
        >
          <path d={mark.path} />
        </svg>
      ) : (
        <span className="text-base leading-none font-medium text-muted-foreground">
          {initialOf(name)}
        </span>
      )}
    </span>
  );
}

function initialOf(name: string | undefined): string {
  const lead = /[a-z0-9]/i.exec(name ?? "");
  return lead ? lead[0].toUpperCase() : "?";
}

/// The preset a connected provider came from, or `null` where it came from the
/// manual form.
///
/// **Matched on the gateway's own identity, not on the row it is drawn in.** A
/// provider the CLI lists carries no preset id — it is a `custom_provider` like
/// every other — so the two facts that survive the round trip are the ones this
/// reads: the name the reader connected it under, and the URL the agent reports
/// it on. Name first, because two presets over one URL is exactly the case this
/// app stopped having.
export function presetFor(
  provider: Provider,
  presets: ProviderPreset[],
): ProviderPreset | null {
  return (
    presets.find((candidate) => candidate.name === provider.name) ??
    presets.find((candidate) => sameGateway(candidate.baseUrl, provider.baseUrl ?? "")) ??
    null
  );
}

/// Whether two URLs name one gateway, tolerating the trailing slash a reader
/// may or may not have pasted.
function sameGateway(a: string, b: string): boolean {
  const trim = (url: string) => url.trim().replace(/\/+$/, "").toLowerCase();
  return a !== "" && trim(a) === trim(b);
}

/// The gateway's host alone, for a facts line with no room for a full URL.
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  return match ? match[1] : url.trim();
}
