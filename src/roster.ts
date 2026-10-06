import { CapacityError, InvalidArgError, UnknownError } from "./errors.js";

export class Roster {
  private order: string[] = [];
  private members = new Set<string>();

  constructor(private readonly max: number) {}

  has(participant: string): boolean {
    return this.members.has(participant);
  }

  register(participant: string): void {
    if (typeof participant !== "string" || participant.length === 0) {
      throw new InvalidArgError("participant must be a non-empty string");
    }
    if (this.members.has(participant)) {
      throw new InvalidArgError(`participant already registered: ${participant}`);
    }
    if (this.order.length >= this.max) {
      throw new CapacityError("participant capacity reached");
    }
    this.members.add(participant);
    this.order.push(participant);
  }

  unregister(participant: string): void {
    if (!this.members.has(participant)) {
      throw new UnknownError(`unknown participant: ${participant}`);
    }
    this.members.delete(participant);
    this.order = this.order.filter((p) => p !== participant);
  }

  removeKnown(participant: string): void {
    this.members.delete(participant);
    this.order = this.order.filter((p) => p !== participant);
  }

  addKnown(participant: string): void {
    if (!this.members.has(participant)) {
      this.members.add(participant);
      this.order.push(participant);
    }
  }

  list(): string[] {
    return [...this.order];
  }
}
