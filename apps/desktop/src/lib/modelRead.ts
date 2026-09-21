/// Whether the composer's model read has to wait before it goes out.
///
/// **A park answers the same question, so the read lets one that is coming go
/// first.** `prepare_session` runs the whole handshake, and the agent states its
/// model list on `session/new` — so once a park has landed, the backend's cache
/// already holds the answer and `list_models` is free. Reading first instead boots
/// a **second** child beside the park, on the same CPU, and leaves a session of
/// its own behind in mcode's store for the reader to find in their TUI history.
/// Measured on the shipped bundle: 1.0s to answer `initialize` per child against
/// ~0.02s for every session after the first on a child that has booted — so the
/// child is the whole of the cost, and two of them at launch *is* the launch.
///
/// Three answers, and each is one of the states this can be in:
///
/// - **A selected session releases it.** A park is only ever made for a prompt
///   that will create one, so there is nothing to wait for.
/// - **An unsettled project list holds it**, and that is the load-bearing half:
///   the list arrives a round trip after mount, and until it does there is no
///   target to park for, so "no park is coming" cannot yet be told from "not
///   asked yet". Without this the read went out on the first frame of every
///   launch, which is what the old path did — probe and park both.
/// - **With a target and no landing yet, it waits**; with no target it goes,
///   because a picker opened with no session anywhere is the one case where the
///   backend's own probe is the only thing that can answer.
export function modelsWaiting(wait: {
  selectedSessionId: string | null;
  projectsSettled: boolean;
  targetPath: string | null;
  parkLanded: boolean;
}): boolean {
  if (wait.selectedSessionId !== null) return false;
  if (!wait.projectsSettled) return true;
  return wait.targetPath !== null && !wait.parkLanded;
}
