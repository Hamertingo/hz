import type { RepoSummary } from "@/types/events";

/// The radio value standing for the project root.
///
/// Radix's radio group is keyed by string and the model's root is `null`, so one
/// spelling has to bridge the two. It is **local to the picker**:
/// [`valueToTarget`] turns it back into `null` before the choice leaves, so it
/// never reaches a `cwd`, an index entry, a `git` invocation or the backend.
export const ROOT_VALUE = "";

/// The radio value for a target. `null` is the project root.
export function targetValue(repoPath: string | null): string {
  return repoPath ?? ROOT_VALUE;
}

/// The target a radio value names — the inverse of [`targetValue`], and the only
/// place the sentinel becomes `null` again.
export function valueToTarget(value: string): string | null {
  return value === ROOT_VALUE ? null : value;
}

/// Where a new session runs: the chosen repository, or the project itself.
///
/// **`null` is the project root, and that is the whole of the root's
/// representation.** There is no `Workspace` type and no stored root — the root
/// simply *is* `Project.path`, which is what the reader attached.
///
/// For a project that is itself a repository this answers that repository, which
/// is every project hz had before workspaces existed. For a workspace whose
/// root is chosen it answers the directory holding the repositories, which is
/// the workflow the root option exists for: one session reaching all of them.
export function sessionTargetPath(
  projectPath: string | null,
  repoPath: string | null,
): string | null {
  return repoPath ?? projectPath;
}

/// Whether the chosen target is a workspace's **root** rather than a repository
/// inside it.
///
/// A root is not a repository, so nothing git-shaped may be asked of it: no
/// branch read, no checkout, no worktree. Its `cwd` is still the project — that
/// is the point — and every git surface already answers "nothing here" for a
/// non-repo, so they hide themselves rather than lying.
///
/// **Written as `length > 1`, deliberately not `=== 0`.** An empty list is also
/// what the read looks like *before it lands*, and treating that as a root would
/// clear the branch picker for one round trip on every project switch — visible
/// as the picker flickering on a project that has branches to show. A list of
/// one is a project that is itself a repository, so it is never a workspace root
/// either; `repos_under` answers `[root]` for exactly that case.
export function isWorkspaceRoot(repos: RepoSummary[], repoPath: string | null): boolean {
  return repos.length > 1 && repoPath === null;
}
