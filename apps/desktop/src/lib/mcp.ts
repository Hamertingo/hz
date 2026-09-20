import type { McpConfig, McpTestResult } from "@/types/events";

/// What the MCP pane is showing: a server that is written down, one being written,
/// or nothing.
///
/// **One value, and `null` is not `"new"`.** "Add a server" and "a server named
/// `new`" are two different things, and the second is legal — the agent allows the
/// name — so a sentinel string would one day open the wrong form.
export type McpPick = { mode: "server"; name: string } | { mode: "new" } | null;

/// The transports a server can use, in the order the picker offers them.
///
/// The agent's own four words, verbatim: it validates against this set and would
/// refuse one this build invented.
export const MCP_TRANSPORTS = ["stdio", "http", "streamable-http", "sse"] as const;

/// What each transport is called on screen.
///
/// `stdio` is the odd one — its identifier names a *pipe*, which is not a thing a
/// reader has a picture of, and what it actually means is "a command this app
/// runs". So the label says that, and the identifier stays the agent's.
const TRANSPORT_LABELS: Record<string, string> = {
  stdio: "Runs a command",
  http: "HTTP",
  "streamable-http": "HTTP (streamable)",
  sse: "SSE",
};

export function transportLabel(transport: string): string {
  return TRANSPORT_LABELS[transport] ?? transport;
}

/// Whether a transport answers at a URL rather than running a command.
///
/// One word for it, so the form asks it once: everything that branches on the two
/// halves of `McpConfig` — which fields to draw, what "required" means — reads
/// this rather than comparing against `"stdio"` in five places.
export function isRemote(transport: string): boolean {
  return transport !== "stdio";
}

/// A blank configuration, for the form behind "Add server".
///
/// `null` rather than `""` for the empty fields, because that is what the agent
/// reads as *absent*: an empty string is a value it has to refuse, and a form that
/// has never been filled in has no values at all.
export function emptyConfig(): McpConfig {
  return {
    transport: "stdio",
    command: null,
    args: null,
    env: null,
    url: null,
    headers: null,
    timeoutMs: null,
    description: null,
  };
}

/// The agent's own rule for a server name, which is also the file's key.
const NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/// What is wrong with a draft, or `null` for one worth saving.
///
/// **The agent's rules, said before the round trip.** It refuses a blank command, a
/// URL that is not `http(s)`, a name that is not a slug — and every one of those is
/// a sentence worth showing beside the field, rather than a refusal from a child
/// that took a second to boot. The rules are the agent's and are not *enforced*
/// here: this says what will be refused, and the agent still has the last word.
export function draftProblem(name: string, config: McpConfig): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the server a name.";
  if (trimmed.length > 80 || !NAME_PATTERN.test(trimmed)) {
    return "A name holds letters, numbers, dots, underscores and hyphens.";
  }

  if (!isRemote(config.transport)) {
    return config.command?.trim()
      ? null
      : "A command is required — this is what starts the server.";
  }

  const url = config.url?.trim() ?? "";
  if (!url) return "A URL is required — this is where the server answers.";
  if (!isHttpUrl(url)) return "The URL has to start with http:// or https://.";
  return null;
}

/// Whether an address is one the agent will take.
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/// What a connection test is telling the reader.
///
/// **The agent's code, said in this app's words.** The codes are a closed set the
/// agent owns, and each names a different thing to go and do — which is why they
/// are mapped rather than printed: `MCP_COMMAND_NOT_FOUND` means "install it", and
/// nothing about that identifier says so.
///
/// The fallback is the agent's own sentence where it sent one, because an
/// unrecognised code is more likely to be a newer agent than a broken one.
export function describeTest(result: McpTestResult): string {
  if (result.success) {
    const tools = result.toolCount ?? 0;
    if (tools === 0) return "Connected.";
    return `Connected — ${tools} ${tools === 1 ? "tool" : "tools"}.`;
  }

  switch (result.errorCode) {
    case "MCP_SERVER_DISABLED":
      return "This server is switched off. Switch it on, then test it.";
    case "MCP_COMMAND_NOT_FOUND":
      return "The command was not found. Check it is installed, and that the agent's PATH can see it.";
    case "MCP_CONNECTION_TIMEOUT":
      return "The connection timed out.";
    case "MCP_CONNECTION_UNAVAILABLE":
      return "No connection could be made.";
    case "MCP_HANDSHAKE_FAILED":
      return "It connected, but the MCP handshake failed — this may not be an MCP server.";
    default:
      return result.errorMessage?.trim() || "The connection failed.";
  }
}

