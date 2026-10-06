export class WalPipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends WalPipeError {}
export class InvalidArgError extends WalPipeError {}
export class CapacityError extends WalPipeError {}
export class FenceError extends WalPipeError {}
export class LeaseError extends WalPipeError {}
export class CreditError extends WalPipeError {}
