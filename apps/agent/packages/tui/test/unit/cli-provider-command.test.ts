import { describe, expect, it, vi } from 'vitest';

import { runMcodeProviderCommand } from '../../src/cli/provider-command.js';
import type { McodeProviderApplication } from '../../src/provider/application.js';
import type { McodeProviderView } from '../../src/provider/contract.js';

/// `add-models` is the half an ACP client calls: it resolves a gateway's list
/// itself — which of its rows this build can run is not a fact a discovery
/// knows — and hands over only the ids it kept.
///
/// The reply is the contract that client parses, so what it holds is pinned
/// here rather than left to whatever the id list happens to look like.
function provider(models: readonly string[]): McodeProviderView {
  return {
    providerId: 'custom_provider:work',
    name: 'Work',
    kind: 'custom',
    active: true,
    enabled: true,
    readOnly: false,
    hasApiKey: true,
    configRevision: 'rev-1',
    baseUrl: 'https://models.example/v1',
    models: models.map((modelId) => ({ modelId })),
  };
}

function context(applied: readonly string[]) {
  let current = provider(['old-model']);
  const addModels = vi.fn(async (_provider: McodeProviderView, ids: readonly string[]) => {
    current = provider([...applied]);
    return ids.length;
  });
  const application = {
    snapshot: async () => ({ minimaxModelSource: 'token_plan', providers: [current] }),
    addModels,
  };
  return {
    addModels,
    shutdown: async () => {},
    application: application as unknown as McodeProviderApplication,
  };
}

async function run(
  request: Parameters<typeof runMcodeProviderCommand>[0]['request'],
  created: ReturnType<typeof context>,
) {
  return runMcodeProviderCommand({
    version: '0.0.0-test',
    request,
    createContext: async () => ({ application: created.application, shutdown: created.shutdown }),
  });
}

describe('provider add-models', () => {
  it('answers with the ids the provider holds once they are added', async () => {
    const created = context(['old-model', 'new-model']);

    const reply = await run(
      { action: 'add-models', providerId: 'custom_provider:work', models: ['new-model'], json: true },
      created,
    );

    expect(JSON.parse(reply)).toEqual({
      providerId: 'custom_provider:work',
      added: 1,
      models: ['old-model', 'new-model'],
    });
    expect(created.addModels).toHaveBeenCalledOnce();
  });

  it('names the provider it could not find instead of adding to nothing', async () => {
    const created = context([]);

    await expect(
      run({ action: 'add-models', providerId: 'custom_provider:gone', models: ['a'] }, created),
    ).rejects.toThrow('custom_provider:gone');
    expect(created.addModels).not.toHaveBeenCalled();
  });

  it('refuses a call that would add nothing at all', async () => {
    const created = context([]);

    await expect(
      run({ action: 'add-models', providerId: 'custom_provider:work', models: [] }, created),
    ).rejects.toThrow('At least one --model <id> is required.');
    expect(created.addModels).not.toHaveBeenCalled();
  });
});
