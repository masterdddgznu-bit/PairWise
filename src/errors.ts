export class CredMuxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CredMuxError {}
export class UnknownStreamError extends CredMuxError {}
export class StreamClosedError extends CredMuxError {}
export class FenceError extends CredMuxError {}
export class StreamLimitError extends CredMuxError {}
export class InvalidRequestError extends CredMuxError {}
