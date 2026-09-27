import type { Effect, Grant } from "./types.js";

type Key = string;

export function grantKey(g: Pick<Grant, "subject" | "role" | "resource" | "effect">): Key {
  return `${g.subject}\0${g.role}\0${g.resource}\0${g.effect}`;
}

/** `*` or a suffix wildcard of the form `prefix/*`. */
export function isValidResourcePattern(resource: string): boolean {
  if (!resource.includes("*")) return true;
  if (resource === "*") return true;
  return resource.endsWith("/*") && !resource.slice(0, -2).includes("*");
}

function wildcardPrefix(resource: string): string | null {
  if (!resource.endsWith("*")) return null;
  if (resource === "*") return "";
  if (isValidResourcePattern(resource)) return resource.slice(0, -1); // includes trailing '/'
  return null;
}

/** True when a grant on `pattern` applies to the concrete `resource`. */
export function resourceMatches(pattern: string, resource: string): boolean {
  if (pattern === resource) return true;
  const prefix = wildcardPrefix(pattern);
  if (prefix === null) return false;
  return resource.startsWith(prefix);
}

/** Longer matching prefix is more specific; exact resources beat wildcards. */
export function specificity(pattern: string): number {
  const prefix = wildcardPrefix(pattern);
  if (prefix === null) return Number.MAX_SAFE_INTEGER;
  return prefix.length;
}

export class GrantStore {
  private readonly byKey = new Map<Key, Grant>();

  put(g: Grant): void {
    this.byKey.set(grantKey(g), { ...g });
  }

  remove(subject: string, role: string, resource: string, effect: Effect = "allow"): boolean {
    return this.byKey.delete(
      grantKey({ subject, role, resource, effect }),
    );
  }

  getExact(
    subject: string,
    role: string,
    resource: string,
    effect: Effect = "allow",
  ): Grant | undefined {
    return this.byKey.get(grantKey({ subject, role, resource, effect }));
  }

  listBySubject(subject: string): Grant[] {
    const out: Grant[] = [];
    for (const g of this.byKey.values()) {
      if (g.subject === subject) out.push({ ...g });
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

  getByKey(key: Key): Grant | undefined {
    const g = this.byKey.get(key);
    return g ? { ...g } : undefined;
  }

  deleteKey(key: Key): boolean {
    return this.byKey.delete(key);
  }

  snapshot(): Map<Key, Grant> {
    return new Map(this.byKey);
  }

  restore(snapshot: Map<Key, Grant>): void {
    this.byKey.clear();
    for (const [key, grant] of snapshot) this.byKey.set(key, { ...grant });
  }
}
