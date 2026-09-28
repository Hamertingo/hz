import type { PiBeforeLlmCallHook, PiTurnRunnerLogger } from '@hz/agent-core/pi-turn-runner';
import type { ExecutionBudgetReminderAdmission } from '../execution/contracts.js';

/**
 * The bundled ceiling on how many model requests one child run may make.
 *
 * A run's requests are the honest unit for this: a step that spends ten tool calls
 * and one that spends a hundred cost the same single request, and the thing worth
 * bounding is the loop, not the wall clock — a child waiting on a slow build has
 * made no progress *and* burned no requests.
 */
export const SOFT_REQUEST_BUDGET = 200;

/**
 * What the run is actually held to: the configured number, capped by the bundled
 * ceiling, so a setting can tighten an agent's budget and never loosen it.
 *
 * `0` means **no ceiling** rather than a ceiling of zero — the one value that
 * disables the guard — which is why it is checked before the cap rather than after.
 */
export function resolveSoftRequestBudget(configured: number | undefined): number {
  if (configured === undefined) return SOFT_REQUEST_BUDGET;
  const normalized = Math.max(0, Math.trunc(configured));
  return normalized === 0 ? 0 : Math.min(normalized, SOFT_REQUEST_BUDGET);
}

/** The request at which a run that has not wrapped up is stopped. */
export function requestStopAt(budget: number): number {
  return Math.ceil(budget * 1.5);
}

/**
 * How many requests a stopped run gets to put its findings into words before the
 * Turn is ended for it.
 *
 * Five, taken from the design this follows, and enough for one reply plus the tool
 * call a model often reaches for first. A run that spends them starting new work
 * rather than reporting is not going to report.
 */
export const BUDGET_STOP_GRACE_REQUESTS = 5;

/**
 * What a run is told when it crosses its budget.
 *
 * **It names the count, the ceiling, and the consequence**, because the whole value
 * of the notice is that the run can act on it. Measured on the time reminder beside
 * this one, a run that is told its budget *adapts*: with 20 seconds left and a
 * 40-second build, the run dispatched the build to the background rather than
 * blocking on it. The consequence is named because it is real — see
 * {@link buildStopNotice} for what arrives when the deadline for it passes.
 */
export function buildWrapUpNotice(requests: number, budget: number): string {
  return (
    `[budget notice] You have used ${requests} requests in this run (soft budget: ${budget}). ` +
    `Wrap up now: finish the current step and report your findings. ` +
    `At ${requestStopAt(budget)} requests the run is stopped and you will be asked for whatever you have.`
  );
}

/**
 * What a stopped run is told, on every request it is still allowed.
 *
 * A stop is not a question — the run is past arguing about how much time it has — so
 * this says one thing: report what exists, in one message, and start nothing. It
 * repeats rather than being said once, because a run that ignores it has to keep
 * being told; the count of those repetitions is {@link BUDGET_STOP_GRACE_REQUESTS}.
 */
export function buildStopNotice(requests: number, budget: number): string {
  return (
    `[budget stop] This run has used ${requests} requests (soft budget: ${budget}) and is being stopped. ` +
    `Report your findings now, in one message, from what you already have. Do not start anything new.`
  );
}

/** No ceiling at all — the value [`resolveSoftRequestBudget`] reads as "guard off". */
export const NO_REQUEST_BUDGET = 0;

/**
 * Whether a Turn's source is one the request budget is for.
 *
 * **The budget is for runs working on somebody else's behalf.** A reader's own turn
 * is bounded by the reader, who can watch it going and stop it; a delegated run is
 * something they are waiting on without being able to see it, which is the case a
 * ceiling exists for. The Goal's verifier arrives under `task`, so it is covered.
 */
export function isBudgetedRunSource(source: string | undefined): boolean {
  return source === 'task' || source === 'background-task';
}

/**
 * Request-only context; the caller's existing cancellation timer remains
 * authoritative. `replaceRequestMessages` keeps the marker out of durable
 * history, so it must be registered before any hook that returns
 * `appendMessage` — `runBeforeLLM` ends the pipeline on a successful append.
 *
 * **The hook is called once per model request, so it counts them itself** rather
 * than subscribing to the executor's diagnostics: the count it needs is the count
 * of its own invocations, and a second source for it could disagree with this one.
 *
 * Three rungs, and each one is a decision the request pipeline already understands:
 * a marker at the budget, a marker that says the run is stopped from 1.5×, and an
 * **abort** after the grace. Ending the Turn rather than asking again is what makes
 * the stop real — and what the run managed to say before it is what the parent
 * receives, because a Turn that ends still carries the messages it committed.
 */
