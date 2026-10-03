import { InvalidConfigError } from "./errors.js";

export class ReplicaSet {
  private readonly ids: string[];
  private readonly members: Set<string>;

  constructor(replicas: string[]) {
    if (!Array.isArray(replicas) || replicas.length === 0) {
      throw new InvalidConfigError("replicas must be a non-empty array");
    }
    for (const r of replicas) {
      if (typeof r !== "string" || r.length === 0) {
        throw new InvalidConfigError("replica ids must be non-empty strings");
      }
    }
    if (new Set(replicas).size !== replicas.length) {
      throw new InvalidConfigError("replicas must be unique");
    }
    this.ids = [...replicas].sort();
    this.members = new Set(this.ids);
  }

  has(id: string): boolean {
    return this.members.has(id);
  }

  sorted(): string[] {
    return [...this.ids];
  }

  primaryOf(view: number): string {
    return this.ids[(view - 1) % this.ids.length];
  }

  size(): number {
    return this.ids.length;
  }
}
