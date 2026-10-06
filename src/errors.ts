export class VoteFinalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends VoteFinalError {}
export class InvalidArgError extends VoteFinalError {}
export class CapacityError extends VoteFinalError {}
export class StateError extends VoteFinalError {}
export class UnknownError extends VoteFinalError {}
