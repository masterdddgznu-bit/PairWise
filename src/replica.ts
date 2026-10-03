import { InvalidConfigError } from "./errors.js";

export class ReplicaSet {
  private readonly ids: string[];
  private readonly members: Set<string>;

  constructor(replicas: string[]) {
    if (!Array.isArray(replicas) || replicas.length === 0) {
      throw new InvalidConfigError("replicas must be a non-empty array");
    }
    const members = new Set<string>();
    for (const id of replicas) {
      if (typeof id !== "string" || id.length === 0) {
        throw new InvalidConfigError("replica ids must be non-empty strings");
      }
      if (members.has(id)) {
        throw new InvalidConfigError(`duplicate replica: ${id}`);
      }
      members.add(id);
    }
    this.members = members;
    this.ids = [...replicas].sort();
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
