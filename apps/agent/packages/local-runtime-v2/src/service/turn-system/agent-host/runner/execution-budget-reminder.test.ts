import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { PiBeforeLlmCallHookInput } from '@hz/agent-core/pi-turn-runner';
import { describe, expect, it, vi } from 'vitest';

import {
  BUDGET_STOP_GRACE_REQUESTS,
  buildStopNotice,
  buildWrapUpNotice,
  createExecutionBudgetReminder,
  isBudgetedRunSource,
  requestStopAt,
  resolveSoftRequestBudget,
  SOFT_REQUEST_BUDGET,
} from './execution-budget-reminder.js';

function input(messages: AgentMessage[]): PiBeforeLlmCallHookInput {
  return {
    sessionId: 'synthetic-session',
    turnId: 'synthetic-turn',
    phase: 'iteration',
    messages,
    canonicalMessages: messages,
    thinkingLevel: 'off',
    model: {
      id: 'test',
      name: 'test',
      api: 'anthropic-messages',
      provider: 'test',
      baseUrl: 'https://example.invalid',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 1024,
    },
  };
}

const MESSAGES: AgentMessage[] = [{ role: 'user', content: 'hello', timestamp: 1 }];
const admit = () => true;

/** The hook's decision as the text it put in front of the run, or its kind. */
function decision(hook: ReturnType<typeof createExecutionBudgetReminder>): string {
  const value = hook?.(input(MESSAGES));
  if (value === undefined) return 'nothing';
  if (value.type === 'abort') return 'abort';
  if (value.type === 'replaceRequestMessages') {
    const last = value.messages.at(-1);
    return typeof last?.content === 'string' ? last.content : 'marker';
  }
  return value.type;
}

describe('the request budget a run is held to', () => {
  it('bundles a ceiling, and lets a setting lower it but never raise it', () => {
    expect(resolveSoftRequestBudget(undefined)).toBe(SOFT_REQUEST_BUDGET);
    expect(resolveSoftRequestBudget(50)).toBe(50);
    expect(resolveSoftRequestBudget(SOFT_REQUEST_BUDGET * 4)).toBe(SOFT_REQUEST_BUDGET);
  });

  it('treats zero as no ceiling at all, and a negative as zero', () => {
    // The one value that disables the guard, so it cannot be capped into looking
    // like a ceiling of zero.
    expect(resolveSoftRequestBudget(0)).toBe(0);
    expect(resolveSoftRequestBudget(-5)).toBe(0);
  });

  it('stops at 1.5x, rounded up, so a small budget still has a stop', () => {
    expect(requestStopAt(200)).toBe(300);
    expect(requestStopAt(3)).toBe(5);
    expect(requestStopAt(2)).toBe(3);
  });

  it('names the count, the ceiling and the stop that follows', () => {
    const notice = buildWrapUpNotice(200, 200);

    expect(notice).toContain('200 requests');
    expect(notice).toContain('soft budget: 200');
    // The consequence is named because it is real: the stop is the rung below.
    expect(notice).toContain('300 requests');
    expect(notice).toContain('stopped');
  });

  it('tells a stopped run to report what exists and start nothing', () => {
    const stop = buildStopNotice(3, 2);

    expect(stop).toContain('[budget stop]');
    expect(stop).toContain('Report your findings now');
    expect(stop).toContain('Do not start anything new');
  });
});

describe('which runs are held to a budget', () => {
  it('is the delegated ones', () => {
    expect(isBudgetedRunSource('task')).toBe(true);
    expect(isBudgetedRunSource('background-task')).toBe(true);
  });

  it('is not a reader working in their own session', () => {
    // Their turn is bounded by them: they can watch it going and stop it.
    expect(isBudgetedRunSource('user')).toBe(false);
    expect(isBudgetedRunSource(undefined)).toBe(false);
    expect(isBudgetedRunSource('code_review')).toBe(false);
  });
});

describe('the execution budget ladder', () => {
  /** A budget of 2 makes every rung reachable in a handful of requests. */
  const budget = 2;
  const stopAt = requestStopAt(budget);

  it('says nothing under the budget', () => {
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, admit, undefined, budget);

    expect(decision(hook)).toBe('nothing');
  });

  it('wraps up once at the budget, stops from 1.5x, and ends the run after the grace', () => {
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, admit, undefined, budget);
    const seen: string[] = [];
    for (let request = 1; request <= stopAt + BUDGET_STOP_GRACE_REQUESTS; request += 1) {
      seen.push(decision(hook));
    }

    expect(seen[0]).toBe('nothing'); // 1: under the budget
    expect(seen[1]).toContain('[budget notice]'); // 2: the budget
    for (let index = 2; index < stopAt + BUDGET_STOP_GRACE_REQUESTS - 1; index += 1) {
      expect(seen[index]).toContain('[budget stop]'); // 3..7: stopped, report now
    }
    expect(seen.at(-1)).toBe('abort'); // 8: the grace is spent
  });

  it('ends the run rather than asking a sixth time', () => {
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, admit, undefined, budget);
    for (let request = 1; request < stopAt + BUDGET_STOP_GRACE_REQUESTS; request += 1) {
      hook?.(input(MESSAGES));
    }

    expect(hook?.(input(MESSAGES))).toEqual({
      type: 'abort',
      reason: 'request-budget-exhausted',
    });
  });

  it('keeps the time note for a run that has a deadline and a budget', () => {
    // The two bounds are independent: below the budget, a deadline still speaks.
    const hook = createExecutionBudgetReminder(11_000, () => 1_000, admit, undefined, 50);

    expect(decision(hook)).toContain('10 seconds');
  });

  it('has no hook at all when there is neither a deadline nor a budget', () => {
    expect(createExecutionBudgetReminder(undefined, () => 1_000, admit, undefined, 0)).toBeUndefined();
    expect(createExecutionBudgetReminder(undefined, () => 1_000, admit)).toBeDefined();
  });

  it('keeps the marker out of the request when it cannot be admitted', () => {
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, () => false, undefined, 1);

    expect(hook?.(input(MESSAGES))).toBeUndefined();
  });

  it('says nothing into an aborted request', () => {
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, admit, undefined, 1);
    const aborted = { ...input(MESSAGES), signal: { aborted: true } } as PiBeforeLlmCallHookInput;

    expect(hook?.(aborted)).toBeUndefined();
  });

  it('logs each rung, so a stopped run is visible after the fact', () => {
    const logger = { info: vi.fn() };
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, admit, logger, budget);
    for (let request = 1; request <= stopAt + BUDGET_STOP_GRACE_REQUESTS; request += 1) {
      hook?.(input(MESSAGES));
    }

    const messages = logger.info.mock.calls.map((call) => call[1]);
    expect(messages).toContain('execution budget wrap-up notice');
    expect(messages).toContain('execution budget stop');
    expect(messages).toContain('execution budget hard stop');
  });
});
