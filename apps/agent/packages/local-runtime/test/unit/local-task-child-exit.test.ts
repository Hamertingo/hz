import type {
  ConversationAcceptedTurn,
  ConversationIngress,
  ConversationSubmitInput,
  ConversationTurnResult,
} from '@hz/conversation-contract';
import { SILENT_EXIT_NOTICE } from '@hz/agent-tools/desktop';
import { describe, expect, it } from 'vitest';

import { runInjectedConversationTaskTurn } from '../../src/api/injected-conversation-task-turn.js';
import { toTerminalProjection } from '../../src/background-task/terminal.js';

const CHILD = 'mvs_child';

function completed(
  turnId: string,
  messages: readonly { role: string; text?: string }[],
): ConversationTurnResult {
  return { turnId, status: 'completed', messages };
}

/** One scripted `submit`: a Turn that finishes, or an admission that is refused. */
type ScriptedTurn = ConversationTurnResult | { readonly rejects: string };

interface SubmittedTurn {
  readonly sessionId: string;
  readonly clientRequestId?: string;
  readonly requestedTurnId?: string;
  readonly content: string;
}

/**
 * A conversation whose child Turns are scripted, one per `submit`.
 *
 * Every method the ingress declares that this path must not reach throws, so a
 * change that starts calling one fails here rather than quietly doing nothing — and
 * a `submit` past the end of the script is a failure too, which is how the bound on
 * reminders is asserted instead of described.
 */
function scriptedChild(turns: readonly ScriptedTurn[]) {
  const submitted: SubmittedTurn[] = [];
  let next = 0;

  const unused = (name: string) => (): Promise<never> => {
    throw new Error(`the exit contract must not reach ingress.${name}`);
  };

  const ingress: ConversationIngress = {
    submit: async (input: ConversationSubmitInput): Promise<ConversationAcceptedTurn> => {
      submitted.push({
        sessionId: input.sessionId,
        ...(input.clientRequestId === undefined ? {} : { clientRequestId: input.clientRequestId }),
        ...(input.requestedTurnId === undefined
          ? {}
          : { requestedTurnId: input.requestedTurnId }),
        content: input.message.content,
      });
      const scripted = turns[next];
      next += 1;
      if (!scripted) {
        throw new Error(`submitted ${next} times, and the script allows ${turns.length}`);
      }
      if ('rejects' in scripted) throw new Error(scripted.rejects);
      return { turnId: scripted.turnId, mode: 'started', completion: Promise.resolve(scripted) };
    },
    resumeUserInput: unused('resumeUserInput'),
    steer: unused('steer'),
    listQueued: unused('listQueued'),
    findQueuedByClientRequestId: unused('findQueuedByClientRequestId'),
    updateQueued: unused('updateQueued'),
    promoteQueuedSource: unused('promoteQueuedSource'),
    cancelQueued: unused('cancelQueued'),
    reorderQueued: unused('reorderQueued'),
    abort: unused('abort'),
    dispatchQueue: unused('dispatchQueue'),
  };

  return { conversation: { ingress }, submitted };
}

function run(conversation: { ingress: ConversationIngress }) {
  return runInjectedConversationTaskTurn({
    conversation,
    childSession: { sessionId: CHILD },
    turnId: 'turn_1',
    prompt: 'count the directories',
    source: 'task',
    requestedAgentName: 'explore',
  });
}

