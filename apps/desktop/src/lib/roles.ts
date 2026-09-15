import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";

import { containingProject, projectKey } from "@/lib/project";
import type { Project, Role } from "@/types/events";

/// Every role there is, read once and shared by every surface that draws one.
///
/// Module-level rather than a hook's own state, for the reason `useDraft` and
/// `useAttachments` are: the session header reads the assigned role and the two
/// dialogs write the list, and a per-component copy would leave the header
/// naming a role the manager has just deleted.
let all: Role[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/// Reads the whole list and tells every mounted surface.
///
/// **A failed read is an empty list, not an error.** Every surface here draws
/// "no responsibility" for an empty list, which is the same thing a reader with
/// no roles sees — and a broken file must not take down a session header.
export async function loadRoles(): Promise<Role[]> {
  all = await invoke<Role[]>("all_roles").catch(() => []);
  loaded = true;
  emit();
  return all;
}

/// The role list, reading it on first use.
export function useRoles(): Role[] {
  const roles = useSyncExternalStore(
    subscribe,
    () => all,
    () => all,
  );

  useEffect(() => {
    if (!loaded) void loadRoles();
  }, []);

  return roles;
}

/// Creates or replaces a role. `null` where the write failed, so a form can stay
/// open on a failure rather than closing as though it had saved.
export async function saveRole(role: Role): Promise<Role[] | null> {
  try {
    all = await invoke<Role[]>("save_role", { role });
    loaded = true;
    emit();
    return all;
  } catch {
    return null;
  }
}

/// Removes a role **and every agent's reference to it**, which the backend does
/// in the same call — an agent left holding a deleted id is an agent whose
/// behaviour depends on whether a file still parses.
export async function deleteRole(id: string): Promise<Role[] | null> {
  try {
    all = await invoke<Role[]>("delete_role", { id });
    emit();
    return all;
  } catch {
    return null;
  }
}

/// The role a session carries, or `null`.
///
/// `null` covers three ordinary states at once, and each for its own reason: the
/// session has no role, the role was deleted out from under it, or the list has
/// not landed yet. All three mean the same thing to everything that draws it,
/// which is why they are one answer here rather than three at each call site.
export function roleById(roles: Role[], id: string | null | undefined): Role | null {
  if (!id) return null;
  return roles.find((role) => role.id === id) ?? null;
}

/// Whether a role is offered everywhere.
export function isGlobal(role: Role): boolean {
  return role.projectPath === null;
}

/// The roles a session in `projectPath` may be given — what its picker draws.
///
/// **The frontend half of `roles::list`, and the two must agree.** This decides
/// what is offered and the backend decides what a spawn applies, so a role that
/// shows up here and not there is exactly the failure the pair exists to
/// prevent. Both resolve the scope through the *containing attached project*
/// (`projectKey`), never through a bare path prefix, so a role scoped to a
/// workspace does not reach a repository the reader attached as a project of its
/// own.
///
/// A session with no project answers the global roles alone: a project role
/// cannot be offered for a project nobody has named.
export function offerableRoles(
  roles: Role[],
  projects: Project[],
  projectPath: string | null,
): Role[] {
  if (!projectPath) return roles.filter(isGlobal);

  const key = projectKey(projects, projectPath);

  return roles.filter((role) => role.projectPath === null || role.projectPath === key);
}

/// The manager's filter, as the segmented control reads it.
///
/// `null` is every role, `"global"` the unscoped ones, and any other string a
/// project's own path.
export type RoleFilter = null | "global" | string;

/// The rows a filter shows.
///
/// Deliberately not narrowed by the open project: the manager draws **every**
/// role whatever space or project is up, or it would hide exactly the rows
/// somebody opens it to file elsewhere.
export function filterRoles(roles: Role[], filter: RoleFilter): Role[] {
  if (filter === null) return roles;
  if (filter === "global") return roles.filter(isGlobal);
  return roles.filter((role) => role.projectPath === filter);
}

/// A role's scope as a row says it — `Global`, or the project's own name.
///
/// Takes the resolved name rather than the path, since the caller has the
/// attached projects and this does not: a path the reader never attached has no
/// name to show, and the caller falls back to its last segment.
export function roleScopeLabel(role: Role, projectName: string | null): string {
  if (isGlobal(role)) return "Global";
  return projectName ?? "Project";
}

/// The scope a responsibility made from a session should default to: the
/// attached project that contains the session, or global where nothing does.
///
/// **Attached only, and that is the load-bearing half.** A role scoped to a bare
/// path nothing attached is still offered by [`offerableRoles`] — its key falls
/// back to the path — but never *applied* by `roles::instructions_for`, which
/// resolves through the containing attached project and answers `None`
/// otherwise. Defaulting to such a path would mint a responsibility that shows
/// in the picker and never reaches a spawn, so global is the honest default and
/// the safe one.
export function defaultRoleScope(
  projects: Project[],
  projectPath: string | null,
): string | null {
  if (!projectPath) return null;
  return containingProject(projects, projectPath)?.path ?? null;
}

/// The responsibility a new session starts under: the project's own pick, else
/// the global one, else none.
///
/// **Present-and-null is a pick; absent is not.** A project explicitly set to
/// "None" has to be able to refuse a global default — otherwise clearing the
/// responsibility for one project would silently re-inherit it — so the two
/// states the map can hold are told apart here and nowhere else.
export function resolveDefaultRole(
  roleDefault: string | null,
  roleByProject: Record<string, string | null>,
  projectPath: string | null,
): string | null {
  if (projectPath) {
    const picked = roleByProject[projectPath];
    if (picked !== undefined) return picked;
  }
  return roleDefault;
}

/// The two records a pick writes, as one value to store.
///
/// With a project open the pick is that project's; with none it is the global
/// default — which is what makes "every chat starts with this" a thing a reader
/// can ask for, by picking it from the composer before a project is chosen.
export type RoleDefaults = {
  roleDefault: string | null;
  roleByProject: Record<string, string | null>;
};

export function writeDefaultRole(
  defaults: RoleDefaults,
  projectPath: string | null,
  roleId: string | null,
): RoleDefaults {
  if (!projectPath) return { ...defaults, roleDefault: roleId };
  return {
    ...defaults,
    roleByProject: { ...defaults.roleByProject, [projectPath]: roleId },
  };
}