export function createExecutionBudgetReminder(
  executionDeadlineAtMs: number | undefined,
  nowMs: () => number = Date.now,
  canAppend?: ExecutionBudgetReminderAdmission,
  logger?: Pick<PiTurnRunnerLogger, 'info'>,
  configuredSoftRequestBudget?: number,
): PiBeforeLlmCallHook | undefined {
  const softRequestBudget = resolveSoftRequestBudget(configuredSoftRequestBudget);
  // A child has a budget and no deadline, which is the ordinary case: the hook
  // exists for either bound, not only for the timer.
  if (executionDeadlineAtMs === undefined && softRequestBudget <= 0) return undefined;
  if (!canAppend) return undefined;
  let previousSampleAtMs: number | undefined;
  let requests = 0;
  let wrapUpSent = false;
  let stopLogged = false;
  const note = (input: Parameters<PiBeforeLlmCallHook>[0], fields: Record<string, unknown>, message: string) => {
    try {
      logger?.info?.({ session_id: input.sessionId, turn_id: input.turnId, ...fields }, message);
    } catch {
      // Diagnostics must not affect the request context.
    }
  };
  const append = (
    input: Parameters<PiBeforeLlmCallHook>[0],
    now: number,
    content: string,
  ): ReturnType<PiBeforeLlmCallHook> => {
    const marker = {
      role: 'user' as const,
      content: `<system-reminder>${content}</system-reminder>`,
      timestamp: now,
    };
    if (!canAppend(input, marker)) return undefined;
    return {
      type: 'replaceRequestMessages',
      reason: 'execution-budget-context',
      messages: [...input.messages, marker],
    };
  };
  return (input) => {
    try {
      if (input.signal?.aborted) return undefined;
      const now = nowMs();
      requests += 1;
      if (softRequestBudget > 0) {
        const stopAt = requestStopAt(softRequestBudget);
        if (requests >= stopAt + BUDGET_STOP_GRACE_REQUESTS) {
          note(
            input,
            { requests, soft_request_budget: softRequestBudget },
            'execution budget hard stop',
          );
          // The one decision that ends a Turn. Whatever the run committed is still
          // its result, which is the point: a stopped run reports what it found even
          // when it refused to be told to.
          return { type: 'abort', reason: 'request-budget-exhausted' };
        }
        if (requests >= stopAt) {
          if (!stopLogged) {
            stopLogged = true;
            note(
              input,
              { requests, soft_request_budget: softRequestBudget, stop_at: stopAt },
              'execution budget stop',
            );
          }
          return append(input, now, buildStopNotice(requests, softRequestBudget));
        }
        if (requests >= softRequestBudget && !wrapUpSent) {
          wrapUpSent = true;
          note(
            input,
            { requests, soft_request_budget: softRequestBudget },
            'execution budget wrap-up notice',
          );
          return append(input, now, buildWrapUpNotice(requests, softRequestBudget));
        }
      }
      if (executionDeadlineAtMs === undefined) return undefined;
      const remainingMs = executionDeadlineAtMs - now;
      if (remainingMs <= 0) return undefined;
      const elapsedMs =
        previousSampleAtMs !== undefined && now >= previousSampleAtMs
          ? now - previousSampleAtMs
          : undefined;
      previousSampleAtMs = now;
      const elapsed =
        elapsedMs !== undefined
          ? ` Since the previous model request was prepared: ${Math.floor(elapsedMs / 1_000)} seconds (model generation, tools, and waiting).`
          : ' This budget includes model generation, tools, and waiting.';
      note(
        input,
        {
          sampled_at_ms: now,
          remaining_ms: remainingMs,
          elapsed_since_previous_request_ms: elapsedMs ?? null,
        },
        'execution budget context sampled',
      );
      return append(
        input,
        now,
        `Execution time remaining at request preparation: ${Math.ceil(remainingMs / 1_000)} seconds.${elapsed}`,
      );
    } catch {
      return undefined;
    }
  };
}
