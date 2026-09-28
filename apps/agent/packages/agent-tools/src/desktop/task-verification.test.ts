import { describe, expect, it } from 'vitest';

import { formatLocalTaskParentReport, SILENT_EXIT_NOTICE } from './task-verification.js';
import type { LocalTaskRunResult } from './types.js';

function report(overrides: Partial<LocalTaskRunResult> = {}): string {
  return formatLocalTaskParentReport({
    status: 'succeeded',
    requestedAgentName: 'explore',
    ...overrides,
  });
}

describe('the parent report states how the child ended', () => {
  it('says reported, and adds no notice, for a child that published something', () => {
    const text = report({ exit: 'reported', finalText: 'eight' });

    expect(text).toContain('exit: reported');
    expect(text).not.toContain(SILENT_EXIT_NOTICE);
  });

  it('says silent, and names what to do about it, for a child that published nothing', () => {
    const text = report({ exit: 'silent' });

    expect(text).toContain('exit: silent');
    expect(text).toContain(SILENT_EXIT_NOTICE);
    // Both routes the notice offers have to be real ones.
    expect(SILENT_EXIT_NOTICE).toContain('task_append');
    expect(SILENT_EXIT_NOTICE).toContain('transcript');
  });

  it('leaves the exit missing, with no notice, for a run that never finished', () => {
    // A failed child with empty text is not a silent one: it never got the chance to
    // keep the contract, and calling it silent would invite the parent to ask again.
    const text = report({ status: 'failed', errorMessage: 'the model refused' });

    expect(text).toContain('exit: missing');
    expect(text).not.toContain(SILENT_EXIT_NOTICE);
  });

  it('states the exit immediately after the status, before anything it qualifies', () => {
    const lines = report({ exit: 'reported', finalText: 'eight' }).split('\n');

    expect(lines[0]).toBe('run_status: succeeded');
    expect(lines[1]).toBe('exit: reported');
  });
});
