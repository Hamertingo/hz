import { describe, expect, it } from 'vitest';

import {
  createBashEnvSpawnHook,
  resolveBashEnvPolicy,
  sanitizeBashSubprocessEnv,
} from '../../src/bash-subprocess-env.js';

const providerEnv = {
  MCODE_PROVIDER_API_KEY: 'synthetic-provider-value',
  INPUT_MCODE_PROVIDER_API_KEY: 'synthetic-input-value',
  MCODE_PROVIDER_BASE_URL: 'https://provider.example.invalid',
  MCODE_PROVIDER_MODEL: 'synthetic-model',
  CUSTOM_PROVIDER_API_KEY: 'synthetic-custom-value',
  GH_TOKEN: 'synthetic-gh-value',
  GITHUB_TOKEN: 'synthetic-github-value',
  NPM_TOKEN: 'synthetic-npm-value',
};

describe('the session a spawn belongs to', () => {
  /**
   * The hz app's CLI reads this to learn which session a command came from, and
   * it is per turn rather than per process: one agent serves several sessions,
   * so only the turn knows which one is running.
   */
  it('names the session in the child env', () => {
    const { env } = sanitizeBashSubprocessEnv({ PATH: '/bin' }, { mode: 'off' }, 'mvs_abc');

    expect(env.HZ_SESSION_ID).toBe('mvs_abc');
  });

  /**
   * **Survives `strict`**, which is the mode that deletes anything looking like
   * a credential: a session id is not one, and a strip that ate it would leave
   * every command from an agent with no session to name — the failure this
   * whole path exists to remove.
   */
  it('is not treated as a credential by the strict strip', () => {
    const { env, removed } = sanitizeBashSubprocessEnv(
      { PATH: '/bin', OTHER_TOKEN: 'synthetic' },
      { mode: 'strict' },
      'mvs_abc',
    );

    expect(env.HZ_SESSION_ID).toBe('mvs_abc');
    expect(removed).toContain('OTHER_TOKEN');
  });

  it('invents nothing where no session is known', () => {
    const plain = sanitizeBashSubprocessEnv({ PATH: '/bin' }, { mode: 'off' });
    expect(plain.env).not.toHaveProperty('HZ_SESSION_ID');

    const hooked = createBashEnvSpawnHook({ mode: 'off' })({
      command: 'echo hi',
      cwd: '.',
      env: { PATH: '/bin' },
    });
    expect(hooked.env).not.toHaveProperty('HZ_SESSION_ID');
  });
});

describe('bash subprocess default provider credentials', () => {
  it.each([{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }, { MAVIS_BASH_ENV_SANITIZE: 'scrub' }])(
    'scrubs both provider key names using policy %j',
    (markers) => {
      const original = { ...providerEnv, ...markers };
      const policy = resolveBashEnvPolicy(undefined, original);
      expect(policy.mode).toBe('scrub');
      const { env, removed } = sanitizeBashSubprocessEnv(original, policy);
      const { MCODE_PROVIDER_API_KEY, INPUT_MCODE_PROVIDER_API_KEY, ...preserved } = original;
      expect(env).toEqual(preserved);
      expect(removed).toEqual(['INPUT_MCODE_PROVIDER_API_KEY', 'MCODE_PROVIDER_API_KEY']);
      expect(original.MCODE_PROVIDER_API_KEY).toBe(MCODE_PROVIDER_API_KEY);
      expect(original.INPUT_MCODE_PROVIDER_API_KEY).toBe(INPUT_MCODE_PROVIDER_API_KEY);
    },
  );

  it('applies scrub to the actual spawn-hook environment without mutating its input', () => {
    const original = { command: 'echo synthetic', cwd: '.', env: { ...providerEnv } };
    const result = createBashEnvSpawnHook({ mode: 'scrub' })(original);
    expect(result.env).not.toHaveProperty('MCODE_PROVIDER_API_KEY');
    expect(result.env).not.toHaveProperty('INPUT_MCODE_PROVIDER_API_KEY');
    expect(result.command).toBe(original.command);
    expect(original.env).toEqual(providerEnv);
  });

  it('preserves credentials when off is explicitly selected, including in CI', () => {
    const policy = resolveBashEnvPolicy({ mode: 'off' }, { CI: 'true' });
    expect(sanitizeBashSubprocessEnv(providerEnv, policy)).toEqual({
      env: providerEnv,
      removed: [],
    });
  });

  it('continues to strip both provider names in strict mode', () => {
    const { env, removed } = sanitizeBashSubprocessEnv(providerEnv, { mode: 'strict' });
    expect(env).not.toHaveProperty('MCODE_PROVIDER_API_KEY');
    expect(env).not.toHaveProperty('INPUT_MCODE_PROVIDER_API_KEY');
    expect(removed).toContain('MCODE_PROVIDER_API_KEY');
    expect(removed).toContain('INPUT_MCODE_PROVIDER_API_KEY');
    expect(env.MCODE_PROVIDER_MODEL).toBe(providerEnv.MCODE_PROVIDER_MODEL);
    expect(env.MCODE_PROVIDER_BASE_URL).toBe(providerEnv.MCODE_PROVIDER_BASE_URL);
  });

  it('retains the explicit strict allowlist escape hatch', () => {
    const { env } = sanitizeBashSubprocessEnv(providerEnv, {
      mode: 'strict',
      allowlist: ['MCODE_PROVIDER_API_KEY', 'INPUT_MCODE_PROVIDER_API_KEY'],
    });
    expect(env.MCODE_PROVIDER_API_KEY).toBe(providerEnv.MCODE_PROVIDER_API_KEY);
    expect(env.INPUT_MCODE_PROVIDER_API_KEY).toBe(providerEnv.INPUT_MCODE_PROVIDER_API_KEY);
  });
});
