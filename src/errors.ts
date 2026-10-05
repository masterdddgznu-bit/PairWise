export class HlcGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends HlcGateError {}

export class InvalidNodeError extends HlcGateError {}

export class InvalidMessageError extends HlcGateError {}

export class UnknownMessageError extends HlcGateError {}
