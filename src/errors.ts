export class OrderMuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends OrderMuxError {}
export class UnknownStreamError extends OrderMuxError {}
export class StreamClosedError extends OrderMuxError {}
export class FenceError extends OrderMuxError {}
export class InvalidSeqError extends OrderMuxError {}
export class StreamLimitError extends OrderMuxError {}
