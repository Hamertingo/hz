import type { LocalMcpService } from '../runtime/local-mcp.service.js';
import type {
  ListLocalMcpServersInput,
  ListLocalMcpServersResult,
  LocalMcpServerSummary,
} from '@hz/protocol/local';

import type {
  ConfiguredMcpConnectionTestResult,
  ConfiguredMcpServerDetail,
  ConfiguredMcpServerInput,
  ConfiguredMcpServerSummary,
  LocalMcpPublicServerCapability,
  LocalMcpPublicServerStatus,
  LocalMcpSessionServer,
  LocalMcpRuntimeContext,
} from '../contracts.js';

/// What this facade is allowed to ask the service for.
///
/// **Two halves, and they answer different questions.** The inspection half is
/// what a *session* can reach — built-ins, the project's own file, the session's
/// configured set, each with a live status, and it is read-only by construction.
/// The configured half is the reader's own store on this machine: what is written
/// down, on or off, and the four writes that change it. Kept as one `Pick` so a
/// method is either on the surface deliberately or not at all.
type LocalMcpOwner = Pick<
  LocalMcpService,
  | 'listBuiltinPublicServerCapabilities'
  | 'listPublicServerStatuses'
  | 'configureSessionServers'
  | 'clearSessionServers'
  | 'inspectProjectMcp'
  | 'getSessionMcpServers'
  | 'listConfiguredServers'
  | 'getConfiguredServer'
  | 'createConfiguredServer'
  | 'updateConfiguredServer'
  | 'deleteConfiguredServer'
  | 'setConfiguredServerEnabled'
  | 'testConfiguredServer'
>;

export interface ListMcpCapabilitiesReq {
  context?: LocalMcpRuntimeContext;
  keyword?: string;
}

export interface ListMcpCapabilitiesResp {
  servers: LocalMcpPublicServerCapability[];
}

export class LocalMcpPublicFacade {
  constructor(private readonly owner: LocalMcpOwner) {}

  async listLocalMcpServers(req: ListLocalMcpServersInput): Promise<ListLocalMcpServersResult> {
    const keyword = req.keyword?.trim().toLocaleLowerCase();
    const servers = await this.owner.listPublicServerStatuses();
    return {
      servers: servers
        .filter((server) => !keyword || server.name.toLocaleLowerCase().includes(keyword))
        .map(toPublicSummary),
    };
  }

  async listMcpCapabilities(req: ListMcpCapabilitiesReq): Promise<ListMcpCapabilitiesResp> {
    const keyword = req.keyword?.trim().toLocaleLowerCase();
    const [builtin, configuredStatuses] = await Promise.all([
      this.owner.listBuiltinPublicServerCapabilities(),
      this.owner.listPublicServerStatuses(),
    ]);
    const project = req.context ? await this.owner.inspectProjectMcp(req.context) : undefined;
    const session = req.context?.sessionId
      ? this.owner.getSessionMcpServers(req.context.sessionId)
      : undefined;
    const projected: LocalMcpPublicServerCapability[] = (project?.servers ?? []).map((server) => ({
      name: server.name,
      sourceKind: 'configured',
      sourceScope: 'project',
      managed: false,
      transport:
        server.transport === 'streamable-http' ? 'http' : publicTransport(server.transport),
      enabled: server.status !== 'disabled' && server.status !== 'error',
      status: server.status,
      available: server.status === 'available',
      tools: [],
      description: project?.path,
      ...(server.error ? { error: server.error } : {}),
    }));
    const client: LocalMcpPublicServerCapability[] = Object.entries(session ?? {}).map(
      ([name, config]) => ({
        name,
        sourceKind: 'configured',
        sourceScope: 'session',
        managed: false,
        transport: publicTransport(config.type),
        enabled: true,
        status: 'configured',
        available: false,
        tools: [],
      }),
    );
    const overrides = new Set([...projected, ...client].map((server) => server.name));
    const sessionNames = new Set(client.map((server) => server.name));
    const configured = [
      ...configuredStatuses
        .filter((server) => !overrides.has(server.name))
        .map(toConfiguredCapability),
      ...projected.filter((server) => !sessionNames.has(server.name)),
      ...client,
    ];
    return {
      servers: [...builtin, ...configured].flatMap((server) => filterCapability(server, keyword)),
    };
  }

