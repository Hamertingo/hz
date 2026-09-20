import type {
  LocalSandboxBashExecutionPort,
  LocalSandboxBashOperationsFactory,
} from '@hz/agent-tools/desktop';

export interface DeferredLocalSandboxBashOperationsFactory extends LocalSandboxBashExecutionPort {
  bind(factory: LocalSandboxBashOperationsFactory): void;
}
