export class SealBagError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SealBagError {}
export class InvalidKeyError extends SealBagError {}
export class CapacityError extends SealBagError {}
export class UnknownEpochError extends SealBagError {}
