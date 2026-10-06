export class HierEscError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends HierEscError {}
export class InvalidArgError extends HierEscError {}
export class CapacityError extends HierEscError {}
export class ConflictError extends HierEscError {}
export class StateError extends HierEscError {}
export class UnknownError extends HierEscError {}
