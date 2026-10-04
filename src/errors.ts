export class RingBufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends RingBufError {}

export class UnknownConsumerError extends RingBufError {}

export class InvalidRequestError extends RingBufError {}
