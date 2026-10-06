import { fail } from "./errors";

export class Consumers {
  private consumers = new Set<string>();
  private positions = new Map<string, Map<string, number>>();

  constructor(private readonly maxConsumers?: number) {}

  has(name: string): boolean {
    return this.consumers.has(name);
  }

  names(): string[] {
    return [...this.consumers];
  }

  get size(): number {
    return this.consumers.size;
  }

  register(name: string, subjects: string[]): void {
    if (this.consumers.has(name)) {
      fail("CONSUMER_EXISTS", `consumer "${name}" already registered`);
    }
    if (
      this.maxConsumers !== undefined &&
      this.consumers.size >= this.maxConsumers
    ) {
      fail("CONSUMER_CAPACITY", "consumer capacity reached");
    }
    this.consumers.add(name);
    const position = new Map<string, number>();
    for (const subject of subjects) {
      position.set(subject, 1);
    }
    this.positions.set(name, position);
  }

  attachSubject(subject: string): void {
    for (const position of this.positions.values()) {
      position.set(subject, 1);
    }
  }

  version(consumer: string, subject: string): number {
    const position = this.positions.get(consumer);
    if (position === undefined) {
      fail("CONSUMER_UNKNOWN", `consumer "${consumer}" is not registered`);
    }
    const version = position.get(subject);
    if (version === undefined) {
      fail("SUBJECT_UNKNOWN", `subject "${subject}" is not registered`);
    }
    return version;
  }

  advance(consumer: string, subject: string, version: number): void {
    const position = this.positions.get(consumer);
    if (position === undefined) {
      fail("CONSUMER_UNKNOWN", `consumer "${consumer}" is not registered`);
    }
    position.set(subject, version);
  }

  anyoneAt(subject: string, version: number): boolean {
    for (const position of this.positions.values()) {
      if (position.get(subject) === version) {
        return true;
      }
    }
    return false;
  }
}
