export class DedupTtlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DedupTtlError";
  }
}

export class InvalidKeyError extends DedupTtlError {
  constructor() {
    super("key must be non-empty");
    this.name = "InvalidKeyError";
  }
}

export class InvalidConfigError extends DedupTtlError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
