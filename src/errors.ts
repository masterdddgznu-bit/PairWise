export class LagJoinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends LagJoinError {}

export class InvalidEventError extends LagJoinError {}
