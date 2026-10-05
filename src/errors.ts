export class SealEpochError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SealEpochError {}
export class InvalidStreamError extends SealEpochError {}
export class InvalidAppendError extends SealEpochError {}
export class UnknownEpochError extends SealEpochError {}
export class InvalidSealError extends SealEpochError {}
