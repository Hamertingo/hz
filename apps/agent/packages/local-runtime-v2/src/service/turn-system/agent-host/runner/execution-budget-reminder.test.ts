import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { PiBeforeLlmCallHookInput } from '@hz/agent-core/pi-turn-runner';
import { describe, expect, it, vi } from 'vitest';

import {
  buildWrapUpNotice,
  createExecutionBudgetReminder,
  isBudgetedRunSource,
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

  it('names the count and the ceiling, and promises nothing it cannot keep', () => {
    const notice = buildWrapUpNotice(200, 200);

    expect(notice).toContain('200 requests');
    expect(notice).toContain('soft budget: 200');
    // The design this follows promises a forced stop at 1.5x. The runtime does not
    // stop a run yet, so the notice must not say it does: a prompt that names a
    // consequence the runtime does not deliver teaches the agent that these
    // statements are decoration.
    expect(notice).not.toContain('300');
    expect(notice).not.toMatch(/stopped|force-stop/u);
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

describe('the execution budget reminder', () => {
  it('counts one request per invocation and wraps up at the budget', () => {
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, admit, undefined, 3);
    expect(hook).toBeDefined();

    expect(hook?.(input(MESSAGES))).toBeUndefined();
    expect(hook?.(input(MESSAGES))).toBeUndefined();

    const third = hook?.(input(MESSAGES));
    expect(third).toMatchObject({
      type: 'replaceRequestMessages',
      reason: 'execution-budget-context',
      messages: [MESSAGES[0], { role: 'user', content: expect.stringContaining('[budget notice]') }],
    });
  });

  it('says it once, and never asks a run to wrap up twice', () => {
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, admit, undefined, 2);

    expect(hook?.(input(MESSAGES))).toBeUndefined();
    expect(hook?.(input(MESSAGES))).toBeDefined();
    expect(hook?.(input(MESSAGES))).toBeUndefined();
    expect(hook?.(input(MESSAGES))).toBeUndefined();
  });

  it('leaves a run under its budget alone', () => {
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, admit, undefined, 200);

    for (let request = 0; request < 199; request += 1) {
      expect(hook?.(input(MESSAGES))).toBeUndefined();
    }
  });

  it('keeps the time note for a run that has a deadline and a budget', () => {
    // The two bounds are independent: below the budget, a deadline still speaks.
    const hook = createExecutionBudgetReminder(11_000, () => 1_000, admit, undefined, 50);

    expect(hook?.(input(MESSAGES))).toMatchObject({
      messages: [MESSAGES[0], { content: expect.stringContaining('10 seconds') }],
    });
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

  it('logs the wrap-up rather than swallowing it', () => {
    const logger = { info: vi.fn() };
    const hook = createExecutionBudgetReminder(undefined, () => 1_000, admit, logger, 1);

    hook?.(input(MESSAGES));

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ requests: 1, soft_request_budget: 1 }),
      'execution budget wrap-up notice',
    );
  });
});
