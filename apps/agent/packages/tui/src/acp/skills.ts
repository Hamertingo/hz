import * as acp from '@agentclientprotocol/sdk';

import type { TuiSkill } from '../types/runtime-models.js';
import type { TuiAcpRuntime } from './runtime.js';

/// One Skill, as an ACP client is told about it.
///
/// **The agent's own row, unchanged.** A client draws a name, a sentence and a
/// switch, and all three are facts this runtime already holds — `enabled` included,
/// since a Skill switched off is one the catalog no longer contributes to the
/// model. `locationUri` rides along because the registry keys its disabled set by
/// it: a client that hands back only a *name* sets nothing the moment the Skill is
/// renamed or re-seeded, and it would fail silently.
export interface TuiAcpSkill {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly sourceKind?: string;
  readonly locationUri?: string;
}

/// The Skill roster, and the two things a client may do to one.
///
/// **These exist because the terminal's roster was not reachable from a client.**
/// The TUI lists Skills for its own composer and switches them from its own panel,
/// and an ACP client — which has no terminal — had `/skills` and nothing else: a
/// list in prose it would have had to parse, and no way to read or switch one. The
/// runtime already holds all three, so this is the seam rather than a second
/// implementation.
///
/// **The roster is the management view, not the runtime one.** `listSkills` answers
/// what the *model* is told about, and a Skill switched off is filtered out of it —
/// so a client built on that could switch a Skill off and then never see it again
/// to switch it back on. [`listAllSkills`](TuiAcpRuntime) keeps every Skill and
/// marks each one, which is the view a screen with switches in it needs.
export function registerTuiAcpSkillExtensions(options: {
  readonly app: acp.AgentApp;
  readonly runtime: TuiAcpRuntime;
  readonly resolveSession: (
    sessionId: string,
  ) => { readonly agentName?: string } | undefined;
}): void {
  const agentNameFor = (sessionId: string): string | undefined =>
    options.resolveSession(sessionId)?.agentName;

  options.app.onRequest('mcode/session/skills/list', parseListRequest, async ({ params }) => {
    const result = await options.runtime.listAllSkills(agentNameFor(params.sessionId));
    return {
      skills: (result?.skills ?? []).map(toAcpSkill),
      // Rides the answer rather than being assumed away: a client that drew a
      // count would otherwise be stating something it was never told.
      hasMore: result?.hasMore === true,
    };
  });

  options.app.onRequest('mcode/session/skills/read', parseReadRequest, async ({ params }) => ({
    name: params.name,
    // **`null`, not a throw.** A Skill deleted between the list and the press is
    // an answer a client can draw — "this one is gone" — where an error only says
    // that something went wrong, which is the wrong thing to put under a heading
    // that already named the Skill.
    text: (await options.runtime.readSkill(params.name, params.locationUri)) ?? null,
  }));

  options.app.onRequest(
    'mcode/session/skills/set_enabled',
    parseSetEnabledRequest,
    async ({ params }) => {
      // **`applied` is not `enabled`.** The registry answers nothing for a Skill it
      // does not recognise, and that is the honest reply rather than a throw — the
      // row the client pressed may have been deleted since it was drawn. A client
      // that read the flag for the new state would draw a switch that moved over a
      // Skill nobody changed.
      const applied = await options.runtime.setSkillEnabled(
        params.name,
        params.enabled,
        params.locationUri,
      );
      return { name: params.name, enabled: params.enabled, applied };
    },
  );
}

function toAcpSkill(skill: TuiSkill): TuiAcpSkill {
  const name = skill.name.trim();
  return {
    name,
    displayName: skill.displayName?.trim() || name,
    description: (skill.displayDescription ?? skill.description ?? '').trim(),
    // Absent reads as on, which is what the registry's own default is: a Skill
    // nobody has switched off is one the model is told about.
    enabled: skill.enabled !== false,
    ...(skill.sourceKind ? { sourceKind: skill.sourceKind } : {}),
    ...(skill.locationUri ? { locationUri: skill.locationUri } : {}),
  };
}

function parseListRequest(value: unknown): { sessionId: string } {
  const record = requireRecord(value);
  return { sessionId: requireText(record.sessionId, 'sessionId') };
}

function parseReadRequest(value: unknown): SkillTarget {
  return parseSkillTarget(value);
}

function parseSetEnabledRequest(value: unknown): SkillTarget & { enabled: boolean } {
  const enabled = requireRecord(value).enabled;
  if (typeof enabled !== 'boolean') {
    throw acp.RequestError.invalidParams(undefined, '`enabled` must be a boolean.');
  }
  return { ...parseSkillTarget(value), enabled };
}

interface SkillTarget {
  readonly sessionId: string;
  readonly name: string;
  readonly locationUri?: string;
}

/// Everything both Skill requests carry: which Session, which Skill, and the
/// location the row was drawn from.
function parseSkillTarget(value: unknown): SkillTarget {
  const record = requireRecord(value);
  return {
    sessionId: requireText(record.sessionId, 'sessionId'),
    name: requireText(record.name, 'name'),
    ...(record.locationUri === undefined
      ? {}
      : { locationUri: requireText(record.locationUri, 'locationUri') }),
  };
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
