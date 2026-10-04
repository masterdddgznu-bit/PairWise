export class EpochGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends EpochGateError {}
export class SealingError extends EpochGateError {}
export class UnknownTicketError extends EpochGateError {}
export class FenceError extends EpochGateError {}
export class InvalidEpochError extends EpochGateError {}
