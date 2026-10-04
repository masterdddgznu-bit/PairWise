export class FanJoinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends FanJoinError {}
export class UnknownProducerError extends FanJoinError {}
export class InvalidSeqError extends FanJoinError {}
