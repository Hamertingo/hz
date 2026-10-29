import type { RichCardData } from "@/components/chat/cards";
import type { AgentEvent, ToolResult } from "@/types/events";
import type { JsonValue } from "@/types/serde_json/JsonValue";

/// The tools hz serves an agent at `/mcp/<agent>/hz` (`src-tauri/src/agent_tools.rs`), the ones that post a card.
export const HZ_TOOLS = [
  "propose_draft",
  "page_create",
  "page_update",
  "show_chart",
  "show_widget",
  "show_plan",
  "share_screenshot",
  "wake_when_done",
  "request_login",
  "qr_login",
  "create_agent",
] as const;
export type HzTool = (typeof HZ_TOOLS)[number];

const KNOWN = new Set<string>(HZ_TOOLS);

/// Which hz tool a call is, under whatever prefix its CLI gives an MCP tool: Claude's `mcp__hz__x`, OpenCode's
/// `hz_x`, or Codex's bare `x` titled `hz · x`.
export function hzTool(name: string, title: string | null = null): HzTool | null {
  const bare = /^mcp__hz__(.+)$/.exec(name)?.[1] ?? /^hz_(.+)$/.exec(name)?.[1] ?? /^hz · (.+)$/.exec(title ?? "")?.[1] ?? name;
  return KNOWN.has(bare) ? (bare as HzTool) : null;
}

export type Region = { x: number; y: number; w: number; h: number };

/// The cards only a tool posts. They share the frame of `RichCardData`, and live beside it rather than in it
/// because each one reads or acts on state the backend keeps (a widget's document, a waiting sign-in).
export type PostCard =
  | { type: "widget"; id: string; title: string }
  | { type: "image"; path: string; caption: string }
  | { type: "plan"; steps: { text: string; state: "done" | "run" | "todo" }[] }
  | { type: "watch"; label: string; pid: number }
  | { type: "signin"; site: string; why: string; qr: boolean; region: Region | null; state: "waiting" | "done" | "declined" | "unanswered" }
  | { type: "agent"; id: string; name: string; role: string };

/// `stored` is the id of the card as the backend kept it (`kit.post`), which wins over `card` once loaded: `card` is
/// built from the call's logged input, and a CLI can log that before every argument has arrived.
export type ToolPost = { key: string; card: RichCardData | PostCard; stored?: string };

type Input = Record<string, JsonValue>;

const str = (input: Input, key: string) => {
  const v = input[key];
  return typeof v === "string" ? v.trim() : "";
};

/// `(id p_1a2b, version 3)` → `p_1a2b`, and the version beside it: how `agent_tools.rs` names what a card needs.
export function idIn(text: string): { id: string; version: number | null } | null {
  const m = /\(id ([\w-]+)(?:, version (\d+))?\)/.exec(text);
  return m ? { id: m[1], version: m[2] ? Number(m[2]) : null } : null;
}

/// `(file /path/x.png)` → the path.
export function fileIn(text: string): string | null {
  return /\(file ([^)]+)\)/.exec(text)?.[1] ?? null;
}

function stateOf(status: string): "done" | "run" | "todo" {
  const s = status.toLowerCase();
  if (["done", "completed", "complete", "finished"].includes(s)) return "done";
  if (["running", "in_progress", "active", "doing"].includes(s)) return "run";
  return "todo";
}

function region(v: JsonValue | undefined): Region | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : Number.NaN);
  const r = { x: n("x"), y: n("y"), w: n("w"), h: n("h") };
  return Object.values(r).every(Number.isFinite) && r.w > 0 && r.h > 0 ? r : null;
}

