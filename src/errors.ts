export class KeyFlushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends KeyFlushError {}
export class InvalidKeyError extends KeyFlushError {}
export class CapacityError extends KeyFlushError {}
export class UnknownKeyError extends KeyFlushError {}
