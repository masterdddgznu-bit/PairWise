export class GateBufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends GateBufError {}

export class InvalidIdError extends GateBufError {}

export class DuplicateIdError extends GateBufError {}

export class CapacityError extends GateBufError {}

export class GateStateError extends GateBufError {}
