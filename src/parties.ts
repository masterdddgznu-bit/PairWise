import { InvalidConfigError, InvalidPartyError, UnknownPartyError } from "./errors.js";

export class PartySet {
  private readonly order: readonly string[];
  private readonly members: ReadonlySet<string>;

  constructor(parties: string[]) {
    if (!Array.isArray(parties) || parties.length < 1) {
      throw new InvalidConfigError("parties must be a non-empty array");
    }
    for (const party of parties) {
      if (typeof party !== "string" || party.length === 0) {
        throw new InvalidConfigError("party names must be non-empty strings");
      }
    }
    const members = new Set(parties);
    if (members.size !== parties.length) {
      throw new InvalidConfigError("parties must be unique");
    }
    this.order = [...parties];
    this.members = members;
  }

  get size(): number {
    return this.order.length;
  }

  list(): string[] {
    return [...this.order];
  }

  assertValid(party: unknown): asserts party is string {
    if (typeof party !== "string" || party.length === 0) {
      throw new InvalidPartyError("party must be a non-empty string");
    }
    if (!this.members.has(party)) {
      throw new UnknownPartyError(`unknown party: ${party}`);
    }
  }
}
