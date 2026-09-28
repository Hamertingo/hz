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

/**
 * What a run is told when it crosses its budget.
 *
 * **It names the count and the ceiling, and says what to do**, because the whole
 * value of the notice is that the run can act on it. Measured on the time reminder
 * beside this one, a run that is told its budget *adapts*: with 20 seconds left and a
 * 40-second build, the run dispatched the build to the background rather than
 * blocking on it.
 *
 * It deliberately does **not** name a forced stop yet. The design this follows
 * promises one at 1.5×, and a notice that promises a consequence the runtime does not
 * deliver teaches the agent that these statements are decoration — so the sentence
 * arrives with the stop that makes it true, not before it.
 */
export function buildWrapUpNotice(requests: number, budget: number): string {
  return (
    `[budget notice] You have used ${requests} requests in this run (soft budget: ${budget}). ` +
    `Wrap up now: finish the current step and report your findings, because that report ` +
    `is what the agent that delegated this work receives.`
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
 * Two rungs, one marker each: crossing the budget replaces the time note with the
 * wrap-up notice, **once**, and every other request keeps the time note it always
 * had. The forced stop at 1.5× is not here yet — it belongs to whatever can end a
 * Turn, and until it lands the notice is the whole of the guard.
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
      if (softRequestBudget > 0 && requests >= softRequestBudget && !wrapUpSent) {
        wrapUpSent = true;
        const notice = buildWrapUpNotice(requests, softRequestBudget);
        try {
          logger?.info?.(
            {
              session_id: input.sessionId,
              turn_id: input.turnId,
              sampled_at_ms: now,
              requests,
              soft_request_budget: softRequestBudget,
            },
            'execution budget wrap-up notice',
          );
        } catch {
          // Diagnostics must not affect the request context.
        }
        // Undefined only where the notice could not be admitted; the time note is
        // not a substitute for it, so the request goes out without either.
        return append(input, now, notice);
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
      try {
        logger?.info?.(
          {
            session_id: input.sessionId,
            turn_id: input.turnId,
            sampled_at_ms: now,
            remaining_ms: remainingMs,
            elapsed_since_previous_request_ms: elapsedMs ?? null,
          },
          'execution budget context sampled',
        );
      } catch {
        // Diagnostics must not affect the request context.
      }
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