  inspectProjectMcp(context: LocalMcpRuntimeContext) {
    return this.owner.inspectProjectMcp(context);
  }
  configureSessionServers(input: {
    sessionId: string;
    servers: readonly LocalMcpSessionServer[];
  }): Promise<void> {
    return this.owner.configureSessionServers(input.sessionId, input.servers);
  }

  clearSessionServers(sessionId: string): Promise<void> {
    return this.owner.clearSessionServers(sessionId);
  }

  /// The servers this machine has written down, as rows.
  ///
  /// **A different list from [`listMcpCapabilities`], and the difference is what
  /// each is for.** That one answers what a *session* can reach — built-ins, the
  /// project's own file, the session's own set — each with a live status. This is
  /// the reader's store: what is on disk, on or off, and nothing about whether it
  /// is up. A screen with switches in it needs this one, because a server switched
  /// off is still a row here and would not be there.
  ///
  /// **It carries no configuration, deliberately.** `env` and `headers` hold
  /// credentials, and a listing drawn to show names has no business carrying every
  /// secret on the machine — see [`getConfiguredServer`] for the one read that
  /// does.
  async listConfiguredServers(keyword?: string): Promise<ConfiguredMcpServerSummary[]> {
    return this.owner.listConfiguredServers(keyword);
  }

  /// One server's whole configuration, or `undefined` for one that is gone.
  async getConfiguredServer(name: string): Promise<ConfiguredMcpServerDetail | undefined> {
    return this.owner.getConfiguredServer(name);
  }

  async createConfiguredServer(
    name: string,
    input: ConfiguredMcpServerInput,
    enabled = true,
  ): Promise<ConfiguredMcpServerDetail> {
    return this.owner.createConfiguredServer(name, input, enabled);
  }

  async updateConfiguredServer(
    name: string,
    input: ConfiguredMcpServerInput,
    enabled?: boolean,
  ): Promise<ConfiguredMcpServerDetail> {
    return this.owner.updateConfiguredServer(name, input, enabled);
  }

  async deleteConfiguredServer(name: string): Promise<boolean> {
    return this.owner.deleteConfiguredServer(name);
  }

  async setConfiguredServerEnabled(
    name: string,
    enabled: boolean,
  ): Promise<ConfiguredMcpServerSummary> {
    return this.owner.setConfiguredServerEnabled(name, enabled);
  }

  /// Connects once and says what happened.
  ///
  /// **Kept apart from saving, because they fail differently.** An entry can be
  /// written down cleanly and still name a command that is not installed or a URL
  /// that refuses — and only this tells the two apart, which is the whole
  /// question a reader has after adding one.
  async testConfiguredServer(name: string): Promise<ConfiguredMcpConnectionTestResult> {
    return this.owner.testConfiguredServer(name);
  }
}

function toConfiguredCapability(
  server: LocalMcpPublicServerStatus,
): LocalMcpPublicServerCapability {
  return {
    ...server,
    sourceKind: 'configured',
    managed: false,
    tools: [],
  };
}

function filterCapability(
  server: LocalMcpPublicServerCapability,
  keyword: string | undefined,
): LocalMcpPublicServerCapability[] {
  if (!keyword || server.name.toLocaleLowerCase().includes(keyword)) return [server];
  const tools = server.tools.filter(
    (tool) =>
      tool.name.toLocaleLowerCase().includes(keyword) ||
      tool.description?.toLocaleLowerCase().includes(keyword),
  );
  return tools.length > 0 ? [{ ...server, tools }] : [];
}

function toPublicSummary(server: LocalMcpPublicServerStatus): LocalMcpServerSummary {
  return {
    name: server.name,
    enabled: server.enabled,
    transport: server.transport,
    ...(server.description ? { description: server.description } : {}),
    configJson: JSON.stringify({
      status: server.status,
      available: server.available,
      ...(server.error ? { error: server.error } : {}),
    }),
  };
}

function publicTransport(type?: string): LocalMcpPublicServerStatus['transport'] {
  if (type === 'streamable-http') return 'http';
  return type === 'stdio' || type === 'http' || type === 'sse' ? type : 'none';
}
