import { describe, expect, it } from 'vitest';

import { lookupLocalModelLimits } from './model-catalog.js';
import { modelRefForModel } from './model-ref.js';

// The window a session compacts against, which is the number the models screen
// also draws — one answer for both, so a row promising a million cannot sit
// beside a turn compacting at two hundred thousand.
describe('the window a model runs at', () => {
  it('knows a gateway model the catalog does not, under any spelling', () => {
    // A reseller serves this one under a provider id of its own, so `pi-ai` has
    // no entry for it and every spelling below would otherwise fall to the 200k
    // guess while the model runs at a million.
    for (const id of [
      'deepseek-v4.1-flash',
      'deepseek/deepseek-v4.1-flash',
      'DeepSeek-V4.1-Flash',
    ]) {
      const limits = lookupLocalModelLimits('custom_provider:command-code', id);
      expect(limits.contextWindow, id).toBe(1_000_000);
      expect(limits.maxTokens, id).toBe(384_000);
    }
  });

  it('guesses honestly, and says so, for a model nobody has stated', () => {
    const limits = lookupLocalModelLimits('custom_provider:command-code', 'a-model-nobody-knows');
    expect(limits.contextWindow).toBe(200_000);
    expect(limits.fromCatalog).toBe(false);
  });

  it('does not let the gateway\'s own figure reach the ref it stamps', () => {
    // The loop this closes: a gateway answers 200,000, the config keeps it, the
    // ref carries it, and the resolver believes the ref over the catalog — so
    // `lookupLocalModelLimits` above would never be asked.
    const ref = modelRefForModel('custom_provider:command-code', 'deepseek-v4.1-flash', {
      limit: { context: 200_000, output: 16_384 },
    });
    expect(ref.context_window).toBe(1_000_000);
    expect(ref.max_tokens).toBe(384_000);
  });

  it('still carries a provider limit it has no statement about', () => {
    const ref = modelRefForModel('custom_provider:command-code', 'gpt-5.6-sol', {
      limit: { context: 400_000, output: 32_000 },
    });
    expect(ref.context_window).toBe(400_000);
    expect(ref.max_tokens).toBe(32_000);
  });
});