describe('a task child ends through a contract', () => {
  it('reports a child that published something, and asks for nothing more', async () => {
    const { conversation, submitted } = scriptedChild([
      completed('turn_1', [{ role: 'assistant', text: '  eight directories  ' }]),
    ]);

    const result = await run(conversation);

    expect(result.exit).toBe('reported');
    expect(result.finalText).toBe('eight directories');
    expect(result.status).toBe('succeeded');
    expect(submitted).toHaveLength(1);
  });

  it('asks a silent child once, in its own conversation, and takes that report', async () => {
    const { conversation, submitted } = scriptedChild([
      completed('turn_1', [{ role: 'assistant', text: '   ' }]),
      completed('turn_1:report', [{ role: 'assistant', text: 'eight' }]),
    ]);

    const result = await run(conversation);

    expect(result.exit).toBe('reported');
    expect(result.finalText).toBe('eight');
    // The reminder is a Turn in the child the run already used, which is the whole
    // reason it is cheaper than delegating the work again.
    expect(submitted).toHaveLength(2);
    expect(submitted[1]?.sessionId).toBe(CHILD);
    expect(submitted[1]?.clientRequestId).toBe('task-turn:turn_1:report');
    expect(submitted[1]?.content).toMatch(/without a report/u);
  });

  it('says silent, and stops asking, when the reminder is silent too', async () => {
    const { conversation, submitted } = scriptedChild([
      completed('turn_1', []),
      completed('turn_1:report', [{ role: 'assistant', text: '' }]),
    ]);

    const result = await run(conversation);

    expect(result.exit).toBe('silent');
    expect(result.finalText).toBeUndefined();
    expect(result.status).toBe('succeeded');
    expect(submitted).toHaveLength(2);
  });

  it('keeps a completed run completed when the reminder cannot be admitted', async () => {
    const { conversation, submitted } = scriptedChild([
      completed('turn_1', []),
      { rejects: 'the child is gone' },
    ]);

    const result = await run(conversation);

    // Reported silence is still a result. Losing a run the child did finish to a
    // failed recovery would be a worse answer than the silence being fixed.
    expect(result.status).toBe('succeeded');
    expect(result.exit).toBe('silent');
    expect(result.errorMessage).toBeUndefined();
    expect(submitted).toHaveLength(2);
  });

  it('states no exit for a child that failed, and does not ask it for a report', async () => {
    const { conversation, submitted } = scriptedChild([
      { turnId: 'turn_1', status: 'failed', messages: [], error: 'the model refused' },
    ]);

    const result = await run(conversation);

    expect(result.status).toBe('failed');
    expect(result.exit).toBeUndefined();
    expect(result.errorMessage).toBe('the model refused');
    expect(submitted).toHaveLength(1);
  });

  it('states no exit for an aborted child, and does not ask it to keep working', async () => {
    const { conversation, submitted } = scriptedChild([
      { turnId: 'turn_1', status: 'aborted', messages: [] },
    ]);

    const result = await run(conversation);

    expect(result.status).toBe('aborted');
    expect(result.exit).toBeUndefined();
    expect(submitted).toHaveLength(1);
  });
});

describe('a background child writes its exit down where its owner will read it', () => {
  it('carries the report, and says nothing extra, for a child that published one', () => {
    const projection = toTerminalProjection({
      status: 'succeeded',
      requestedAgentName: 'worker',
      exit: 'reported',
      finalText: 'eight directories',
    });

    expect(projection.status).toBe('succeeded');
    expect(projection.outputText).toBe('eight directories');
    expect(projection.summary).toBe('eight directories');
  });

  it('carries the notice for a child that published nothing', () => {
    // The owner reads this through task_output, where an empty result under
    // `succeeded` is the same indistinguishability the foreground report exists to
    // remove — so the exit has to be written down here too.
    const projection = toTerminalProjection({
      status: 'succeeded',
      requestedAgentName: 'worker',
      exit: 'silent',
    });

    expect(projection.status).toBe('succeeded');
    expect(projection.outputText).toContain(SILENT_EXIT_NOTICE);
  });

  it('does not call a failed child silent', () => {
    const projection = toTerminalProjection({
      status: 'failed',
      requestedAgentName: 'worker',
      errorMessage: 'the model refused',
    });

    expect(projection.status).toBe('failed');
    expect(projection.outputText).toContain('the model refused');
    expect(projection.outputText).not.toContain(SILENT_EXIT_NOTICE);
  });
});
