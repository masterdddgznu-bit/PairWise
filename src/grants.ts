import type { Effect, Grant } from "./types.js";

type Key = string;

export class GrantStore {
  private readonly byKey = new Map<Key, Grant>();

  private key(subject: string, role: string, resource: string, effect: Effect): Key {
    return `${subject}\0${role}\0${resource}\0${effect}`;
  }

  put(g: Grant): void {
    this.byKey.set(this.key(g.subject, g.role, g.resource, g.effect), { ...g });
  }

  remove(subject: string, role: string, resource: string, effect: Effect = "allow"): boolean {
    return this.byKey.delete(this.key(subject, role, resource, effect));
  }

  getExact(
    subject: string,
    role: string,
    resource: string,
    effect: Effect = "allow",
  ): Grant | undefined {
    return this.byKey.get(this.key(subject, role, resource, effect));
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

  /** Starter: exact allow only. */
  matchesExactAllow(subject: string, role: string, resource: string): boolean {
    return this.byKey.has(this.key(subject, role, resource, "allow"));
  }
}
