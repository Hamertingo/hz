/// The names to draw for a set of agents. Two agents may share a name in
/// storage; the sidebar must still tell them apart, so a repeat gets its role,
/// or a number where the role does not separate them. Storage is never renamed.
export function displayNames(agents: readonly { id: string; name: string; role: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const byName = new Map<string, typeof agents[number][]>();
  for (const a of agents) byName.set(a.name, [...(byName.get(a.name) ?? []), a]);

  for (const [name, group] of byName) {
    if (group.length === 1) {
      out.set(group[0].id, name);
      continue;
    }
    const roles = group.map((a) => a.role.trim());
    const separates = roles.every((r) => r) && new Set(roles).size === roles.length;
    for (const [i, a] of group.entries()) out.set(a.id, separates ? `${name} · ${roles[i]}` : `${name} (${i + 1})`);
  }
  return out;
}
