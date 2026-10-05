export class MergeWinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends MergeWinError {}
export class InvalidKeyError extends MergeWinError {}
export class InvalidVersionError extends MergeWinError {}
export class CapacityError extends MergeWinError {}
export class BarrierError extends MergeWinError {}
