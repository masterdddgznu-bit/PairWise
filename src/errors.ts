export class EpochGcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpochGcError";
  }
}

export class InvalidThreadError extends EpochGcError {
  constructor(id: number) {
    super(`invalid thread id: ${id}`);
    this.name = "InvalidThreadError";
  }
}

export class AlreadyPinnedError extends EpochGcError {
  constructor(id: number) {
    super(`thread already pinned: ${id}`);
    this.name = "AlreadyPinnedError";
  }
}

export class DuplicateRetireError extends EpochGcError {
  constructor(id: string) {
    super(`duplicate retire id: ${id}`);
    this.name = "DuplicateRetireError";
  }
}
