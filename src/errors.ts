export class SlideWinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SlideWinError {}
export class InvalidIdError extends SlideWinError {}
export class DuplicateIdError extends SlideWinError {}
export class CapacityError extends SlideWinError {}
export class DebtBlockedError extends SlideWinError {}
export class QuarantineError extends SlideWinError {}
