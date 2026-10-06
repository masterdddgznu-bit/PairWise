export class CausWatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CausWatError {}
export class InvalidArgError extends CausWatError {}
export class CapacityError extends CausWatError {}
export class ConflictError extends CausWatError {}
export class StateError extends CausWatError {}
export class UnknownError extends CausWatError {}
