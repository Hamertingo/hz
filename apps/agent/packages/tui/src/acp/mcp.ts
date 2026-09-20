import * as acp from '@agentclientprotocol/sdk';

import type {
  TuiConfiguredMcpConfig,
  TuiConfiguredMcpTransport,
} from '../types/runtime-models.js';
import type { TuiAcpRuntime } from './runtime.js';

const TRANSPORTS: readonly TuiConfiguredMcpTransport[] = [
  'stdio',
  'http',
  'streamable-http',
  'sse',
];

/// The MCP servers this machine has written down, and the writes that change them.
///
/// **The reader's own store, not what a session can reach.** The runtime has two
/// MCP lists. `listMcpServers` answers what a *session* can reach — built-ins, the
/// project's own file, the session's own set, each with a live status — and a
/// server switched off is not in it at all. These are the machine's configured
/// servers, off ones included, plus the four writes and the one connection test.
/// A client built on the other list could switch a server off and then never see
/// it again to switch it back on — the same trap `skills.ts` documents, and the
/// reason both of them read the management view instead.
///
/// **No `sessionId`, unlike every other extension here.** The others take one
/// because what they ask is about a session; this file is the machine's, and no
/// session changes the answer — so a session id would be a field nothing reads.
///
/// **The config crossing the wire is flat**, with the fields of both transports,
/// because that is what the form on the other side holds while the reader switches
/// between them. Narrowing it to the agent's own union — a stdio server has no
/// `url` — happens at the runtime's boundary, which is the one place that can say
/// so once.
export function registerTuiAcpMcpExtensions(options: {
  readonly app: acp.AgentApp;
  readonly runtime: TuiAcpRuntime;
}): void {
  options.app.onRequest('mcode/mcp/servers/list', parseListRequest, async ({ params }) => ({
    servers: await options.runtime.listConfiguredMcpServers(params.keyword),
  }));

  options.app.onRequest('mcode/mcp/servers/get', parseNameRequest, async ({ params }) => ({
    // `null` for a server that is gone rather than a throw: the row a client
    // pressed may have been deleted since it was listed, and "this one is no
    // longer here" is a sentence a screen can draw — see `skills/read`.
    server: (await options.runtime.getConfiguredMcpServer(params.name)) ?? null,
  }));

  options.app.onRequest('mcode/mcp/servers/create', parseWriteRequest, async ({ params }) => ({
    server: await refuseInWords(() =>
      options.runtime.createConfiguredMcpServer(params.name, params.config),
    ),
  }));

  options.app.onRequest('mcode/mcp/servers/update', parseWriteRequest, async ({ params }) => ({
    server: await refuseInWords(() =>
      options.runtime.updateConfiguredMcpServer(params.name, params.config),
    ),
  }));

  options.app.onRequest('mcode/mcp/servers/delete', parseNameRequest, async ({ params }) => ({
    deleted: await refuseInWords(() =>
      options.runtime.deleteConfiguredMcpServer(params.name),
    ),
  }));

  options.app.onRequest(
    'mcode/mcp/servers/set_enabled',
    parseSetEnabledRequest,
    async ({ params }) => ({
      server: await refuseInWords(() =>
        options.runtime.setConfiguredMcpServerEnabled(params.name, params.enabled),
      ),
    }),
  );

  options.app.onRequest('mcode/mcp/servers/test', parseNameRequest, async ({ params }) => ({
    // A *failed connection* is not a refusal and does not come through here: it
    // answers `success: false` with a code, which is the whole point of the call —
    // see `TuiMcpTestResult`. What this catches is the server not being there at
    // all.
    result: await refuseInWords(() => options.runtime.testConfiguredMcpServer(params.name)),
  }));
}

