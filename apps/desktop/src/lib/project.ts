import type { Project } from "@/types/events";

/// The attached project a path belongs to: the longest attached path that
/// contains it, or `null` when nothing does.
///
/// **Longest wins, and that is the whole rule.** A repository attached as its
/// own project beats the workspace that holds it, because a reader who attached
/// both meant the narrower one — and the alternative, first-match, would answer
/// differently depending on the order `projects.json` happened to be in.
///
/// The comparison is on a **path boundary**, never a bare prefix: `/repos/api-v2`
/// is not inside `/repos/api`, and a `startsWith` without the separator says it
/// is. That is not hypothetical — it is the same class of mistake `apps.rs`
/// documents for bundle names, where `Cloudflare WARP.app` matched as `Warp.app`.
///
/// A path that is itself an attached project answers that project, so every
/// session hz had before workspaces existed reads exactly as it did.
export function containingProject(projects: Project[], path: string): Project | null {
  let best: Project | null = null;

  for (const project of projects) {
    if (path !== project.path && !path.startsWith(`${project.path}/`)) continue;
    if (!best || project.path.length > best.path.length) best = project;
  }

  return best;
}

/// What a session's project should be *grouped under* — the attached project
/// that contains it, or its own path when nothing does.
///
/// Split from [`containingProject`] because the two callers want different
/// halves: the sidebar wants a key it can compare strings on, and the space
/// filter wants the tag. Both read the same rule, which is the point — the list,
/// the chord walk and the space narrowing disagreeing about where a session
/// lives is the defect `sortSessions` exists to prevent.
///
/// The fallback is the identity, which is the single-repo case and therefore
/// every project that predates workspaces: a session under a repository nobody
/// attached is grouped under its own path, exactly as before.
export function projectKey(projects: Project[], path: string): string {
  return containingProject(projects, path)?.path ?? path;
}
