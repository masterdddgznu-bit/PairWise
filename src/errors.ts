export class HoleBufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends HoleBufError {}

export class InvalidPushError extends HoleBufError {}

export class UnknownStreamError extends HoleBufError {}
