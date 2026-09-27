import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  LocalCustomProvidersConfig,
  LocalRuntimeConfig,
  ModelSystemConfigPort,
} from '../contracts.js';
import { backfillCustomProviderModelEffort } from './service-catalog-backfill.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

/// A catalog listing the way models.dev writes one: a provider the preset parser
/// accepts, and a model whose effort levels are spelled out.
function catalogSnapshot(models: Record<string, Record<string, unknown>>) {
  return {
    version: 1,
    source: 'https://models.dev/api.json',
    updatedAt: 10,
    catalog: {
      deepseek: {
        name: 'DeepSeek',
        npm: '@ai-sdk/openai-compatible',
        api: 'https://api.deepseek.test/v1',
        models,
      },
    },
  };
}

async function catalogOptions(models: Record<string, Record<string, unknown>>) {
  const root = await mkdtemp(join(tmpdir(), 'mavis-effort-backfill-'));
  temporaryDirectories.push(root);
  const dataDir = join(root, 'data');
  const localCatalogPath = join(dataDir, 'cache', 'models-dev-catalog.json');
  await mkdir(join(dataDir, 'cache'), { recursive: true });
  await writeFile(localCatalogPath, JSON.stringify(catalogSnapshot(models)));
  return {
    dataDir,
    localCatalogPath,
    bundledCatalogPath: join(root, 'absent.json.gz'),
  };
}

/// The config port as the runtime hands it over, with the draft write recorded
/// so a test can tell "left alone" from "written back unchanged".
function configPort(customProvider: LocalCustomProvidersConfig) {
  const config = {
    provider: {},
    custom_provider: customProvider,
    dataDir: '/tmp/data',
  } as unknown as LocalRuntimeConfig;
  const writes: LocalCustomProvidersConfig[] = [];
  const port: Pick<ModelSystemConfigPort, 'read' | 'updateByok'> = {
    read: () => config,
    updateByok: vi.fn(async (mutate) => {
      const draft = { custom_provider: structuredClone(customProvider) };
      await mutate(draft, config);
      writes.push(draft.custom_provider as LocalCustomProvidersConfig);
    }),
  };
  return { port, writes };
}

const laddered = {
  'deepseek-v4.1-flash': {
    name: 'DeepSeek V4.1 Flash',
    tool_call: true,
    reasoning: true,
    reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }],
  },
};

describe('the effort ladder a connected model was never told about', () => {
  it('is written onto the entry, matched by the model id a reseller keeps', async () => {
    // The gateway serves a path-qualified id; the catalog names the model bare.
    const { port, writes } = configPort({
      'command-code': {
        kind: 'custom',
        models: {
          'deepseek/deepseek-v4.1-flash': { name: 'flash', limit: { context: 1_000_000 } },
        },
      },
    });

    const filled = await backfillCustomProviderModelEffort(port, await catalogOptions(laddered));

    expect(filled).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.['command-code']?.models?.['deepseek/deepseek-v4.1-flash']).toEqual({
      name: 'flash',
      limit: { context: 1_000_000 },
      thinking: { effortOptions: ['low', 'high', 'max'] },
    });
  });

  it('leaves the entry and the file alone when the entry states a ladder', async () => {
    const { port, writes } = configPort({
      'command-code': {
        kind: 'custom',
        models: {
          'deepseek/deepseek-v4.1-flash': { thinking: { effortOptions: ['high'] } },
        },
      },
    });

    expect(await backfillCustomProviderModelEffort(port, await catalogOptions(laddered))).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('writes nothing for a model the catalog has never heard of', async () => {
    const { port, writes } = configPort({
      'command-code': { kind: 'custom', models: { 'house-model-v9': { name: 'house' } } },
    });

    expect(await backfillCustomProviderModelEffort(port, await catalogOptions(laddered))).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it('keeps a ladder the draft already carries when it is written', async () => {
    // The reader saved the same provider between the read and the write.
    const customProvider: LocalCustomProvidersConfig = {
      'command-code': {
        kind: 'custom',
        models: { 'deepseek/deepseek-v4.1-flash': { name: 'flash' } },
      },
    };
    const config = {
      provider: {},
      custom_provider: customProvider,
      dataDir: '/tmp/data',
    } as unknown as LocalRuntimeConfig;
    let written: LocalCustomProvidersConfig | undefined;
    const port: Pick<ModelSystemConfigPort, 'read' | 'updateByok'> = {
      read: () => config,
      updateByok: async (mutate) => {
        const draft = {
          custom_provider: {
            'command-code': {
              kind: 'custom',
              models: {
                'deepseek/deepseek-v4.1-flash': { thinking: { effortOptions: ['max'] } },
              },
            },
          },
        };
        await mutate(draft, config);
        written = draft.custom_provider as LocalCustomProvidersConfig;
      },
    };

    expect(await backfillCustomProviderModelEffort(port, await catalogOptions(laddered))).toBe(0);
    expect(
      written?.['command-code']?.models?.['deepseek/deepseek-v4.1-flash']?.thinking,
    ).toEqual({ effortOptions: ['max'] });
  });
});
