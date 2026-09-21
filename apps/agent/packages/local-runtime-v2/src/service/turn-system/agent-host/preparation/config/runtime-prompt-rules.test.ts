import { describe, expect, it } from 'vitest';

import { TOOL_USAGE_RULES } from '../prompt-blocks.js';
import { addRuntimeRules } from './runtime-prompt-rules.js';

describe('addRuntimeRules', () => {
  it('states how to choose a tool on every surface', () => {
    // Interactive or not: a task child is the surface with the narrower tool
    // list, and the one whose descriptions most need to be taken as the answer.
    for (const interactiveSurface of [true, false]) {
      const prompt = addRuntimeRules('You are a local coding assistant.', interactiveSurface);
      expect(prompt).toContain('# Choosing a Tool');
      expect(prompt).toContain(TOOL_USAGE_RULES);
    }
  });

  it('makes the tool list itself the answer', () => {
    // The sentence the block turns on: without it an agent spends calls working
    // out how to do something that a tool already does.
    expect(TOOL_USAGE_RULES).toContain('authoritative');
    expect(TOOL_USAGE_RULES).toContain('do not call a tool merely to discover');
  });

  it('does not name tools', () => {
    // A policy that lists names ages the moment one is added or renamed, and the
    // list it has to agree with is built per turn from that turn's facts.
    expect(TOOL_USAGE_RULES).not.toMatch(/`(read|write|edit|bash|grep|glob|task)`/u);
  });

  it('keeps the rules it already owned', () => {
    const prompt = addRuntimeRules('base', true);
    expect(prompt).toContain('# Harness');
    expect(prompt).toContain('# Communication & Delivery');
  });

  it('lands inside an existing section rather than beside it', () => {
    const prompt = addRuntimeRules('# Choosing a Tool\nplaceholder\n\n# Harness\ntext', true);

    // A prompt that already carries the heading gets the policy inserted under
    // it, not a second copy of the section appended at the end.
    const headings = prompt.split('\n').filter((line) => line === '# Choosing a Tool');
    expect(headings).toHaveLength(1);
  });
});
