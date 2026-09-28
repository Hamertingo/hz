import { describe, expect, it } from 'vitest';

import { createExecResult, isExecResult } from '../../src/headless/contract.js';

const PROGRESS = {
  modelSteps: 3,
  toolCalls: 4,
  lastActivityAt: 1_790_000_000_000,
  droppedOperations: 0,
  unfinishedOperations: [
    { operationId: 'call_1', kind: 'tool', startedAtMs: 1_790_000_000_000, elapsedMs: 921 },
  ],
} as const;

describe('mcode exec result contract', () => {
  it('emits the single schemaVersion=1 contract with parsed structured output', () => {
    const result = createExecResult(
      {
        sessionId: 'session-1',
        turnId: 'turn-1',
        status: 'succeeded',
        answer: '{"findings":[]}',
        usage: { inputTokens: 10, outputTokens: 2 },
        durationMs: 25,
      },
      {
        runId: 'run-1',
        outputSchema: {
          type: 'object',
          properties: { findings: { type: 'array' } },
          required: ['findings'],
        },
        model: {
          providerId: 'custom_provider:review',
          modelId: 'gpt',
          protocol: 'openai-responses',
          structuredOutputMode: 'native_strict',
        },
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      },
    );

    expect(result).toEqual({
      schemaVersion: 1,
      type: 'exec.result',
      runId: 'run-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'succeeded',
      output: { findings: [] },
      model: {
        providerId: 'custom_provider:review',
        modelId: 'gpt',
        protocol: 'openai-responses',
        structuredOutputMode: 'native_strict',
      },
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      durationMs: 25,
    });
    expect(isExecResult(result)).toBe(true);
  });

  it('fails closed when a Provider claims success with invalid structured output', () => {
    expect(
      createExecResult(
        {
          sessionId: 'session-1',
          turnId: 'turn-1',
          status: 'succeeded',
          answer: 'not json',
          durationMs: 25,
        },
        { runId: 'run-1', outputSchema: { type: 'object' } },
      ),
    ).toMatchObject({
      status: 'failed',
      error: { code: 'STRUCTURED_OUTPUT_INVALID' },
    });
  });

  it('validates parsed output against the requested schema', () => {
    expect(
      createExecResult(
        {
          sessionId: 'session-1',
          turnId: 'turn-1',
          status: 'succeeded',
          answer: '{"findings":"none"}',
          durationMs: 25,
        },
        {
          runId: 'run-1',
          outputSchema: {
            type: 'object',
            properties: { findings: { type: 'array' } },
            required: ['findings'],
          },
        },
      ),
    ).toMatchObject({
      status: 'failed',
      error: {
        code: 'STRUCTURED_OUTPUT_INVALID',
        message: expect.stringContaining('did not match --output-schema'),
      },
    });
  });

  it('never exposes an interactive blocked result', () => {
    expect(
      createExecResult(
        {
          sessionId: 'session-1',
          turnId: 'turn-1',
          status: 'awaiting-user-continuation',
          answer: null,
          durationMs: 25,
        },
        { runId: 'run-1' },
      ),
    ).toMatchObject({
      status: 'failed',
      error: { code: 'INTERACTION_NOT_AVAILABLE' },
    });
  });

  it('adds optional usage provenance without changing the numeric usage contract', () => {
    const result = createExecResult(
      { sessionId: 'session-1', turnId: 'turn-1', status: 'cancelled', durationMs: 25 },
      { runId: 'run-1', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 }, usageSource: 'completed_responses', usageIncomplete: true },
    );
    expect(result).toMatchObject({ usage: { totalTokens: 12 }, usageSource: 'completed_responses', usageIncomplete: true });
    expect(isExecResult(result)).toBe(true);
    expect(isExecResult({ ...result, usageSource: 'unknown' })).toBe(false);
    expect(isExecResult({ ...result, usageIncomplete: 'false' })).toBe(false);
  });

  it('carries the answer of a run that stopped short, on the status that says so', () => {
    // `output` was gated on `succeeded`, so a run the reader cancelled *after* its
    // answer had landed returned a status and nothing else — the text was in hand and
    // thrown away.
    const result = createExecResult(
      {
        sessionId: 'session-1',
        turnId: 'turn-1',
        status: 'cancelled',
        answer: 'eight directories',
        durationMs: 25,
      },
      { runId: 'run-1' },
    );

    expect(result).toMatchObject({ status: 'cancelled', output: 'eight directories' });
    expect(isExecResult(result)).toBe(true);
  });

  it('carries where a run got to when it has no answer to carry', () => {
    // The ordinary cut: the run was mid-tool-call, so there is no text at all — and
    // without this the result was indistinguishable from one that never started.
    const result = createExecResult(
      { sessionId: 'session-1', turnId: 'turn-1', status: 'timeout', answer: null, durationMs: 25 },
      { runId: 'run-1', progress: PROGRESS },
    );

    expect(result).toMatchObject({
      status: 'timeout',
      progress: { modelSteps: 3, toolCalls: 4, unfinishedOperations: [{ operationId: 'call_1' }] },
    });
    expect(result.output).toBeUndefined();
    expect(isExecResult(result)).toBe(true);
  });

  it('treats a blank answer as no answer, and still reports the progress', () => {
    const result = createExecResult(
      { sessionId: 'session-1', turnId: 'turn-1', status: 'timeout', answer: '  \n ', durationMs: 25 },
      { runId: 'run-1', progress: PROGRESS },
    );

    expect(result.output).toBeUndefined();
    expect(result.progress).toBeDefined();
  });

  it('keeps the progress off a run that succeeded, where the answer is the finding', () => {
    expect(
      createExecResult(
        { sessionId: 'session-1', turnId: 'turn-1', status: 'succeeded', answer: 'done', durationMs: 25 },
        { runId: 'run-1', progress: PROGRESS },
      ),
    ).toEqual({
      schemaVersion: 1,
      type: 'exec.result',
      runId: 'run-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'succeeded',
      output: 'done',
      durationMs: 25,
    });
  });

  it('validates the progress it accepts', () => {
    const result = createExecResult(
      { sessionId: 'session-1', turnId: 'turn-1', status: 'timeout', durationMs: 25 },
      { runId: 'run-1', progress: PROGRESS },
    );

    expect(isExecResult({ ...result, progress: { ...PROGRESS, toolCalls: 'four' } })).toBe(false);
    expect(
      isExecResult({ ...result, progress: { ...PROGRESS, unfinishedOperations: [{ kind: 'tool' }] } }),
    ).toBe(false);
  });
});
