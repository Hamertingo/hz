import { describe, expect, it } from "vitest";

import { containingProject, projectKey } from "@/lib/project";
import type { Project } from "@/types/events";

/// Only the three fields these functions read. `lastSelected` is a sort key and
/// nothing here sorts.
function project(path: string, space: string | null = null): Project {
  return { path, name: path.split("/").pop() ?? path, space, lastSelected: "" };
}

const WORKSPACE = project("/repos/hyze-cloud", "Work");
const API = project("/repos/hyze-cloud/api");
const OTHER = project("/repos/elsewhere");

describe("containingProject", () => {
  it("answers the project a path is", () => {
    expect(containingProject([WORKSPACE, OTHER], "/repos/elsewhere")).toBe(OTHER);
  });

  it("answers the project a path sits under", () => {
    expect(containingProject([WORKSPACE, OTHER], "/repos/hyze-cloud/api")).toBe(WORKSPACE);
    expect(containingProject([WORKSPACE], "/repos/hyze-cloud/api/src/deep")).toBe(WORKSPACE);
  });

  /// Longest wins, so a repository attached as its own project beats the
  /// workspace holding it — a reader who attached both meant the narrower one.
  /// First-match would answer differently depending on the file's order.
  it("takes the narrowest project when two nest", () => {
    for (const projects of [
      [WORKSPACE, API],
      [API, WORKSPACE],
    ]) {
      expect(containingProject(projects, "/repos/hyze-cloud/api")).toBe(API);
    }
  });

  /// **The comparison is on a path boundary, never a bare prefix.** A workspace
  /// called `api` must not claim a sibling called `api-v2`, and a `startsWith`
  /// without the separator says it does.
  it("does not match a sibling whose name merely starts the same", () => {
    const workspace = project("/repos/api");

    expect(containingProject([workspace], "/repos/api-v2")).toBeNull();
    expect(containingProject([workspace], "/repos/api2/src")).toBeNull();
    // And the path it does own still resolves, separator and all.
    expect(containingProject([workspace], "/repos/api/v2")).toBe(workspace);
  });

  it("answers nothing for a path no project contains", () => {
    expect(containingProject([WORKSPACE], "/tmp/scratch")).toBeNull();
    expect(containingProject([], "/repos/hyze-cloud")).toBeNull();
  });

  /// A worktree's directory is inside its repository, so it resolves up to the
  /// same project the repository does — which is what keeps a worktree session
  /// under the heading its project draws.
  it("resolves a worktree path to its repository's project", () => {
    expect(
      containingProject([WORKSPACE], "/repos/hyze-cloud/api/.claude/worktrees/one"),
    ).toBe(WORKSPACE);
  });
});

describe("projectKey", () => {
  /// **The backward-compatibility case.** Every session Dray had before
  /// workspaces existed recorded a path that is itself an attached project, so
  /// the key is that path and nothing about the sidebar moves.
  it("is the identity for a path that is its own project", () => {
    expect(projectKey([WORKSPACE, OTHER], "/repos/hyze-cloud")).toBe("/repos/hyze-cloud");
    expect(projectKey([WORKSPACE, OTHER], "/repos/elsewhere")).toBe("/repos/elsewhere");
  });

  /// **Root session and repository session are one project to the sidebar.**
  ///
  /// A session created at the workspace root records the root as its
  /// `project_path`; one created in `api` records the repository. Both must key
  /// to the same heading, or picking a repository would split the workspace into
  /// a heading per repository the moment anybody used it.
  it("groups a workspace's root session and its repository sessions together", () => {
    const projects = [WORKSPACE];

    expect(projectKey(projects, WORKSPACE.path)).toBe(WORKSPACE.path);
    for (const name of ["api", "web", "worker"]) {
      expect(projectKey(projects, `${WORKSPACE.path}/${name}`)).toBe(WORKSPACE.path);
    }
  });

  it("folds a repository under the workspace that holds it", () => {
    expect(projectKey([WORKSPACE], "/repos/hyze-cloud/api")).toBe("/repos/hyze-cloud");
    expect(projectKey([WORKSPACE], "/repos/hyze-cloud/worker")).toBe("/repos/hyze-cloud");
  });

  /// The fallback is the identity rather than `null`, so a session in a
  /// repository nobody attached is still grouped — under its own path, which is
  /// what an unattached project already does.
  it("falls back to the path itself when nothing contains it", () => {
    expect(projectKey([WORKSPACE], "/tmp/loose")).toBe("/tmp/loose");
    expect(projectKey([], "/tmp/loose")).toBe("/tmp/loose");
  });
});
