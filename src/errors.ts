export class RankQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends RankQError {}
export class InvalidEnqueueError extends RankQError {}
export class CapacityError extends RankQError {}
export class UnknownItemError extends RankQError {}
