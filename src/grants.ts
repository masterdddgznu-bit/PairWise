import type { Grant } from "./types.js";

type Key = string;

/** Match specificity, or -1 when the pattern does not match. */
function matchSpecificity(pattern: string, resource: string): number {
  if (pattern === "*") return 0;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return resource.startsWith(prefix) ? prefix.length : -1;
  }
  return pattern === resource ? pattern.length : -1;
}

export class GrantStore {
  private readonly byKey = new Map<Key, Grant>();

  static keyOf(subject: string, role: string, resource: string): Key {
    return `${subject}\0${role}\0${resource}`;
  }

  put(g: Grant): void {
    this.byKey.set(GrantStore.keyOf(g.subject, g.role, g.resource), { ...g });
  }

  remove(subject: string, role: string, resource: string): boolean {
    return this.byKey.delete(GrantStore.keyOf(subject, role, resource));
  }

  getByKey(key: Key): Grant | undefined {
    const g = this.byKey.get(key);
    return g ? { ...g } : undefined;
  }

  removeByKey(key: Key): boolean {
    return this.byKey.delete(key);
  }

  listBySubject(subject: string, now: number): Grant[] {
    const out: Grant[] = [];
    for (const g of this.byKey.values()) {
      if (g.subject === subject && (g.expireAt === null || g.expireAt > now)) {
        out.push({ ...g });
      }
    }
    out.sort((a, b) =>
      a.role === b.role
        ? a.resource.localeCompare(b.resource)
        : a.role.localeCompare(b.role),
    );
    return out;
  }

  all(): Grant[] {
    return [...this.byKey.values()].map((g) => ({ ...g }));
  }

  /**
   * Best matching grant: longest (most specific) resource pattern wins;
   * on equal specificity deny beats allow.
   */
  bestMatch(
    subject: string,
    roles: Set<string>,
    resource: string,
    now: number,
  ): Grant | undefined {
    let best: Grant | undefined;
    let bestSpec = -1;
    for (const g of this.byKey.values()) {
      if (g.subject !== subject || !roles.has(g.role)) continue;
      if (g.expireAt !== null && g.expireAt <= now) continue;
      const spec = matchSpecificity(g.resource, resource);
      if (spec < 0) continue;
      if (
        spec > bestSpec ||
        (spec === bestSpec && best?.effect === "allow" && g.effect === "deny")
      ) {
        best = g;
        bestSpec = spec;
      }
    }
    return best;
  }

  snapshot(): Map<Key, Grant> {
    return new Map(this.byKey);
  }

  restore(snap: Map<Key, Grant>): void {
    this.byKey.clear();
    for (const [k, v] of snap) this.byKey.set(k, { ...v });
  }
}
