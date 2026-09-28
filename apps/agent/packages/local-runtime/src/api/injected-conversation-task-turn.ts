import type {
  ConversationAcceptedTurn,
  ConversationSession,
  ConversationSource,
  ConversationTurnResult,
  RuntimeConversation,
} from '@hz/conversation-contract';
import {
  parseModelVerdict,
  type LocalTaskRunResult,
  type VerificationReport,
} from '@hz/agent-tools/desktop';

export async function runInjectedConversationTaskTurn(input: {
  conversation: Pick<RuntimeConversation, 'ingress'>;
  childSession: Pick<ConversationSession, 'sessionId'>;
  turnId: string;
  prompt: string;
  source: Extract<ConversationSource, 'task' | 'background-task'>;
  /**
   * Opaque submitter-owned provenance forwarded verbatim into
   * `sourceContext.origin`. The host reads it to classify the child Turn (the
   * Goal verifier child is the only current reader); nothing here grants the
   * child any capability it would not otherwise have.
   */
  origin?: unknown;
  requestedAgentName?: string;
  resolvedAgentName?: string;
  agentRole?: 'verifier';
  onFinish?: (result: LocalTaskRunResult) => void;
  signal?: AbortSignal;
}): Promise<LocalTaskRunResult> {
  const taskIdentity = {
    requestedAgentName: input.requestedAgentName ?? input.resolvedAgentName ?? 'unknown',
    ...(input.resolvedAgentName ? { resolvedAgentName: input.resolvedAgentName } : {}),
    subSessionId: input.childSession.sessionId,
  } as const;
  let finishNotified = false;
  const notifyFinish = (result: LocalTaskRunResult): void => {
    if (finishNotified) return;
    finishNotified = true;
    try {
      input.onFinish?.(result);
    } catch {
      // Observability callbacks are best-effort and must never alter the task result.
    }
  };
  const makeResult = (
    result: Omit<LocalTaskRunResult, keyof typeof taskIdentity>,
  ): LocalTaskRunResult => ({ ...taskIdentity, ...result });

  if (input.signal?.aborted) {
    const result = makeResult({
      status: 'aborted',
      subTurnId: input.turnId,
      errorMessage: 'Operation aborted',
    });
    notifyFinish(result);
    return result;
  }
  let acceptedTurnId = input.turnId;
  const clientRequestId = taskClientRequestId(input.turnId);
  try {
    const accepted = await input.conversation.ingress.submit({
      sessionId: input.childSession.sessionId,
      source: input.source,
      allowQueue: true,
      requestedTurnId: input.turnId,
      clientRequestId,
      message: {
        content: input.prompt,
        attachments: [],
        ...(input.origin === undefined ? {} : { origin: input.origin }),
      },
    });
    acceptedTurnId = accepted.turnId;
    const result = await awaitTaskCompletion(input, accepted, clientRequestId);
    let finalText = assistantReport(result);
    if (result.status === 'completed' && !finalText) {
      finalText = (await askForReport(input)) ?? '';
    }
    const verification = buildConversationVerification({
      agentRole: input.agentRole,
      finalText,
      result,
    });
    const taskResult = makeResult({
      status:
        result.status === 'completed'
          ? 'succeeded'
          : result.status === 'aborted'
            ? 'aborted'
            : 'failed',
      subTurnId: accepted.turnId,
      // Only a turn that *finished* has an exit to state. A failed or aborted run
      // says why in its status, and calling it `silent` would name a contract it
      // never had the chance to keep.
      ...(result.status === 'completed'
        ? { exit: finalText ? ('reported' as const) : ('silent' as const) }
        : {}),
      ...(finalText ? { finalText } : {}),
      ...(verification ? { verification } : {}),
      ...(result.status === 'completed'
        ? {}
        : { errorMessage: result.error ?? `Conversation turn ${result.status}` }),
    });
    notifyFinish(taskResult);
    return taskResult;
  } catch (error) {
    notifyFinish(
      makeResult({
        status: 'failed',
        subTurnId: acceptedTurnId,
        errorMessage: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}

function buildConversationVerification(input: {
  agentRole?: string;
  finalText: string;
  result: ConversationTurnResult;
}): VerificationReport | undefined {
  if (input.agentRole !== 'verifier') return undefined;
  const observation = input.result.committedFacts?.fileChangeObservation;
  return {
    ...(input.result.status === 'completed'
      ? (() => {
          const modelVerdict = parseModelVerdict(input.finalText);
          return modelVerdict ? { modelVerdict } : {};
        })()
      : {}),
    fileChange: observation?.fileChange ?? 'recording_failed',
    ...(observation?.changedFiles ? { changedFiles: [...observation.changedFiles] } : {}),
    observationNotes: observation?.observationNotes
      ? [...observation.observationNotes]
      : ['local_turn_diff_not_started'],
  };
}

/** The id a child Turn is submitted under, so a cancel can find its queue entry. */
function taskClientRequestId(turnId: string): string {
  return `task-turn:${turnId}`;
}

/** What a finished child published, as the parent reads it. */
function assistantReport(result: ConversationTurnResult): string {
  return result.messages
    .filter((message) => message.role === 'assistant' && message.text)
    .map((message) => message.text)
    .join('\n')
    .trim();
}

/**
 * What a child that finished without a report is asked for.
 *
 * It names the artefact, and refuses the two ways a model answers this without
 * producing one: an acknowledgement that it will write the report, and a summary of
 * what it did rather than of what it found.
 */
const REPORT_REMINDER =
  'Your run ended without a report, so the agent that delegated this work has nothing to read. ' +
  'Publish your findings now: what you found, and — where your role requires one — the verdict line. ' +
  'Answer with the report itself, not with an acknowledgement and not with a promise to write one.';

/**
 * Asks a child that ended without a report for one, **once**.
 *
 * One more Turn in the **same** conversation, which is what makes it cheap: the whole
 * of the run is still in that child's context, so the reminder costs a Turn where a
 * fresh spawn costs the run again. **Once, never a loop** — a child that has just
 * proved it will not answer is not made to answer by being asked twice, and every ask
 * is a model Turn.
 *
 * Best-effort on purpose: a failure here leaves the run as it was. Reported silence is
 * still a result, and losing a completed run to a failed recovery would be a worse
 * answer than the silence it set out to fix.
 */
async function askForReport(
  input: Parameters<typeof runInjectedConversationTaskTurn>[0],
): Promise<string | undefined> {
  const clientRequestId = `${taskClientRequestId(input.turnId)}:report`;
  try {
    const accepted = await input.conversation.ingress.submit({
      sessionId: input.childSession.sessionId,
      source: input.source,
      allowQueue: true,
      requestedTurnId: `${input.turnId}:report`,
      clientRequestId,
      message: { content: REPORT_REMINDER, attachments: [] },
    });
    const result = await awaitTaskCompletion(input, accepted, clientRequestId);
    // A reminder that did not finish offers no report; the caller keeps the silence
    // it already had rather than half a Turn's text.
    return result.status === 'completed' ? assistantReport(result) : undefined;
  } catch {
    return undefined;
  }
}

/** Covers cancellation both during admission and while queued/running. */
async function awaitTaskCompletion(
  input: Parameters<typeof runInjectedConversationTaskTurn>[0],
  accepted: ConversationAcceptedTurn,
  clientRequestId: string,
): Promise<ConversationTurnResult> {
  const { signal } = input;
  if (!signal) return accepted.completion;
  let abortOperation: Promise<void> | undefined;
  let rejectAbort!: (error: unknown) => void;
  const abortFailure = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => {
    if (abortOperation) return;
    abortOperation = cancelAcceptedTask(input, accepted.turnId, clientRequestId);
    void abortOperation.catch(rejectAbort);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  // AbortSignal does not replay an event emitted while submit() was pending.
  if (signal.aborted) onAbort();
  let outcome:
    | { readonly succeeded: true; readonly result: ConversationTurnResult }
    | { readonly succeeded: false; readonly error: unknown };
  try {
    outcome = { succeeded: true, result: await Promise.race([accepted.completion, abortFailure]) };
  } catch (error) {
    outcome = { succeeded: false, error };
  } finally {
    // Stop listening before waiting for existing cancellations, preventing undrained work after the completion boundary.
    signal.removeEventListener('abort', onAbort);
  }
  try {
    await abortOperation;
  } catch (error) {
    if (!outcome.succeeded && error !== outcome.error) {
      throw new AggregateError([outcome.error, error], 'Task completion and cancellation failed');
    }
    throw error;
  }
  if (!outcome.succeeded) throw outcome.error;
  return outcome.result;
}

async function cancelAcceptedTask(
  input: Parameters<typeof runInjectedConversationTaskTurn>[0],
  turnId: string,
  clientRequestId: string,
): Promise<void> {
  const { ingress } = input.conversation;
  const sessionId = input.childSession.sessionId;
  const failures: unknown[] = [];
  try {
    const queued = await ingress.findQueuedByClientRequestId(sessionId, clientRequestId);
    if (queued) await ingress.cancelQueued(sessionId, queued.itemId);
  } catch (error) {
    failures.push(error);
  }
  // Queue-storage failure must not skip the precise abort: a claimed child Turn may still be executing.
  try {
    await ingress.abort(sessionId, 'lifecycle', turnId);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Task queue cancellation and exact Turn abort failed');
  }
}
