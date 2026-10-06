export class KeyRollError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends KeyRollError {}

export class CapacityError extends KeyRollError {}

export class ConflictError extends KeyRollError {}

export class StateError extends KeyRollError {}

export class FenceError extends KeyRollError {}
