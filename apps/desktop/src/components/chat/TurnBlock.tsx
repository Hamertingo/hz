import { Check, Copy } from "lucide-react";
import { Fragment, memo, useMemo, useRef, useState, type ReactNode } from "react";

import AgentTrace from "@/components/chat/AgentTrace";
import AssistantMessage from "@/components/chat/AssistantMessage";
import BloubAvatar from "@/components/BloubAvatar";
import EventRow from "@/components/chat/EventRow";
import SubagentRow from "@/components/chat/SubagentRow";
import ToolGroupRow from "@/components/chat/ToolGroupRow";
import UserMessage from "@/components/chat/UserMessage";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { clockTime, formatDuration } from "@/lib/format";
import { GROUP_MIN, isToolGroup, segmentWork, type SubagentRun, type Turn, type TurnSegment, type WorkItem } from "@/lib/transcript";
import type { TodoTask } from "@/lib/todo";
import type { AgentEvent, FileEdit, ToolResult } from "@/types/events";

type TurnBlockProps = {
  turn: Turn;
  subagentById: Map<string, SubagentRun>;
  resultByCallId: Map<string, ToolResult>;
  editsByCallId?: Map<string, FileEdit[]>;
  /// The plan as it stood at each call that moved it, so a plan row expands
  /// onto the list rather than onto the mutation it came from. Same bargain as
  /// `editsByCallId` and read off the same walk.
  todosByCallId?: Map<string, TodoTask[]>;
  onOpenSubagent: (id: string) => void;
  /// Opens the session that relayed a prompt, for a `user_message` that carries
  /// a sender. Reaches both the turn's own prompt and any queued one inside it.
  onOpenSession: (sessionId: string) => void;
  /// What the settled line's own bot is derived from — the same seed the live
  /// indicator above it carries, so the face working is the face that stopped.
  /// Absent draws no bot, which is right for a caller with no session behind it.
  botSeed?: string;
  /// Trails the turn's work inside this block's own stack. The thinking
  /// indicator and the streaming preview both go here rather than after the
  /// block, so they sit at the same gap the committed event will — placing them
  /// outside left them at the between-turn gap, and the content that replaced
  /// them jumped up by the difference.
  footer?: ReactNode;
};

/// How many rendered rows a turn must have before it collapses behind its
/// summary. Fewer than this and the collapse costs a click to reveal less than
/// the summary line it stood in for.
///
/// Separate from `GROUP_MIN` because they answer different questions — that one
/// is how many *calls* make a group, this is how many *rows* make a collapse —
/// but not independent of it: grouping runs first, so a group is already one row
/// by the time this counts. Keeping this at or above `GROUP_MIN` is what stops a
/// run too short to group from collapsing a turn on its own.
const COLLAPSE_MIN = 3;

/// How long the check mark stands in for the copy glyph. Matches the table's
/// control, since the two are the same gesture one row apart and a different
/// lifetime would read as one of them being broken.
const COPIED_MS = 2000;