/// What a row says under its name: where the server is, or how it runs.
///
/// The endpoint the agent sends for a stdio server is the command's own base name,
/// so a row reads `command npx` or `https://host/mcp` rather than a path the reader
/// never typed.
export function serverEndpoint(server: { endpoint: string | null; transport: string }): string {
  return server.endpoint?.trim() || transportLabel(server.transport);
}

/// A command line as one field holds it — the command and its arguments together,
/// which is how every command is written anywhere else.
///
/// **Quotes are understood, because a path may hold a space.** `npx -y pkg` is the
/// common case and needs nothing; `"/Applications/My App/bin/x"` needs the field to
/// keep it whole, and a plain split on whitespace would silently hand the agent two
/// arguments where the reader wrote one. So the line is read the way a shell reads
/// one, which is what somebody typing a command already assumes.
///
/// The agent's own shape is still two fields — this is only what the form holds, and
/// it is taken apart again on the way out.
export function splitCommand(line: string): {
  command: string;
  args: string[] | null;
} {
  const [command = "", ...args] = commandTokens(line);
  return { command, args: args.length > 0 ? args : null };
}

/// The two fields back as one line, quoting anything a split would break.
export function joinCommand(command: string | null, args: string[] | null): string {
  const parts = [command ?? "", ...(args ?? [])].filter(
    (part, index) => index === 0 || part !== "",
  );
  return parts.map(quoteIfNeeded).join(" ");
}

/// The line, cut into arguments with `"…"` and `'…'` respected.
///
/// A backslash escapes the next character **inside double quotes only**, which is
/// what `joinCommand` writes and what a shell does; in single quotes everything is
/// literal. That pair is what makes the round trip close — an argument holding a
/// double quote is written `\"` and read back whole.
function commandTokens(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted: '"' | "'" | null = null;
  let escaped = false;
  /// Whether a token is being built, so `""` is an empty argument rather than no
  /// argument — a distinction a split on whitespace cannot make.
  let started = false;

  for (const char of line) {
    if (quoted) {
      if (quoted === '"' && char === "\\" && !escaped) {
        escaped = true;
        continue;
      }
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === quoted) quoted = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quoted = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) out.push(current);
      current = "";
      started = false;
      continue;
    }
    current += char;
    started = true;
  }

  if (started) out.push(current);
  return out;
}

function quoteIfNeeded(part: string): string {
  if (part !== "" && !/[\s"']/u.test(part)) return part;
  return `"${part.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
///
/// **Lines rather than a row per entry, and that is a choice about pasting.**
/// `env` and `headers` are the two fields a reader fills from somebody else's
/// documentation — six variables arrive as six lines — and a row editor turns that
/// into six trips through an "add" button. It is also the shape a `.env` file
/// already has, so there is nothing here to learn.
export function mapToLines(map: Record<string, string> | null): string {
  if (!map) return "";
  return Object.entries(map)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/// The lines back, with blank ones dropped.
///
/// **A line with no `=` is skipped, not reported.** It is a reader part-way through
/// typing rather than a mistake — and the save is refused, if it is refused at all,
/// by the name or the command, long before it would be by this.
export function linesToMap(text: string): Record<string, string> | null {
  const entries = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf("=");
      if (at === -1) return null;
      const key = line.slice(0, at).trim();
      return key ? ([key, line.slice(at + 1).trim()] as const) : null;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null);

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/// A list of strings as the lines of a textarea — one argument per line, which is
/// how a command arrives in documentation and how it reads back.
export function listToLines(list: string[] | null): string {
  return list?.join("\n") ?? "";
}

export function linesToList(text: string): string[] | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : null;
}
