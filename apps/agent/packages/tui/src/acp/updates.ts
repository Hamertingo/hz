import type * as acp from '@agentclientprotocol/sdk';

import {
  buildTuiMessageParts,
  type TuiMessage,
  type TuiMessagePart,
  type TuiStreamEvent,
  type TuiToolCall,
} from '../runtime/stream-events.js';
import type { TuiStructuredPreviewBlock } from '../types/runtime-models.js';
import { isTuiAcpAbsolutePath } from './paths.js';

export class TuiAcpUpdateProjector {
  private readonly toolIds = new Map<string, string>();
  private readonly completedToolIds = new Set<string>();
  private readonly streamedMessageIds = new Set<string>();
  private nextAnonymousToolId = 1;

  project(event: TuiStreamEvent): acp.SessionUpdate[] {
    if (event.type === 'message') return this.projectMessage(event.message);
    if (event.type === 'messages-replaced') {
      return event.messages.flatMap((message) => this.projectMessage(message));
    }
    if (event.type !== 'delta') return [];
    const updates: acp.SessionUpdate[] = [];
    if (event.messageId && (event.thinking || event.content)) {
      this.streamedMessageIds.add(event.messageId);
    }
    if (event.thinking) {
      updates.push({
        sessionUpdate: 'agent_thought_chunk',
        ...(event.messageId ? { messageId: event.messageId } : {}),
        content: { type: 'text', text: event.thinking },
      });
    }
    if (event.content) {
      updates.push({
        sessionUpdate: 'agent_message_chunk',
        ...(event.messageId ? { messageId: event.messageId } : {}),
        content: { type: 'text', text: event.content },
      });
    }
    for (const tool of event.toolCalls ?? []) {
      const update = this.projectTool(tool);
      if (update) updates.push(update);
    }
    return updates;
  }

  private projectMessage(
    message: Extract<TuiStreamEvent, { type: 'message' }>['message'],
  ): acp.SessionUpdate[] {
    if (message.role !== 'assistant') return [];
    if (message.id && this.streamedMessageIds.has(message.id)) return [];
    if (message.id) this.streamedMessageIds.add(message.id);
    return buildTuiMessageParts(message).flatMap((part): acp.SessionUpdate[] => {
      if (part.type === 'thinking') {
        return [
          {
            sessionUpdate: 'agent_thought_chunk',
            ...(message.id ? { messageId: message.id } : {}),
            content: { type: 'text', text: part.content },
          },
        ];
      }
      if (part.type === 'text') {
        return [
          {
            sessionUpdate: 'agent_message_chunk',
            ...(message.id ? { messageId: message.id } : {}),
            content: { type: 'text', text: part.content },
          },
        ];
      }
      const update = this.projectTool(part.toolCall);
      return update ? [update] : [];
    });
  }

  private projectTool(tool: TuiToolCall): acp.SessionUpdate | undefined {
    if (tool.id && this.completedToolIds.has(tool.id)) return undefined;
    const key = tool.id ? `id:${tool.id}` : `name:${tool.name}`;
    const existingId = this.toolIds.get(key);
    const toolCallId = existingId ?? tool.id ?? `minimax-code-tool-${this.nextAnonymousToolId++}`;
    const status = toolStatus(tool.status);
    const content = toolContent(tool);
    const locations = toolLocations(tool);
    const rawOutput = tool.output ?? (tool.error === undefined ? undefined : { error: tool.error });

    if (!existingId) {
      if (status === 'completed' || status === 'failed') {
        if (tool.id) this.completedToolIds.add(tool.id);
      } else {
        this.toolIds.set(key, toolCallId);
      }
      return compact({
        sessionUpdate: 'tool_call' as const,
        toolCallId,
        title: tool.name,
        name: tool.name,
        kind: tuiAcpToolKind(tool.name),
        status,
        rawInput: tool.input,
        rawOutput,
        content,
        locations,
      });
    }

    if (status === 'completed' || status === 'failed') {
      this.toolIds.delete(key);
      if (tool.id) this.completedToolIds.add(tool.id);
    }
    return compact({
      sessionUpdate: 'tool_call_update' as const,
      toolCallId,
      status,
      rawInput: tool.input,
      rawOutput,
      content,
      locations,
    });
  }
}

