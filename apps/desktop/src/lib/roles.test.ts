import { describe, expect, it } from "vitest";

import {
  filterRoles,
  offerableRoles,
  resolveDefaultRole,
  roleById,
  roleScopeLabel,
  defaultRoleScope,
  writeDefaultRole,
} from "@/lib/roles";
import type { Project, Role } from "@/types/events";

const WORKSPACE = "/repos/hyze-cloud";
const OTHER_PROJECT = "/repos/other";

function project(path: string): Project {
  return { path, name: path.split("/").pop() ?? path, space: null, lastSelected: "" };
}

function role(id: string, scope: string | null = null): Role {
  return { id, name: id, instructions: "Do the thing.", projectPath: scope };
}

const ORCHESTRATOR = role("orchestrator", WORKSPACE);
const QA = role("qa", null);
const OTHER = role("other", OTHER_PROJECT);
const ALL = [QA, ORCHESTRATOR, OTHER];

const PROJECTS = [project(WORKSPACE), project(OTHER_PROJECT)];

describe("roleById", () => {
  it("answers the role a session carries", () => {
    expect(roleById(ALL, "orchestrator")).toBe(ORCHESTRATOR);
  });

  /// **A session with no role**, which is every session that existed before
  /// roles did — and the answer everything that draws it needs.
  it("answers nothing for a session carrying no role", () => {
    expect(roleById(ALL, null)).toBeNull();
    expect(roleById(ALL, undefined)).toBeNull();
  });

  /// **An index entry written before the field existed** reads as `undefined`,
  /// which is the same answer as no role rather than a failure to look one up.
  it("answers nothing for an entry predating the field", () => {
    const old: { roleId?: string } = {};
    expect(roleById(ALL, old.roleId)).toBeNull();
  });

  /// A reference whose role has since been deleted resolves to nothing rather
  /// than to a broken row — delete clears the reference too, so this is the
  /// belt to that pair of braces.
  it("answers nothing for a role that is gone", () => {
    expect(roleById(ALL, "deleted")).toBeNull();
  });
});

describe("offerableRoles", () => {
  /// A global role reaches every session, whatever project it is in.
  it("offers a global role everywhere", () => {
    for (const path of [WORKSPACE, `${WORKSPACE}/api`, OTHER_PROJECT]) {
      expect(offerableRoles(ALL, PROJECTS, path)).toContain(QA);
    }
  });

  /// **A project role reaches a session in that project *and* in any
  /// repository under it** — the composition with the root/workspace target the
  /// picker offers, where a session runs in `hyze-cloud/api` while the reader
  /// filed `hyze-cloud`.
  it("offers a project role to its own project and to repositories under it", () => {
    expect(offerableRoles(ALL, PROJECTS, WORKSPACE)).toContain(ORCHESTRATOR);
    expect(offerableRoles(ALL, PROJECTS, `${WORKSPACE}/api`)).toContain(ORCHESTRATOR);
  });

  /// And no further. A role filed under one project must not be offered in
  /// another — that is the whole of what filing it bought.
  it("withholds a project role from every other project", () => {
    const offered = offerableRoles(ALL, PROJECTS, OTHER_PROJECT);

    expect(offered).not.toContain(ORCHESTRATOR);
    expect(offered).toContain(OTHER);
  });

  /// **A repository attached as its own project is not the workspace that
  /// contains it.** The scope resolves through the *containing attached
  /// project*, so attaching `hyze-cloud/api` separately means a role filed on
  /// `hyze-cloud` is not offered for a session there — which is what the reader
  /// meant by filing it on the workspace and then attaching the repository.
  ///
  /// This is the one case a bare path prefix gets wrong, and the reason both
  /// sides of the bridge resolve through `projectKey` instead.
  it("withholds a workspace's role from a repository attached on its own", () => {
    const nested = project(`${WORKSPACE}/api`);
    const offered = offerableRoles(ALL, [project(WORKSPACE), nested], `${WORKSPACE}/api`);

    expect(offered).not.toContain(ORCHESTRATOR);
    expect(offered).toContain(QA);
  });

  /// A session with no project gets the global roles alone: a project role
  /// cannot be offered for a project nobody has named.
  it("offers only global roles with no project at all", () => {
    expect(offerableRoles(ALL, PROJECTS, null)).toEqual([QA]);
  });
});

