/// A scrollback good enough for a shell: the lines it has printed and where the
/// cursor sits on the last one. No colour, no cursor addressing — escape
/// sequences are dropped, and a carriage return or backspace rewrites the line
/// the way a terminal would, which is what progress bars and prompts rely on.
export type Screen = { lines: string[]; col: number };

export const EMPTY_SCREEN: Screen = { lines: [""], col: 0 };

/// Most lines kept. A shell left running a build for an hour would otherwise grow
/// the sheet without bound.
const MAX_LINES = 2000;

// CSI (colours, cursor moves, bracketed paste), OSC (window titles), and the
// two-character escapes. Written with the escape as `\u001b` so the pattern can
// be read.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal escapes
const ESCAPES = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/// `text` without terminal escape sequences, for output shown as plain text.
export function stripAnsi(text: string): string {
  return text.replace(ESCAPES, "");
}

/// `screen` after `chunk` has been printed to it.
export function feed(screen: Screen, chunk: string): Screen {
  const lines = [...screen.lines];
  let col = screen.col;
  let line = lines.length - 1;

  for (const ch of chunk.replace(ESCAPES, "")) {
    if (ch === "\n") {
      lines.push("");
      line = lines.length - 1;
      col = 0;
    } else if (ch === "\r") {
      col = 0;
    } else if (ch === "\b") {
      col = Math.max(0, col - 1);
    } else if (ch === "\u0007" || ch < " ") {
      // Bell and the other control characters print nothing.
    } else {
      const text = lines[line];
      lines[line] = text.slice(0, col).padEnd(col, " ") + ch + text.slice(col + 1);
      col += 1;
    }
  }

  const kept = lines.length > MAX_LINES ? lines.slice(lines.length - MAX_LINES) : lines;
  return { lines: kept, col };
}

/// The screen as one string, for drawing.
export function screenText(screen: Screen): string {
  return screen.lines.join("\n");
}