/// Runs one operation, saying a refusal in the agent's own words.
///
/// **A settings refusal is not an internal error, and ACP would call it one.** The
/// service answers a duplicate name, a missing command, a server that is not there
/// with a status and a sentence — and the extension layer carries every throw as
/// `-32603 Internal error`, whose message is the only field a client reads. So the
/// right sentence ends up buried in a `data.details` nothing looks at, and the form
/// that just refused a duplicate name says "Internal error" instead of "that name
/// is taken". A 4xx is what says the *request* was wrong, which is the one thing
/// ACP has a code for.
///
/// The refusal is recognised by its own shape — the service's `status`, its `MCP_`
/// tag and its sentence — rather than by importing the service's error class into
/// this layer, which would tie the wire to an implementation detail of the runtime
/// behind it. Anything else is re-thrown untouched, so a genuine fault still reads
/// as one.
async function refuseInWords<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const refusal = error as { status?: unknown; code?: unknown; message?: unknown };
    const status = refusal?.status;
    if (
      typeof status === 'number' &&
      status >= 400 &&
      status < 500 &&
      typeof refusal.code === 'string' &&
      refusal.code.startsWith('MCP_') &&
      typeof refusal.message === 'string' &&
      refusal.message.trim().length > 0
    ) {
      throw acp.RequestError.invalidParams(undefined, refusal.message);
    }
    throw error;
  }
}

function parseListRequest(value: unknown): { keyword?: string } {
  const record = requireRecord(value);
  return record.keyword == null ? {} : { keyword: requireText(record.keyword, 'keyword') };
}

function parseNameRequest(value: unknown): { name: string } {
  return { name: requireText(requireRecord(value).name, 'name') };
}

function parseSetEnabledRequest(value: unknown): { name: string; enabled: boolean } {
  const record = requireRecord(value);
  const enabled = record.enabled;
  if (typeof enabled !== 'boolean') {
    throw acp.RequestError.invalidParams(undefined, '`enabled` must be a boolean.');
  }
  return { name: requireText(record.name, 'name'), enabled };
}

function parseWriteRequest(value: unknown): {
  name: string;
  config: TuiConfiguredMcpConfig;
} {
  const record = requireRecord(value);
  return {
    name: requireText(record.name, 'name'),
    config: parseConfig(record.config),
  };
}

/// The form's flat shape, read field by field.
///
/// Every field is optional except the transport, and an absent one is left absent
/// rather than filled in with an empty string: the boundary that narrows this into
/// the agent's union decides what a transport needs, and an empty string here
/// would be a value it had to tell apart from nothing.
function parseConfig(value: unknown): TuiConfiguredMcpConfig {
  const record = requireRecord(value);
  const transport = record.transport;
  if (
    typeof transport !== 'string' ||
    !TRANSPORTS.some((candidate) => candidate === transport)
  ) {
    throw acp.RequestError.invalidParams(
      undefined,
      '`config.transport` must be one of stdio, http, streamable-http or sse.',
    );
  }

  return {
    transport: transport as TuiConfiguredMcpTransport,
    ...optional(record, 'command', requireText),
    ...optional(record, 'url', requireText),
    ...optional(record, 'description', requireText),
    ...optional(record, 'timeoutMs', positiveInteger),
    ...optional(record, 'args', stringArray),
    ...optional(record, 'env', stringRecord),
    ...optional(record, 'headers', stringRecord),
  };
}

/// One field of a record, kept only where it was sent.
///
/// **`null` counts as not sent**, which is not pedantry: this envelope is written
/// by clients whose languages have no `undefined`, and a Rust `Option::None`
/// arrives as `null` from every one of them. Reading one as an empty string would
/// turn "this field is not part of my transport" into "the reader left it blank",
/// which are two different answers from the form.
function optional<K extends string, T>(
  record: Record<string, unknown>,
  key: K,
  read: (value: unknown, field: string) => T,
): Record<K, T> | Record<string, never> {
  const value = record[key];
  return value == null ? {} : ({ [key]: read(value, key) } as Record<K, T>);
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw acp.RequestError.invalidParams(undefined, `\`${field}\` must be a positive integer.`);
  }
  return value;
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw acp.RequestError.invalidParams(undefined, `\`${field}\` must be a list of strings.`);
  }
  return value as string[];
}

function stringRecord(value: unknown, field: string): Record<string, string> {
  const record = requireRecord(value);
  if (Object.values(record).some((item) => typeof item !== 'string')) {
    throw acp.RequestError.invalidParams(
      undefined,
      `\`${field}\` must map strings to strings.`,
    );
  }
  return record as Record<string, string>;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw acp.RequestError.invalidParams(undefined, 'Expected an object.');
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw acp.RequestError.invalidParams(undefined, `\`${field}\` must be a non-empty string.`);
  }
  return value.trim();
}
