import {
  InvalidConfigError,
  InvalidPartyError,
  UnknownPartyError,
} from "./errors.js";

export class PartySet {
  private readonly ordered: string[];
  private readonly members: Set<string>;

  constructor(parties: string[]) {
    if (!Array.isArray(parties) || parties.length < 1) {
      throw new InvalidConfigError("parties must be a non-empty array");
    }
    for (const party of parties) {
      if (typeof party !== "string" || party.length === 0) {
        throw new InvalidConfigError("party names must be non-empty strings");
      }
    }
    const unique = new Set(parties);
    if (unique.size !== parties.length) {
      throw new InvalidConfigError("parties must not contain duplicates");
    }
    this.ordered = [...parties];
    this.members = unique;
  }

  get size(): number {
    return this.ordered.length;
  }

  list(): string[] {
    return [...this.ordered];
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
