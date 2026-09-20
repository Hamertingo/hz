import type { ResolvedAgentCapabilities } from '@hz/config';

import type { HostedAgentCapabilityRestrictions } from './hosted-agent-capabilities.js';

export function applyHostedCapabilityRestrictions(
  capabilities: ResolvedAgentCapabilities,
  restrictions: HostedAgentCapabilityRestrictions,
): ResolvedAgentCapabilities {
  if (!restrictions.disableMavis) return capabilities;
  return {
    ...capabilities,
    features: {
      ...capabilities.features,
      mavis: false,
    },
  };
}
