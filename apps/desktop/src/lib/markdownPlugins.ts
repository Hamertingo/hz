import { defaultRehypePlugins, type StreamdownProps } from "streamdown";

import { findPromptPaths, isFilePath, isRelativePath, splitLocator } from "@/lib/filePath";
import { findPrRefs } from "@/lib/prRef";

// `rehype-harden` drops the href of any link it cannot resolve, which is right,
// and then writes " [blocked]" into the prose beside it, which is not: two
// ordinary shapes hit it. Greptile's severity badges are `<a href="#">` around
// an image — harden's hash-only branch compares `new URL("#", base).hash`
// against `"#"` and that is `""`, so a bare fragment falls through to a parse
// that throws — and a bare relative path in agent output (`src/foo.tsx`) starts
// with none of `/`, `./`, `../`, so it is never parsed either. `text-only`
// keeps the link's own content and adds nothing; real http(s) links are
// untouched, and losing the href is the safe direction.
//
// Harden's own function comes back out of Streamdown's default list rather than
// from a direct dependency, which is what pins it to whatever version
// Streamdown itself runs. Passing `rehypePlugins` replaces that list whole, so
// raw and sanitize have to be named here too.
const [hardenPlugin, hardenDefaults] = defaultRehypePlugins.harden as [
  unknown,
  Record<string, unknown>,
];

const HARDEN = [
  hardenPlugin,
  { ...hardenDefaults, linkBlockPolicy: "text-only", imageBlockPolicy: "text-only" },
];

/// The block `rehypeTableCells` puts inside every table cell, and the hook
/// `Markdown` hangs the cell's width cap on. The name is spelled again in
/// `Markdown`'s class list — Tailwind only reads literal class strings, so the
/// two cannot share the constant.
export const TABLE_CELL_CLASS = "hz-table-cell";

/// Wraps each table cell's content in one block, so a width cap has an element
/// it actually works on. A wide table is meant to scroll in its wrapper, not
/// squeeze — but with no cap at all, one long-prose cell runs its whole
/// paragraph out on a single line. The cap cannot sit on the cell: min/max
/// width on a `td` is undefined in auto table layout and WebKit ignores it,
/// where a block child is ordinary block layout, whose `max-width` clamps the
/// column the cell measures out to.
function rehypeTableCells() {
  return (tree: HastNode) => wrapCells(tree);
}

export function wrapCells(node: HastNode) {
  if (node.tagName === "th" || node.tagName === "td") {
    node.children = [
      {
        type: "element",
        tagName: "div",
        properties: { className: [TABLE_CELL_CLASS] },
        children: node.children ?? [],
      },
    ];
    return;
  }
  for (const child of node.children ?? []) {
    if (child.type === "element") wrapCells(child);
  }
}

/// Streamdown's own rehype pipeline, with harden told to block a link by
/// unwrapping it rather than by annotating the text around it, and every table
/// cell given the block its width cap rides on. Cell wrapping sits after
/// sanitize, which would otherwise strip the block it adds; harden stays last.
export const REHYPE_PLUGINS = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  rehypeTableCells,
  HARDEN,
] as StreamdownProps["rehypePlugins"];

/// The marker `rehypeFilePaths` leaves on a run it picked out, and what tells
/// `Markdown`'s `span` override which spans are its own.
///
/// The path itself rides `title`, not the text, because the two are not always
/// the same thing: a path found in prose is its own label, and a markdown link
/// spelled `[Footer.js](/Users/me/Footer.js)` has a label of its own that has to
/// survive. `title` is what the reader wants on hover either way, so it is
/// carrying a fact rather than being smuggled.
export const FILE_PATH_CLASS = "hz-file-path";

/// Set beside [FILE_PATH_CLASS] on a run that was a markdown link before it was
/// a file link, so it can be drawn as the link its author wrote rather than as
/// a path found in a sentence. Two classes rather than one, because "is ours"
/// and "was written as a link" are two facts and only the first decides whether
/// this opens anything.
export const FILE_LINK_CLASS = "hz-file-path-link";

