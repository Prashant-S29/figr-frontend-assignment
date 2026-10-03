// Resolves detached sibling identities against one current parent using D5's ordered unique-only rules; DOM access and tree traversal stay elsewhere.
export interface MatchIdentity {
  token: string;
  dataKey: string | null;
  domId: string | null;
  strict: string;
  relaxed: string;
}

/** Matches remaining old and current siblings one-to-one by progressively weaker identity evidence. */
export function matchChildren(previous: readonly MatchIdentity[], current: readonly MatchIdentity[]): ReadonlyMap<string, string> {
  const matches = new Map<string, string>();
  const oldRemaining = new Map(previous.map(item => [item.token, item]));
  const newRemaining = new Map(current.map(item => [item.token, item]));
  const criteria: readonly (keyof Omit<MatchIdentity, "token">)[] = ["dataKey", "domId", "strict", "relaxed"];

  for (const criterion of criteria) {
    const oldGroups = group(oldRemaining.values(), criterion);
    const newGroups = group(newRemaining.values(), criterion);
    for (const [value, oldGroup] of oldGroups) {
      const newGroup = newGroups.get(value);
      if (!newGroup) continue;
      if (oldGroup.length !== 1 || newGroup.length !== 1) {
        for (const item of oldGroup) oldRemaining.delete(item.token);
        for (const item of newGroup) newRemaining.delete(item.token);
        continue;
      }
      const oldItem = oldGroup[0];
      const newItem = newGroup[0];
      matches.set(oldItem.token, newItem.token);
      oldRemaining.delete(oldItem.token);
      newRemaining.delete(newItem.token);
    }
  }
  return matches;
}

/** Groups nonempty evidence so absent keys cannot make unrelated siblings look identical. */
function group(items: Iterable<MatchIdentity>, criterion: keyof Omit<MatchIdentity, "token">): Map<string, MatchIdentity[]> {
  const groups = new Map<string, MatchIdentity[]>();
  for (const item of items) {
    const value = item[criterion];
    if (value === null || value === "") continue;
    const entries = groups.get(value) ?? [];
    entries.push(item);
    groups.set(value, entries);
  }
  return groups;
}
