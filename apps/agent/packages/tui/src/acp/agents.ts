import * as acp from '@agentclientprotocol/sdk';

import type { TuiAgent, TuiAgentDetail, TuiAgentDraft } from '../types/runtime-models.js';
import type { TuiAcpRuntime } from './runtime.js';

/// One Agent, as an ACP client is told about it.
///
/// **A definition, not a Session.** An Agent is a stored identity and prompt a
/// Session is later started *under*; this roster says nothing about what is
/// running, which is the delegation extension's question and a different one.
export interface TuiAcpAgent {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly avatar?: string;
  readonly agentRole: string;
  readonly creationSource: string;
}

/// One Agent with its stored prompt.
export interface TuiAcpAgentDetail {
  readonly agent: TuiAcpAgent;
  readonly systemPrompt?: string;
  readonly persona?: string;
}

/// The Agent roster, and the four writes a client may make to it.
///
/// **These exist because the terminal's own Agents screen is not reachable from a
/// client.** The TUI creates and edits Agents from its own UI, and an ACP client —
/// which has no terminal — could neither list them nor write one. The runtime
/// already holds every one of these, so this is the seam rather than a second
/// implementation.
///
/// **The store owns validation, not this file.** A name that collides with a
/// reserved role, a blank prompt, an Agent that is gone: each is refused in the
/// store's own words, and a client draws that sentence. What is checked here is
/// only the shape of the request — that a string is a string — so a *malformed*
/// request fails as one rather than as a store refusal it is not.
///
/// **Writes go around the content review, and that is the client's situation
/// rather than a choice made here.** The review is a managed-gateway call that
/// fails closed, so a client running on its own provider keys has no verdict and
/// every write would be refused. It is the one thing these methods do differently
/// from the terminal's own editor — see
/// [`createDefinitionUnreviewed`](AgentApplication).
export function registerTuiAcpAgentExtensions(options: {
  readonly app: acp.AgentApp;
  readonly runtime: TuiAcpRuntime;
}): void {
  options.app.onRequest('mcode/agents/list', parseListRequest, async ({ params }) => ({
    agents: (await inWords(() => options.runtime.listAgents(params))).map(toAcpAgent),
  }));

  options.app.onRequest('mcode/agents/get', parseNameRequest, async ({ params }) => {
    // **`null` and not a throw.** An Agent deleted between the list and the press
    // is an answer a client can draw — "this one is gone" — where an error only
    // says something went wrong, which is the wrong thing under a heading that
    // already named the Agent. The `readSkill` bargain, for the same reason.
    const detail = await inWords(() => options.runtime.getAgent(params.name));
    return { agent: detail ? toAcpDetail(detail) : null };
  });

  options.app.onRequest('mcode/agents/create', parseDraftRequest, async ({ params }) => ({
    agent: toAcpDetail(await inWords(() => options.runtime.createAgent(draftOf(params)))),
  }));

  options.app.onRequest('mcode/agents/update', parseUpdateRequest, async ({ params }) => ({
    agent: toAcpDetail(
      await inWords(() => options.runtime.updateAgent(params.name, draftOf(params))),
    ),
  }));

  options.app.onRequest('mcode/agents/delete', parseNameRequest, async ({ params }) => ({
    removed: await inWords(() => options.runtime.deleteAgent(params.name)),
  }));
}

/// Runs a store operation, and puts its own sentence on the wire.
///
/// **A refusal is the answer here, not a fault.** A name already taken, a name
/// that collides with a reserved role, a blank prompt, an Agent that is gone —
/// each arrives as an error carrying the sentence a reader can act on, and ACP's
/// default is to replace every one of them with "Internal error", which tells
/// nobody anything and is what the client would have to draw under a heading it
/// already wrote. So the message is carried onto the wire.
///
/// The class behind it is deliberately not imported: that would tie this layer to
/// a runtime implementation detail, and the sentence is the whole of what a client
/// may use.
async function inWords<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    if (message && message.trim().length > 0) {
      throw acp.RequestError.invalidParams(undefined, message);
    }
    throw error;
  }
}

function toAcpAgent(agent: TuiAgent): TuiAcpAgent {
  return {
    name: agent.name,
    displayName: agent.displayName || agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.avatar ? { avatar: agent.avatar } : {}),
    agentRole: agent.agentRole,
    creationSource: agent.creationSource,
  };
}

function toAcpDetail(detail: TuiAgentDetail): TuiAcpAgentDetail {
  return {
    agent: toAcpAgent(detail.agent),
    ...(detail.systemPrompt !== undefined ? { systemPrompt: detail.systemPrompt } : {}),
    ...(detail.persona !== undefined ? { persona: detail.persona } : {}),
  };
}

/// The three fields a listing request may carry. Every one is optional: no
/// parameters at all is the whole roster, which is what a management screen asks
/// for.
function parseListRequest(value: unknown): {
  search?: string;
  limit?: number;
  offset?: number;
} {
  if (value === undefined || value === null) return {};
  const record = requireRecord(value);
  const search = optionalText(record.search);
  const limit = optionalCount(record.limit);
  const offset = optionalCount(record.offset);
  return {
    ...(search !== undefined ? { search } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
}

function parseNameRequest(value: unknown): { name: string } {
  return { name: requireText(requireRecord(value).name, 'name') };
}

function parseDraftRequest(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return requireRecord(value);
}

function parseUpdateRequest(value: unknown): Record<string, unknown> & { name: string } {
  const record = requireRecord(value);
  return { ...record, name: requireText(record.name, 'name') };
}

/// The write half of a request, with blanks left out.
///
/// **An absent field means "leave it as stored"**, which is what a rewrite wants:
/// a screen that only changed the prompt must not blank the description. A
/// present-but-blank *name* is dropped rather than sent, so an empty box reads as
/// "leave it" instead of as a refusal the reader cannot see the reason for.
///
/// The free-text fields are kept even when empty, because clearing a prompt or a
/// description is something a reader may genuinely mean.
function draftOf(params: Record<string, unknown>): TuiAgentDraft {
  const draft: TuiAgentDraft = {};

  const name = optionalText(params.name);
  if (name !== undefined) draft.name = name;
  const displayName = optionalText(params.displayName);
  if (displayName !== undefined) draft.displayName = displayName;
  if (typeof params.description === 'string') draft.description = params.description;
  if (typeof params.avatar === 'string') draft.avatar = params.avatar;
  if (typeof params.systemPrompt === 'string') draft.systemPrompt = params.systemPrompt;
  if (typeof params.persona === 'string') draft.persona = params.persona;

  // The whole definition, where the client states one. It carries the model,
  // which the identity fields above cannot: an Agent with no model of its own
  // falls back to the runtime default, and the store refuses to save an Agent
  // whose model it cannot resolve.
  if (params.initialDefinition !== undefined && params.initialDefinition !== null) {
    const record = requireRecord(params.initialDefinition);
    const model = optionalText(record.model);
    const effort = optionalText(record.effort);
    draft.initialDefinition = {
      name: requireText(record.name, 'initialDefinition.name'),
      description: typeof record.description === 'string' ? record.description : '',
      systemPrompt: typeof record.systemPrompt === 'string' ? record.systemPrompt : '',
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
    };
  }

  return draft;
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

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