/// The marker `rehypePrRefs` leaves on a pull request a message names, and what
/// tells `Markdown`'s `span` override which spans are its own.
///
/// The number rides `data-pr` rather than being read back out of the text, the
/// same reason a path rides `title`: the label a reader sees is the reference as
/// it was written, and a chip that parsed its own label would be a second copy
/// of a rule that already ran.
export const PR_REF_CLASS = "hz-pr-ref";

/// Enough of hast to walk it. Typed here rather than pulled from `@types/hast`,
/// which is not a dependency and would be one for four fields.
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/// Not prose, so not searched. `pre` covers a fenced block and its `code` with
/// it, since nothing descends into a skipped element — a path inside one is
/// already being drawn by the highlighter, and splitting its text would break
/// the tokens. `a` is here too, and checked *after* `anchorToFile`: a link whose
/// href names a file becomes one of ours, and any other link is left whole. A
/// path sitting in a real link's own label therefore stays plain, which it must
/// — that text already belongs to a link, and nesting a second one inside it
/// would fire both on one click.
const NOT_PROSE = new Set(["pre", "a", "script", "style"]);

function marked(path: string, children: HastNode[], wasLink = false, line?: number): HastNode {
  return {
    type: "element",
    tagName: "span",
    properties: {
      className: wasLink ? [FILE_PATH_CLASS, FILE_LINK_CLASS] : [FILE_PATH_CLASS],
      title: path,
      // Only where a locator was on, so a span with none carries no attribute.
      ...(line ? { dataLine: String(line) } : {}),
    },
    children,
  };
}

/// The span a named pull request is marked with.
///
/// A `span` and not an `a`, which is the one place this departs from
/// [anchorToFile]: a link here does not leave the app, and an anchor that
/// Streamdown hands to `Anchor` would raise the "open it out there?" dialog for
/// something that opens a pane. Nothing downstream has to know the difference —
/// `span` is already where the file-path marker lands.
function markedPr(number: number, label: string): HastNode {
  return {
    type: "element",
    tagName: "span",
    properties: { className: [PR_REF_CLASS], dataPr: String(number) },
    children: [{ type: "text", value: label }],
  };
}

/// The link a markdown anchor is, where its href names a file rather than a
/// page.
///
/// `[Footer.js](/Users/me/app/Footer.js)` is the shape, and it is the one an
/// agent writes most readily. Left alone it stays an anchor, so clicking it
/// raised the external-link confirmation for something that is not a URL and
/// then had nowhere to go. Converting it here means Streamdown never sees a
/// link at all. The anchor's own children carry through, so the label the agent
/// wrote is what stays on screen.
function anchorToFile(node: HastNode): HastNode | null {
  if (node.tagName !== "a") return null;

  const href = node.properties?.href;
  if (typeof href !== "string") return null;

  // `[x](/Users/me/My%20Project/x.ts)` is the one way to write a path holding a
  // space as a markdown link — a bare one there ends the href — so the encoded
  // form is the shape to expect, and it names no file left as it is. Decoding
  // cannot smuggle anything past the two rules below, which still run on the
  // result.
  //
  // The locator comes off first, or `[x](/a/b.ts:12)` links to a file literally
  // named `b.ts:12` and `[x](src/a.ts:12)` is refused outright, the relative
  // rule wanting a filename at the end where `a.ts:12` is not one. Split by
  // hand rather than by the prose scan, which trims sentence punctuation an
  // href is not surrounded by and refuses the run holding a space above.
  const { path, line } = splitLocator(decodePath(href));
  if (!isFilePath(path) && !isRelativePath(path)) return null;

  return marked(path, node.children ?? [], true, line);
}

