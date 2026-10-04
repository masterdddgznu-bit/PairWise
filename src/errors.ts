export class AckWinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends AckWinError {}
export class WindowFullError extends AckWinError {}
export class InvalidSeqError extends AckWinError {}
export class StaleEpochError extends AckWinError {}
export class ClosedError extends AckWinError {}