// Tune either constant freely, but not past the other: this throws on load
// rather than letting the pairing silently reintroduce ungrouped repeats inside
// a collapsed turn.
if (GROUP_MIN > COLLAPSE_MIN) {
  throw new Error(
    `GROUP_MIN (${GROUP_MIN}) must not exceed COLLAPSE_MIN (${COLLAPSE_MIN}) — ` +
      "runs too short to group would still collapse a turn on their own.",
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/// The same vocabulary as the turn-level summary, per stretch. "step" is the
/// floor for a segment whose rows are all things the parts don't name
/// (reasoning, edits) — a summary line that says nothing offers nothing.
function segmentLabel(seg: TurnSegment) {
  const parts: string[] = [];
  if (seg.toolCalls) parts.push(plural(seg.toolCalls, "tool call"));
  if (seg.messages) parts.push(plural(seg.messages, "message"));
  return parts.join(" · ") || plural(seg.rows, "step");
}

/// The two empties the folded view reuses: rows a stretch has none of, and the
/// segment list of a turn too short to fold. Both are one shared array rather
/// than a fresh `[]` per render, so a prop that means "nothing" compares equal
/// to the last one — `AgentTrace` is memoised, and an empty literal would be the
/// single prop that stopped the row it heads from ever being skipped.
const NO_ROWS: ReactNode[] = [];
const NO_SEGMENTS: TurnSegment[] = [];

/// One turn: the user's prompt, a collapsed summary of the work, and the final
/// answer. Expanding reveals the intermediate steps — **as ordinary rows**, with
/// no rule down their left. See the note at the segments.
///
/// Memoised, and it is the prop identity that does it — `turn`, the four `Map`s
/// and the two callbacks all keep theirs across a streaming turn's renders, so a
/// delta re-renders the one block whose `footer` changed and skips the rest of
/// the transcript. Nothing here compares props deeply, and nothing should: a
/// `Turn` is rebuilt by every walk, so a comparator would have to walk the whole
/// event list behind it to answer the question identity already answers — see
/// the walk's own memo in [Chat](../Chat.tsx).
function TurnBlock({
  turn,
  subagentById,
  resultByCallId,
  editsByCallId,
  todosByCallId,
  onOpenSubagent,
  onOpenSession,
  botSeed,
  footer,
}: TurnBlockProps) {
  // Per segment, not per turn: a stretch of work between queued prompts opens
  // and closes on its own, so peeking at one leaves the others collapsed. Keyed
  // by index, which is stable here — only a running turn's work still grows,
  // and a running turn is never collapsible. A turn without queued prompts is
  // one segment, so this is the old whole-turn toggle in that case.
  const [openSegments, setOpenSegments] = useState<Record<number, boolean>>({});

  const running = turn.completed === null;

  // `finalText` duplicates the turn's last `assistant_text`, so the collapsed
  // view renders it in that message's place rather than alongside it. A running
  // turn has no `finalText` yet, so its work stays visible instead.
  //
  // `rows` rather than `work.length` or the summary counts: a turn whose only
  // work *is* that final message has nothing left to reveal and would offer an
  // empty toggle. See `COLLAPSE_MIN` for why the threshold is what it is.
  const collapsible = !running && turn.rows >= COLLAPSE_MIN;

  // Keyed on `turn`, whose identity holds for as long as the walk's memo does —
  // so the split is not walked again when a preview delta re-renders this block.
  const segments = useMemo(
    () => (collapsible ? segmentWork(turn) : NO_SEGMENTS),
    [collapsible, turn],
  );
  // A fresh object per render defeats the `memo` on `UserMessage` — which is the
  // row doing the most work of any of them, since it highlights a prompt's
  // mentions, paths and markdown on every pass.
  const promptProps = useMemo(() => userProps(turn), [turn]);

  // **A turn with no prompt and nothing but a receipt is drawn as the receipt.**
  // The walk gives an event with nothing in front of it a turn of its own, which
  // is what puts a goal's completion line where it happened rather than at the
  // end — and a whole turn frame around it (a summary line counting one row, a
  // toggle that reveals nothing) would be furniture around a single sentence.
  const only = turn.work.length === 1 ? turn.work[0] : null;
  if (turn.prompt === null && only !== null && !isToolGroup(only) && only.payload.type === "goal_receipt") {
    return (
      <div className="flex flex-col gap-3">
        {renderItem(only, subagentById, resultByCallId, editsByCallId, todosByCallId, onOpenSubagent, onOpenSession)}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {turn.prompt && <UserMessage {...promptProps} onOpenSession={onOpenSession} />}

      {/* The work is cut at each queued prompt and each stretch collapses
          behind its own summary line — hiding the rows between the prompts
          would bunch them all together at the end, and *when* the reader said
          something is part of what they said. */}
      {!collapsible
        ? turn.work.map((item) =>
            renderItem(
              item,
              subagentById,
              resultByCallId,
              editsByCallId,
              todosByCallId,
              onOpenSubagent,
              onOpenSession,
            ),
          )
        : segments.map((seg, i) => {
            const open = !!openSegments[i];
            // The steps of a finished turn, folded the same way a tool run or a
            // reasoning block is. `working` is false by construction — this path
            // only runs once the turn has closed — so the header draws settled
            // and the body stays where the reader left it.
            //
            // **`framed={false}`, so the rows draw as ordinary chat.** The trace
            // body hangs behind a left rule and an indent, which is what makes a
            // run of tool calls read as one piece of work rather than as a list —
            // and it is the wrong shape for the turn's own steps, where the reader
            // is looking at the conversation rather than at a fold of it. The
            // folds *inside* keep theirs: `Thought` and `Ran 6 tools` are what the
            // rule is for.
            return (
              <Fragment key={i}>
                <AgentTrace
                  active={segmentLabel(seg)}
                  done={segmentLabel(seg)}
                  working={false}
                  framed={false}
                  open={seg.rows > 0 ? open : undefined}
                  onToggle={
                    seg.rows > 0
                      ? () => setOpenSegments((prev) => ({ ...prev, [i]: !prev[i] }))
                      : undefined
                  }
                  rows={
                    open
                      ? seg.items.map((item) =>
                          renderItem(
                            item,
                            subagentById,
                            resultByCallId,
                            editsByCallId,
                            todosByCallId,
                            onOpenSubagent,
                            onOpenSession,
                          ),
                        )
                      : NO_ROWS
                  }
                />
                {seg.prompt &&
                  renderItem(
                    seg.prompt,
                    subagentById,
                    resultByCallId,
                    editsByCallId,
                    todosByCallId,
                    onOpenSubagent,
                    onOpenSession,
                  )}
              </Fragment>
            );
          })}

      {/* **The answer, and it is not inside anything.** `finalText` is the turn's
          last message — see `groupTurns`, which takes that row out of the work so
          this is the only copy of it. Opening a summary therefore reveals the
          work and leaves the ending exactly where the reader left it; the version
          that swallowed the answer into the trace left a finished turn with no
          end on screen. */}
      {turn.finalText && <AssistantMessage text={turn.finalText} />}

      <TurnFooter
        prompt={turn.prompt}
        completed={turn.completed}
        text={turn.finalText}
        botSeed={botSeed}
      />

      {footer}

      {turn.completed && (
        <EventRow
          event={turn.completed}
          resultByCallId={resultByCallId}
          editsByCallId={editsByCallId}
          todosByCallId={todosByCallId}
        />
      )}
    </div>
  );
}

export default memo(TurnBlock);

/// The line under a turn's answer: when it landed, how long the reader waited
/// for it, and a way to take the text away.
///
/// **Timed from the prompt's own stamp, which is the reader's clock** — the
/// webview reads it at the press and carries it through the send, because a
/// cold session's first prompt waits out the child's whole boot (~6.5s) before
/// this process writes anything at all. Stamp that at the write and the wait
/// reads as the turn, which is the part the reader did not sit through.
///
/// Both stamps ride the events, so this is right for a session read back off
/// disk as well as one being watched — no timing state, nothing a reload loses.
/// A prompt logged before the stamp existed, and one no person sent (a relayed
/// `hz send`, `hz new`), carries the write time and times slightly short.
function TurnFooter({
  prompt,
  completed,
  text,
  botSeed,
}: {
  prompt: AgentEvent | null;
  completed: AgentEvent | null;
  /// The answer's own markdown, which is what a copy hands over — the source
  /// rather than the rendered text, so a table or a code block pastes as one.
  text: string | null;
  /// Who did the work, for the mark that opens the line. See `TurnBlockProps`.
  botSeed?: string;
}) {
  // Nothing to say about a turn still running or one with no prompt to time it
  // from — the line exists between two events, and either half missing is the
  // whole of it missing.
  if (!prompt || !completed) return null;

  const ms = Date.parse(completed.ts) - Date.parse(prompt.ts);
  const waited = Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : null;
  const at = clockTime(completed.ts);
  // A turn that failed wears the state that says so, so the mark at the head of
  // the line reads the same way the row above it does.
  const failed = completed.payload.type === "turn_completed" && completed.payload.status === "error";

  return (
    <div className="mt-1 flex items-center gap-2 text-ui text-muted-foreground">
      {/* **The face that worked**, and the same one the live indicator above it
          showed — the bot is derived from the session, so the two are one face
          rather than two marks that happen to sit in the same column. */}
      {botSeed && <BloubAvatar name={botSeed} size={14} mood={failed ? "failed" : "done"} />}
      {/* **`Worked for`, and the live row above it says `Working for …`** — one
          sentence in two tenses. It used to read `Responded in`, which named the
          reply rather than the work: a turn that spent forty seconds reading and
          one second answering was reported as though the reading had not
          happened. */}
      {waited && <span>{`Worked for ${waited}`}</span>}
      {/* `ml-auto`, so the clock and the control sit at the column's right edge
          and stay put as the wait grows a digit — a ragged left edge under a
          sentence reads as part of it. */}
      <span className="ml-auto flex items-center gap-1.5">
        {at && <span className="tabular-nums">{at}</span>}
        {text && <CopyMessage text={text} />}
      </span>
    </div>
  );
}

/// Copies the answer whole.
///
/// **Always drawn, not hovered for.** It was hover-revealed at first, and a
/// control that only exists under the cursor is one the reader has to find by
/// sweeping the line — the answer is the thing they came to take away, so the
/// glyph says so at rest. It sits at the column's right edge with the clock,
/// inside the same muted row.
///
/// A failed write shows no check mark and nothing else, the same as the table's
/// control: a transcript row has nowhere to put an error sentence, and the text
/// is still there to select by hand.
function CopyMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy message"
          onClick={() => void copy()}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      {/* The tooltip says what the glyph does and then what the press did —
          one line, and the check mark beside it is the same answer twice over
          for the reader who is looking at the icon. */}
      <TooltipContent>{copied ? "Copied" : "Copy message"}</TooltipContent>
    </Tooltip>
  );
}

/// One work item, shared by the expanded walk and a segment's queued prompt so
/// the two views cannot drift on how a row draws.
function renderItem(
  item: WorkItem,
  subagentById: Map<string, SubagentRun>,
  resultByCallId: Map<string, ToolResult>,
  editsByCallId: Map<string, FileEdit[]> | undefined,
  todosByCallId: Map<string, TodoTask[]> | undefined,
  onOpenSubagent: (id: string) => void,
  onOpenSession: (sessionId: string) => void,
) {
  if (isToolGroup(item)) {
    return (
      <ToolGroupRow
        key={item.key}
        group={item}
        resultByCallId={resultByCallId}
        editsByCallId={editsByCallId}
        todosByCallId={todosByCallId}
      />
    );
  }

  const run =
    item.payload.type === "tool_call_started"
      ? subagentById.get(item.payload.callId)
      : undefined;

  // An `inline` run draws its spawning tool row, which for a harness that
  // reports nothing about the child is the whole run — see `SubagentRun`.
  return run && !run.inline ? (
    <SubagentRow key={item.id} run={run} onOpen={onOpenSubagent} />
  ) : (
    <EventRow
      key={item.id}
      event={item}
      resultByCallId={resultByCallId}
      todosByCallId={todosByCallId}
      onOpenSession={onOpenSession}
    />
  );
}

/// `prompt` is always a `user_message` here — the grouping only opens a turn on
/// one — but the payload union has to be narrowed for the props to typecheck.
function userProps(turn: Turn) {
  const payload = turn.prompt?.payload;
  return payload?.type === "user_message"
    ? {
        text: payload.text,
        images: payload.images,
        issues: payload.issues,
        from: payload.from,
        cwd: payload.cwd,
      }
    : { text: "" };
}
