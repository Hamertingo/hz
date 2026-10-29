// The safety side (command_review.rs, safety_tools.rs): a turn whose Mac commands the reviewer approved on its own,
// so the quiet "approved" lines draw, a key Atlas is waiting on, and the defaults the Access tab reads.
import { handlers as tools } from "./zz-teamtalk";

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60000).toISOString();
const SESSION = "s-a1";

type Ev = Record<string, unknown>;

function turn(start: number): Ev[] {
  let seq = start;
  const out: Ev[] = [];
  const push = (payload: Ev, ago: number) =>
    out.push({ id: `${SESSION}-sf${++seq}`, sessionId: SESSION, harness: "claude-acp", seq, ts: iso(ago), turnId: "sf1", subagent: null, payload, raw: null });
  const ran = (callId: string, command: string, label: string, output: string) => {
    push({ type: "permission_decided", requestId: callId, toolUseId: callId, behavior: "allow", label, automatic: true }, 4);
    push({ type: "tool_call_started", callId, name: "Bash", toolType: "shell", input: { command }, rawInput: null, title: null }, 4);
    push({ type: "tool_call_completed", callId, result: { text: output, isError: false, structured: null, exitCode: 0, durationMs: 80, images: [] } }, 4);
  };
  push({ type: "user_message", text: "What changed in the repo since yesterday?", images: [], baseline: null, queued: false, from: null, replyTo: null, cwd: null }, 5);
  ran("sf-c1", "git log --since=yesterday --oneline", "Read-only command", "a1b2c3d fix: billing meter\n9f8e7d6 docs: pricing");
  ran("sf-c2", "git diff --stat HEAD~2", "Read-only command", " 3 files changed, 41 insertions(+), 9 deletions(-)");
  const text = "Two commits since yesterday: the billing meter fix and the pricing docs, 3 files in all.";
  push({ type: "assistant_text", block: 0, text }, 3);
  push({ type: "turn_completed", status: "completed", stopReason: "end_turn", finalText: text, usage: null, durationMs: 9000, head: null }, 3);
  return out;
}

const KEY_ASKS = [{ id: "ka1", agentId: "a1", name: "OPENAI_API_KEY", why: "To transcribe the call recordings on my computer. It is under API keys at platform.openai.com." }];

export const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
  get_session_by_id: (a) => {
    const base = tools.get_session_by_id(a) as { events: Ev[] } | null;
    if (!base || a.sessionId !== SESSION) return base;
    const last = Math.max(0, ...base.events.map((e) => Number(e.seq)));
    return { ...base, events: [...base.events, ...turn(last)] };
  },
  kit_review_default_get: () => "auto_review",
  kit_review_default_set: () => null,
  kit_key_requests: () => KEY_ASKS,
  kit_key_save: () => {
    KEY_ASKS.length = 0;
    return null;
  },
  kit_key_dismiss: () => {
    KEY_ASKS.length = 0;
    return null;
  },
  kit_keys: () => ["GITHUB_TOKEN"],
  kit_key_remove: () => null,
  permission_always_allow: () => "Always allow `git push`",
};
