export class WaitGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends WaitGateError {}
export class InvalidWaitError extends WaitGateError {}
export class UnknownWaitError extends WaitGateError {}
export class FenceError extends WaitGateError {}
