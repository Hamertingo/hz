import { agentIdFor, DEFAULT_LOOK } from "@/lib/agentDraft";
import { lookFor } from "@/lib/face";
import { MASCOT_COLORS } from "@/lib/mascots";
import { newAgent, type RosterAgent } from "@/lib/roster";

/// What `create_agent` asks the window for (`agent_tools.rs` emits it as `agent_create_request`).
export type AgentCreateRequest = { requestId: string; fromAgentId: string; name: string; role: string; job: string };

/// The agent an agent asked for, made the way the New agent dialog makes one: on its maker's CLI, folder, model,
/// stance and workspace, with a face and colour of its own. A string is why it cannot be made.
export function agentFromRequest(req: AgentCreateRequest, agents: readonly RosterAgent[]): RosterAgent | string {
  const maker = agents.find((a) => a.id === req.fromAgentId);
  if (!maker) return "the agent asking is not on the roster";
  const name = req.name.trim();
  if (!name) return "it needs a name";
  const id = agentIdFor(name, new Set(agents.map((a) => a.id)));
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return newAgent(
    {
      name,
      role: req.role.trim(),
      instructions: req.job.trim(),
      kind: DEFAULT_LOOK.kind,
      color: MASCOT_COLORS[Math.abs(h) % MASCOT_COLORS.length],
      shape: DEFAULT_LOOK.shape,
      look: lookFor(id),
      photo: null,
      harness: maker.harness,
      projectPath: maker.projectPath,
      modelId: maker.modelId,
      effort: maker.effort,
      permission: maker.permission,
      workspaceId: maker.workspaceId,
    },
    id,
  );
}
