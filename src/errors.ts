export class HlcoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends HlcoutError {}
export class InvalidArgError extends HlcoutError {}
export class CapacityError extends HlcoutError {}
export class StateError extends HlcoutError {}
export class UnknownError extends HlcoutError {}
