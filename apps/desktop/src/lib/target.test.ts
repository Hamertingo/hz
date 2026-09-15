import { describe, expect, it } from "vitest";

import {
  isWorkspaceRoot,
  ROOT_VALUE,
  sessionTargetPath,
  targetValue,
  valueToTarget,
} from "@/lib/target";
import type { RepoSummary } from "@/types/events";

const ROOT = "/repos/hyze-cloud";

function repo(name: string, branch = "main", dirty = 0): RepoSummary {
  return { path: `${ROOT}/${name}`, name, branch, dirty };
}

const WORKSPACE = [repo("api"), repo("web"), repo("worker")];
/// What `repos_under` answers for a project that is itself a repository.
const PLAIN = [repo("hyze-cloud")];

describe("sessionTargetPath", () => {
  /// **The root option's whole point**: the session runs where the project is,
  /// so one agent can reach `api`, `web` and `worker` from there.
  it("runs at the project root when the root is the target", () => {
    expect(sessionTargetPath(ROOT, null)).toBe(ROOT);
  });

  it("runs in the chosen repository when a repository is the target", () => {
    expect(sessionTargetPath(ROOT, `${ROOT}/api`)).toBe(`${ROOT}/api`);
    expect(sessionTargetPath(ROOT, `${ROOT}/web`)).toBe(`${ROOT}/web`);
  });

  /// A project that is itself a repository names no repository, so the two
  /// answers coincide — which is why every project Dray had before this sends
  /// exactly the directory it always did.
  it("is the project path for a single-repository project", () => {
    expect(sessionTargetPath(ROOT, null)).toBe(ROOT);
    expect(isWorkspaceRoot(PLAIN, null)).toBe(false);
  });

  it("is nothing at all before a project is picked", () => {
    expect(sessionTargetPath(null, null)).toBeNull();
  });
});

describe("isWorkspaceRoot", () => {
  /// A root is not a repository, so the branch read and the worktree toggle are
  /// both skipped for it — this predicate is what they are gated on.
  it("is true only for a workspace root", () => {
    expect(isWorkspaceRoot(WORKSPACE, null)).toBe(true);
  });

  /// Every repository target, which is where the branch picker, the checkout and
  /// the worktree anchor all stay exactly as Slices 0–2 left them.
  it("is false for a repository in a workspace", () => {
    for (const chosen of WORKSPACE) {
      expect(isWorkspaceRoot(WORKSPACE, chosen.path)).toBe(false);
    }
  });

  /// **The flicker this guard exists for.** An empty list is what the read looks
  /// like before it lands, so reading it as a root would clear the branch picker
  /// for one round trip on every project switch.
  it("is false while the list is still being read", () => {
    expect(isWorkspaceRoot([], null)).toBe(false);
  });

  /// A project that is itself a repository answers one entry — never a root,
  /// even though `repoPath` is null for it too.
  it("is false for a project that is one repository", () => {
    expect(isWorkspaceRoot(PLAIN, null)).toBe(false);
  });
});

describe("the radio value bridge", () => {
  /// The sentinel is local: it exists because Radix keys its radio group by
  /// string while the model's root is `null`, and it must not survive the trip.
  it("maps the root to the sentinel and back", () => {
    expect(targetValue(null)).toBe(ROOT_VALUE);
    expect(valueToTarget(ROOT_VALUE)).toBeNull();
  });

  /// A repository chooses its own path either way, so nothing about the existing
  /// repository rows moves.
  it("leaves a repository path untouched", () => {
    const path = `${ROOT}/api`;

    expect(targetValue(path)).toBe(path);
    expect(valueToTarget(path)).toBe(path);
  });

  /// **Selection and resume keep the distinction.** Round-tripping is what the
  /// picker does on every render, and a root that came back as `""` — or a
  /// repository that came back as `null` — would send the session somewhere
  /// nobody chose.
  it("round-trips every target without losing which kind it is", () => {
    for (const target of [null, `${ROOT}/api`, `${ROOT}/web`]) {
      expect(valueToTarget(targetValue(target))).toBe(target);
    }
  });

  /// The sentinel must never be mistaken for a path: it is empty, so it cannot
  /// name a directory, and `sessionTargetPath` is the only thing that reads a
  /// `repoPath` — which is `null`, never the sentinel, by the time it does.
  it("never lets the sentinel reach a path", () => {
    expect(ROOT_VALUE).toBe("");
    expect(sessionTargetPath(ROOT, valueToTarget(ROOT_VALUE))).toBe(ROOT);
  });
});