export function tuiAcpToolKind(name: string): acp.ToolKind {
  const normalized = name.toLowerCase();
  if (normalized.includes('read') || normalized.includes('view')) return 'read';
  if (normalized.includes('edit') || normalized.includes('write') || normalized.includes('patch')) {
    return 'edit';
  }
  if (normalized.includes('delete') || normalized.includes('remove')) return 'delete';
  if (normalized.includes('move') || normalized.includes('rename')) return 'move';
  if (normalized.includes('search') || normalized.includes('find') || normalized.includes('grep')) {
    return 'search';
  }
  if (normalized.includes('fetch') || normalized.includes('http') || normalized.includes('web')) {
    return 'fetch';
  }
  if (normalized.includes('think') || normalized.includes('plan')) return 'think';
  if (
    normalized.includes('shell') ||
    normalized.includes('bash') ||
    normalized.includes('terminal') ||
    normalized.includes('exec') ||
    normalized.includes('command')
  ) {
    return 'execute';
  }
  return 'other';
}

function toolStatus(status: TuiToolCall['status']): acp.ToolCallStatus | undefined {
  if (status === undefined) return undefined;
  const normalized = String(status).toLowerCase();
  if (normalized === 'pending') return 'pending';
  if (
    normalized === '1' ||
    normalized === 'started' ||
    normalized === 'running' ||
    normalized === 'in_progress'
  ) {
    return 'in_progress';
  }
  if (
    normalized === '2' ||
    normalized === 'completed' ||
    normalized === 'succeeded' ||
    normalized === 'success'
  ) {
    return 'completed';
  }
  if (normalized === '3' || normalized === 'failed' || normalized === 'error') return 'failed';
  return undefined;
}

function toolContent(tool: TuiToolCall): acp.ToolCallContent[] | undefined {
  const blocks = tool.structuredPreview?.blocks.flatMap(projectPreviewBlock) ?? [];
  return blocks.length > 0 ? blocks : undefined;
}

function projectPreviewBlock(block: TuiStructuredPreviewBlock): acp.ToolCallContent[] {
  if (block.kind === 'diff' && block.path) {
    const texts = parseUnifiedDiff(block.diff);
    return [
      compact({
        type: 'diff' as const,
        path: block.path,
        oldText: texts.oldText,
        newText: texts.newText,
      }),
    ];
  }
  if (block.kind === 'file') {
    return [
      {
        type: 'content',
        content: { type: 'text', text: block.content },
      },
    ];
  }
  if (block.kind === 'summary') {
    return [
      {
        type: 'content',
        content: { type: 'text', text: block.message },
      },
    ];
  }
  return [];
}

function toolLocations(tool: TuiToolCall): acp.ToolCallLocation[] | undefined {
  const paths = new Set<string>();
  for (const block of tool.structuredPreview?.blocks ?? []) {
    if (block.path && isTuiAcpAbsolutePath(block.path)) paths.add(block.path);
  }
  for (const inputPath of readInputPaths(tool.input)) {
    if (isTuiAcpAbsolutePath(inputPath)) paths.add(inputPath);
  }
  return paths.size > 0 ? [...paths].map((path) => ({ path })) : undefined;
}

function readInputPaths(input: unknown): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const record = input as Record<string, unknown>;
  return ['path', 'filePath', 'file_path'].flatMap((key) =>
    typeof record[key] === 'string' ? [record[key]] : [],
  );
}

function parseUnifiedDiff(diff: string): { oldText?: string; newText: string } {
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@') || line.startsWith('--- ') || line.startsWith('+++ ')) continue;
    if (line.startsWith('-')) oldLines.push(line.slice(1));
    else if (line.startsWith('+')) newLines.push(line.slice(1));
    else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      oldLines.push(content);
      newLines.push(content);
    }
  }
  return {
    ...(oldLines.length > 0 ? { oldText: oldLines.join('\n') } : {}),
    newText: newLines.join('\n'),
  };
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/// One turn of a delegated child's session, in the vocabulary a client draws.
///
/// **The same projection `session/load` replays with, and that is the whole
/// point.** What a client gets here are the shapes it already renders the parent's
/// transcript from — a tool call carrying its `kind` and its raw arguments, the
/// assistant's text, the prompt that opened the turn — so a subagent can be drawn
/// by the code that draws the conversation rather than by a second renderer
/// written for it, which could say no more than "a tool ran".
export interface TuiAcpDelegationTurn {
  readonly id: string;
  /// `running` for a turn nothing has closed — the newest one of a child that is
  /// still working, which is exactly the turn a reader is watching.
  readonly status: 'running' | 'completed' | 'failed';
  /// The turn's own first user message, which for a delegated child is the brief
  /// its parent handed it. Carried apart from the updates so a client can open the
  /// turn with it without parsing one out of the stream.
  readonly prompt: string;
  /// When the turn's own first message was written, epoch milliseconds — so a
  /// client can time the turn from the child's clock rather than from the moment
  /// it happened to read the page.
  at?: number;
  /// When the message that closed it was written. Absent for a turn still running.
  endedAt?: number;
  readonly updates: acp.SessionUpdate[];
}

