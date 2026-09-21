import { describe, expect, it } from 'vitest';

import { resolveLocalMcpDisclosureOptions } from './local-turn-tool-catalog.js';

describe('resolveLocalMcpDisclosureOptions', () => {
  it('keeps the tool list whole unless something asks for the search path', () => {
    // The prompt tells the model its tool list is authoritative, so deferring
    // configured tools behind a search is opt-in rather than the default.
    expect(resolveLocalMcpDisclosureOptions(undefined, {}).enabled).toBe(false);
  });

  it('lets either the environment or the config turn it on', () => {
    expect(
      resolveLocalMcpDisclosureOptions(undefined, { MAVIS_MCP_TOOL_SEARCH_ENABLED: '1' }).enabled,
    ).toBe(true);
    expect(resolveLocalMcpDisclosureOptions({ enabled: true }, {}).enabled).toBe(true);
  });

  it('whitelists no model by default', () => {
    // The other half of the same guarantee: nothing reaches the search path
    // through the whitelist either, which is what the vendor's own default
    // relied on alone.
    expect(resolveLocalMcpDisclosureOptions(undefined, {}).modelWhitelist).toEqual([]);
  });
});
