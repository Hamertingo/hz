import type { BashEnvPolicy } from '@hz/agent-core/bash-subprocess-env';
import type { LocalSandboxBashOperationsFactory } from '@hz/agent-tools/desktop';

import { createLocalBackgroundBashExecutor } from './executor.js';

export function initializeLocalBackgroundBashExecutor(
  operationsFactory: LocalSandboxBashOperationsFactory,
  envPolicy: BashEnvPolicy,
) {
  return createLocalBackgroundBashExecutor(operationsFactory, envPolicy);
}
