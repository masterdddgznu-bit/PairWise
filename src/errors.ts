export class MigRingError extends Error {
  constructor(message: string) { super(message); this.name = "MigRingError"; }
}
export class InvalidConfigError extends MigRingError {
  constructor(message: string) { super(message); this.name = "InvalidConfigError"; }
}
export class DuplicateNodeError extends MigRingError {
  constructor(id: string) { super(`duplicate node ${id}`); this.name = "DuplicateNodeError"; }
}
export class InvalidIdError extends MigRingError {
  constructor(message: string) { super(message); this.name = "InvalidIdError"; }
}
export class EmptyRingError extends MigRingError {
  constructor() { super("empty ring"); this.name = "EmptyRingError"; }
}
export class InvalidStateError extends MigRingError {
  constructor(message: string) { super(message); this.name = "InvalidStateError"; }
}
export class FeatureNotReadyError extends MigRingError {
  constructor(message: string) { super(message); this.name = "FeatureNotReadyError"; }
}