/// `href` with its escapes resolved, or unchanged where they do not resolve.
/// A malformed escape throws, and a link nobody can decode is still a link.
function decodePath(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/// A run of prose one of the passes acts on: where it sits, and the element that
/// replaces it.
type Run = { start: number; end: number; node: HastNode };

/// What a pass looks for in a string of prose.
type Finder = (value: string) => Run[];

/// Marks every path in the prose so `Markdown` can draw it as a link.
///
/// Runs after sanitize, which would otherwise strip what this adds, and
/// **before** harden, which rewrites or unwraps an href before this could read
/// one. It is a hand-written walk rather than `unist-util-visit` because the
/// walk is twenty lines and the visitor is a dependency, and because splitting
/// one node into several is the case a visitor makes awkward anyway.
function rehypeFilePaths() {
  return (tree: HastNode) => walk(tree);
}

/// Marks every pull request a message names, so `Markdown` can draw it as a
/// chip that opens the pull-requests page on that number.
///
/// A second pass rather than a second thing the file pass looks for, because
/// the two answer different questions — a path is a file on this machine, a
/// number is a pull request in this repository — and the walk they share is the
/// only part that is the same.
function rehypePrRefs() {
  return (tree: HastNode) =>
    walk(tree, (value) =>
      findPrRefs(value).map((ref) => ({
        start: ref.start,
        end: ref.end,
        node: markedPr(ref.number, value.slice(ref.start, ref.end)),
      })),
    );
}

/// One walk, and the two passes above hand it what to look for.
///
/// The file pass is the default because it was here first and because it is the
/// one its own tests drive by name; `element` is its own step — an anchor whose
/// href names a file is *converted* rather than descended into — and is left
/// out by a pass that has no such element. Everything else is shared: the
/// recursion, the elements nothing descends into, and the splitting of one text
/// node into the runs around a match.
export function walk(
  node: HastNode,
  find: Finder = (value) =>
    findPromptPaths(value).map(({ start, end, path, line }) => ({
      start,
      end,
      // The label is the match and not `path`: the two differ by the locator,
      // which the link keeps on screen and leaves out of what it opens.
      node: marked(path, [{ type: "text", value: value.slice(start, end) }], false, line),
    })),
  element: (node: HastNode) => HastNode | null = anchorToFile,
) {
  const children = node.children;
  if (!children) return;

  // Left null until something actually matches, so a tree with no path in it
  // is walked without being rebuilt.
  let next: HastNode[] | null = null;

  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];

    if (child.type === "element") {
      const link = element?.(child);
      if (link) {
        next ??= children.slice(0, i);
        next.push(link);
        continue;
      }

      if (!NOT_PROSE.has(child.tagName ?? "")) walk(child, find, element);
      next?.push(child);
      continue;
    }

    const value = child.type === "text" ? child.value : undefined;
    // Relative paths too, the bubble's own reading. The pass has no working
    // directory to resolve one against, so the span carries it as written and
    // `MarkedSpan` resolves it against the chat's cwd, as a mention is.
    const runs = value ? find(value) : [];
    if (!value || runs.length === 0) {
      next?.push(child);
      continue;
    }

    next ??= children.slice(0, i);

    let at = 0;
    for (const { start, end, node } of runs) {
      if (start > at) next.push({ type: "text", value: value.slice(at, start) });
      next.push(node);
      at = end;
    }
    if (at < value.length) next.push({ type: "text", value: value.slice(at) });
  }

  if (next) node.children = next;
}

/// The same pipeline with the references a session can act on marked: paths that
/// name a file on *this* machine, and pull request numbers that name one in this
/// repository.
///
/// A second list rather than a flag, because which surface gets this is the
/// part worth being able to read. An issue description or a PR comment names
/// paths from somebody else's checkout and numbers from its own repository's
/// world, so marking them there would offer to open files the reader does not
/// have — and there is no session for a chip to be resolved against.
export const REHYPE_PLUGINS_WITH_SESSION_REFS = [
  defaultRehypePlugins.raw,
  defaultRehypePlugins.sanitize,
  rehypeTableCells,
  rehypeFilePaths,
  rehypePrRefs,
  HARDEN,
] as StreamdownProps["rehypePlugins"];