/// The cards a turn's hz tool calls posted, in the order they were made. Found from each call and the answer it got,
/// so a card is part of the transcript and comes back with it; drawn from what the backend kept, with the call's own
/// input standing in until that loads. A call that failed posts nothing (its
/// row already says why); one still waiting posts only when the person has to act on it. A page or a plan the turn
/// wrote several times shows once, as it ended.
export function toolPosts(calls: readonly AgentEvent[], results: ReadonlyMap<string, ToolResult>): ToolPost[] {
  const out: ToolPost[] = [];
  const pageAt = new Map<string, number>();
  let planAt = -1;

  for (const e of calls) {
    const p = e.payload;
    if (p.type !== "tool_call_started") continue;
    const tool = hzTool(p.name, p.title);
    if (!tool) continue;
    const input = (p.input && typeof p.input === "object" && !Array.isArray(p.input) ? p.input : {}) as Input;
    const result = results.get(p.callId);
    if (result?.isError) continue;
    const text = result?.text ?? "";
    const key = p.callId;

    switch (tool) {
      case "propose_draft": {
        const id = idIn(text)?.id;
        if (id) out.push({ key, card: { type: "draft", id, to: str(input, "to"), part: str(input, "subject"), body: str(input, "body"), channel: str(input, "via") || "clipboard" } });
        break;
      }
      case "page_create":
      case "page_update": {
        const ref = idIn(text);
        if (!ref) break;
        const earlier = pageAt.get(ref.id);
        const title = str(input, "title") || (earlier !== undefined ? (out[earlier].card as { title: string }).title : "Page");
        const card: RichCardData = { type: "page", id: ref.id, title, url: "Live page", version: ref.version ?? 1 };
        if (earlier !== undefined) out[earlier] = { key: out[earlier].key, card };
        else {
          pageAt.set(ref.id, out.length);
          out.push({ key, card });
        }
        break;
      }
      case "show_chart": {
        if (!result) break;
        const points = Array.isArray(input.points) ? input.points : [];
        const bars = points.flatMap((pt): [string, number][] =>
          pt && typeof pt === "object" && !Array.isArray(pt) && typeof pt.value === "number" ? [[String(pt.label ?? ""), pt.value]] : [],
        );
        const kind = str(input, "kind");
        out.push({
          key,
          stored: idIn(text)?.id,
          card: { type: "chart", title: str(input, "title"), unit: str(input, "unit") || undefined, bars, note: str(input, "note") || undefined, kind: kind === "line" || kind === "pie" ? kind : "bar" },
        });
        break;
      }
      case "show_widget": {
        const id = idIn(text)?.id;
        if (id) out.push({ key, card: { type: "widget", id, title: /^Widget "(.*)" shown/.exec(text)?.[1] ?? str(input, "title") } });
        break;
      }
      case "show_plan": {
        const steps = (Array.isArray(input.steps) ? input.steps : []).flatMap((s) => {
          if (!s || typeof s !== "object" || Array.isArray(s)) return [];
          const words = typeof s.text === "string" ? s.text : typeof s.content === "string" ? s.content : "";
          return words.trim() ? [{ text: words.trim(), state: stateOf(typeof s.status === "string" ? s.status : "") }] : [];
        });
        const stored = idIn(text)?.id;
        if (!steps.length && !stored) break;
        const card: PostCard = { type: "plan", steps };
        if (planAt >= 0) out[planAt] = { key: out[planAt].key, card, stored };
        else {
          planAt = out.length;
          out.push({ key, card, stored });
        }
        break;
      }
      case "share_screenshot": {
        const path = fileIn(text);
        if (path) out.push({ key, stored: idIn(text)?.id, card: { type: "image", path, caption: str(input, "caption") } });
        break;
      }
      case "wake_when_done": {
        const pid = typeof input.pid === "number" ? input.pid : 0;
        const said = /^Watching pid (\d+) \(id ([\w-]+)\): (.+?)\. When/.exec(text);
        if (result) out.push({ key, stored: said?.[2], card: { type: "watch", label: said?.[3] ?? (str(input, "label") || "the command"), pid: said ? Number(said[1]) : pid } });
        break;
      }
      case "request_login":
      case "qr_login": {
        const state = !result
          ? "waiting"
          : text.includes("The person says")
            ? "done"
            : text.includes("The person chose not")
              ? "declined"
              : "unanswered";
        out.push({ key, stored: idIn(text)?.id, card: { type: "signin", site: str(input, "site"), why: str(input, "why"), qr: tool === "qr_login", region: region(input.region), state } });
        break;
      }
      case "create_agent": {
        // The answer names the card; the new agent's own id is on the card the backend kept.
        const made = /^Made (.+?) \(id ([\w-]+)\), (.+?)\. They/.exec(text);
        if (made) out.push({ key, stored: made[2], card: { type: "agent", id: "", name: made[1], role: made[3] === "with no role yet" ? "" : made[3] } });
        break;
      }
    }
  }
  return out;
}