describe("filterRoles", () => {
  it("shows every role under the first filter", () => {
    expect(filterRoles(ALL, null)).toEqual(ALL);
  });

  it("shows the global roles alone", () => {
    expect(filterRoles(ALL, "global")).toEqual([QA]);
  });

  /// A project's filter is its own path, so two projects never share a row.
  it("shows one project's roles alone", () => {
    expect(filterRoles(ALL, WORKSPACE)).toEqual([ORCHESTRATOR]);
    expect(filterRoles(ALL, OTHER_PROJECT)).toEqual([OTHER]);
  });

  it("shows nothing for a project with no roles of its own", () => {
    expect(filterRoles(ALL, "/repos/nothing")).toEqual([]);
  });
});

describe("roleScopeLabel", () => {
  it("names a global role as global", () => {
    expect(roleScopeLabel(QA, null)).toBe("Global");
  });

  it("names a project role by its project", () => {
    expect(roleScopeLabel(ORCHESTRATOR, "hyze-cloud")).toBe("hyze-cloud");
  });

  /// A role scoped to a path the reader has since detached has no name to show,
  /// and says so rather than drawing an empty row.
  it("falls back rather than drawing nothing", () => {
    expect(roleScopeLabel(ORCHESTRATOR, null)).toBe("Project");
  });
});

describe("defaultRoleScope", () => {
  it("defaults to the attached project that contains the session", () => {
    expect(defaultRoleScope(PROJECTS, WORKSPACE)).toBe(WORKSPACE);
    expect(defaultRoleScope(PROJECTS, `${WORKSPACE}/api`)).toBe(WORKSPACE);
  });

  /// **The trap the helper exists for.** A responsibility filed on a bare path
  /// nothing attached is offered but never applied, so the default is global
  /// rather than the path.
  it("is global where nothing attached contains the session", () => {
    expect(defaultRoleScope(PROJECTS, "/repos/unattached")).toBeNull();
    expect(defaultRoleScope(PROJECTS, null)).toBeNull();
  });

  /// Longest wins, the same rule `containingProject` states: a repository
  /// attached on its own beats the workspace that also contains it.
  it("resolves to the narrowest attached project", () => {
    const nested = project(`${WORKSPACE}/api`);
    expect(defaultRoleScope([project(WORKSPACE), nested], `${WORKSPACE}/api`)).toBe(
      nested.path,
    );
  });
});

describe("resolveDefaultRole", () => {
  it("uses the project's own pick where it has one", () => {
    expect(resolveDefaultRole("global", { [WORKSPACE]: "orchestrator" }, WORKSPACE)).toBe(
      "orchestrator",
    );
  });

  /// A project that has never been picked inherits the global default, which is
  /// the whole of what "set it globally" buys.
  it("falls back to the global default", () => {
    expect(resolveDefaultRole("global", {}, WORKSPACE)).toBe("global");
  });

  /// **The reason the map is not `Record<string, string>`.** A project set to
  /// None refuses a global default rather than re-inheriting it — otherwise
  /// clearing one project's responsibility would do nothing.
  it("lets a project refuse a global default", () => {
    expect(resolveDefaultRole("global", { [WORKSPACE]: null }, WORKSPACE)).toBeNull();
  });

  it("is nothing when neither is set", () => {
    expect(resolveDefaultRole(null, {}, WORKSPACE)).toBeNull();
    expect(resolveDefaultRole(null, {}, null)).toBeNull();
  });

  it("uses the global default with no project open", () => {
    expect(resolveDefaultRole("global", { [WORKSPACE]: "orchestrator" }, null)).toBe(
      "global",
    );
  });
});

describe("writeDefaultRole", () => {
  const none = { roleDefault: null, roleByProject: {} };

  it("files a pick under the open project", () => {
    expect(writeDefaultRole(none, WORKSPACE, "orchestrator")).toEqual({
      roleDefault: null,
      roleByProject: { [WORKSPACE]: "orchestrator" },
    });
  });

  /// With no project open the pick *is* the global default, which is how "every
  /// chat starts with this" is asked for.
  it("writes the global default with no project", () => {
    expect(writeDefaultRole(none, null, "qa")).toEqual({
      roleDefault: "qa",
      roleByProject: {},
    });
  });

  it("records None as a pick rather than a missing key", () => {
    const written = writeDefaultRole(
      { roleDefault: "global", roleByProject: {} },
      WORKSPACE,
      null,
    );
    expect(written.roleByProject).toEqual({ [WORKSPACE]: null });
    expect(resolveDefaultRole(written.roleDefault, written.roleByProject, WORKSPACE)).toBeNull();
  });

  it("does not mutate what it is given", () => {
    const before = { roleDefault: null, roleByProject: {} };
    writeDefaultRole(before, WORKSPACE, "orchestrator");
    expect(before.roleByProject).toEqual({});
  });
});