/// A child's messages, cut into turns and projected onto ACP.
///
/// **A batch, not a stream**, so one thing has to be said twice: a live stream
/// sends a `tool_call` and then the `tool_call_update` that closes it, and a
/// client draws on the update. A batch has no second line to follow, so a call
/// that is already over gets its closing update emitted right behind it, or it
/// would arrive as an announcement nothing ever finished.
export function projectDelegationTurns(
  messages: readonly TuiMessage[],
): TuiAcpDelegationTurn[] {
  const projector = new TuiAcpUpdateProjector();
  const turns: TuiAcpDelegationTurn[] = [];
  let current: {
    id: string;
    status: 'running' | 'completed' | 'failed';
    prompt: string;
    at?: number;
    endedAt?: number;
    updates: acp.SessionUpdate[];
  } | null = null;

  for (const message of messages) {
    // A message the runtime filed under no turn still has to land somewhere: a
    // dropped row is worse than an anonymous one, and a child's earlier messages
    // are written before the turn they belong to is known.
    const id = message.turnId ?? '';
    if (!current || current.id !== id) {
      current = { id, status: 'running', prompt: '', updates: [] };
      turns.push(current);
    }

    // The clock is the child's own, taken off the messages themselves — a read
    // happens whenever a client asks, and timing the turn from the read would
    // report every child as having taken no time at all.
    if (typeof message.timestamp === 'number') {
      current.at ??= message.timestamp;
      current.endedAt = message.timestamp;
    }

    if (message.role === 'user') {
      const text = messageText(message);
      if (!current.prompt) current.prompt = text;
      if (text) {
        current.updates.push({
          sessionUpdate: 'user_message_chunk',
          ...(message.id ? { messageId: message.id } : {}),
          content: { type: 'text', text },
        });
      }
      continue;
    }

    for (const update of projector.project({ type: 'message', message })) {
      current.updates.push(update);
      if (
        update.sessionUpdate === 'tool_call' &&
        (update.status === 'completed' || update.status === 'failed')
      ) {
        current.updates.push({
          sessionUpdate: 'tool_call_update',
          toolCallId: update.toolCallId,
          status: update.status,
          ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
        });
      }
    }

    if (turnEndedBy(message.finishReason)) {
      current.status = message.finishReason === 'stop' ? 'completed' : 'failed';
    }
  }

  return turns;
}

/// Whether a message's finish reason means the turn is over.
///
/// **`toolUse` is not an ending.** It is the model saying "I have asked for a
/// tool", and the turn carries on with the answer behind it — so a reader that
/// treated it as an ending closed the turn on the tool call and showed a run that
/// stopped mid-thought. Every reason this build does not recognise reads as *not
/// an ending* too, which is the safe direction: an open turn is drawn as live,
/// where a wrongly closed one loses whatever the child says next.
function turnEndedBy(reason: string | undefined): boolean {
  return (
    reason === 'stop' ||
    reason === 'error' ||
    reason === 'failed' ||
    reason === 'aborted' ||
    reason === 'canceled' ||
    reason === 'cancelled'
  );
}

/// A message's own prose, however this build happens to have filed it.
function messageText(message: TuiMessage): string {
  if (message.content?.trim()) return message.content;
  return buildTuiMessageParts(message)
    .filter((part): part is Extract<TuiMessagePart, { type: 'text' }> => part.type === 'text')
    .map((part) => part.content)
    .join('');
}
