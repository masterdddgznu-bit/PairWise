import { fail } from "./errors";

export class Consumers {
  private positions = new Map<string, Map<string, number>>();

  constructor(private readonly maxConsumers?: number) {}

  get size(): number {
    return this.positions.size;
  }

  has(name: string): boolean {
    return this.positions.has(name);
  }

  names(): string[] {
    return [...this.positions.keys()];
  }

  register(name: string, placements: Array<[string, number]>): void {
    if (this.positions.has(name)) {
      fail("CONSUMER_EXISTS", `consumer already registered: ${name}`);
    }
    if (this.maxConsumers !== undefined && this.positions.size >= this.maxConsumers) {
      fail("CONSUMER_CAPACITY", `consumer capacity ${this.maxConsumers} reached`);
    }
    this.positions.set(name, new Map(placements));
  }

  placeSubject(subject: string, initialVersion: number): void {
    for (const positions of this.positions.values()) {
      positions.set(subject, initialVersion);
    }
  }

  version(consumer: string, subject: string): number {
    const positions = this.positions.get(consumer);
    if (!positions) fail("NO_SUCH_CONSUMER", `unknown consumer: ${consumer}`);
    const version = positions.get(subject);
    if (version === undefined) {
      fail("NO_SUCH_SUBJECT", `consumer ${consumer} has no placement for subject: ${subject}`);
    }
    return version;
  }

  advance(consumer: string, subject: string, version: number): void {
    const positions = this.positions.get(consumer);
    if (!positions) fail("NO_SUCH_CONSUMER", `unknown consumer: ${consumer}`);
    positions.set(subject, version);
  }

  anyoneOn(subject: string, version: number): boolean {
    for (const positions of this.positions.values()) {
      if (positions.get(subject) === version) return true;
    }
    return false;
  }
}
