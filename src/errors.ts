export class TwinBufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TwinBufError {}
export class InvalidKeyError extends TwinBufError {}
export class CapacityError extends TwinBufError {}
export class SwapBlockedError extends TwinBufError {}
