export class TenterHookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends TenterHookError {}
export class InvalidIdError extends TenterHookError {}
export class InvalidSpanError extends TenterHookError {}
export class InvalidGaleError extends TenterHookError {}
export class InvalidAmountError extends TenterHookError {}
export class CapacityError extends TenterHookError {}
export class UnknownIdError extends TenterHookError {}
