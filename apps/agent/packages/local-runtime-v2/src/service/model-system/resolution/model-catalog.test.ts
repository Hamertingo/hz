import { describe, expect, it } from 'vitest';

import { lookupLocalModelLimits } from './model-catalog.js';

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
});
