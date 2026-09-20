import type { MavisBuildEnv, MavisRegion } from '@hz/config';

export interface CliAuthScope {
  readonly region: MavisRegion;
  readonly buildEnv: MavisBuildEnv;
}
