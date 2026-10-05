export class GenBarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends GenBarError {}
export class InvalidPartyError extends GenBarError {}
export class DuplicateArriveError extends GenBarError {}
export class UnknownGenerationError extends GenBarError {}
