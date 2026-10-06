export class DualViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends DualViewError {}

export class InvalidArgumentError extends DualViewError {}

export class SequenceError extends DualViewError {}

export class WatermarkError extends DualViewError {}

export class ConflictError extends DualViewError {}

export class CapacityError extends DualViewError {}

export class SnapshotError extends DualViewError {}
