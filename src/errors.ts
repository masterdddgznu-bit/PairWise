export class AgeEvictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends AgeEvictError {}

export class InvalidKeyError extends AgeEvictError {}

export class CapacityError extends AgeEvictError {}
