import type { Effort, ModelId } from "@/types/events";

/// One model in a fan-out, with the effort it runs at.
export type FanOutTarget = { modelId: ModelId; effort: Effort | null };

/// One session a fan-out send will create.
export type FanOutRequest = {
  sessionId: string;
  model: ModelId;
  effort: Effort | null;
  /// Always true, and it is a fact rather than a default — see [`fanOutPlan`].
  useWorktree: true;
};

/// Adds or removes a model from the set.
///
/// Kept in the order they were picked, because that order is the order the
/// sessions are created in and therefore the order their rows land in the
/// sidebar. A reader who picks `glm` then `deepseek` gets a list that reads back
/// the way they built it.
export function toggleFanOut(current: ModelId[], modelId: ModelId): ModelId[] {
  return current.includes(modelId)
    ? current.filter((id) => id !== modelId)
    : [...current, modelId];
}

export function isFanOut(current: ModelId[], modelId: ModelId): boolean {
  return current.includes(modelId);
}

/// One send only fans out from two models up.
///
/// One is the ordinary send, with everything that already comes with it — the
/// parked child adopted, the reader's worktree toggle honoured. Above one it
/// cannot be, so the branch is explicit rather than a loop that happens to run
/// once.
export function canFanOut(current: ModelId[]): boolean {
  return current.length > 1;
}

/// The sessions a fan-out send creates.
///
/// **Every one of them takes a worktree, and there is no flag for that.** The
/// whole point is that these run at the same time, and several agents writing
/// into one checkout overwrite each other — the same reason `hz new` always
/// takes one. The composer's own toggle is therefore not consulted here, and
/// says so on screen while a fan-out is set.
///
/// The ids come from the caller: minting them is `crypto.randomUUID()` in the
/// webview, and a pure function cannot do that and stay testable.
export function fanOutPlan(targets: FanOutTarget[], ids: string[]): FanOutRequest[] {
  return targets.map((target, i) => ({
    sessionId: ids[i],
    model: target.modelId,
    effort: target.effort,
    useWorktree: true,
  }));
}
