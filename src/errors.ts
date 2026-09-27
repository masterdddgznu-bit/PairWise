export class SeqBufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeqBufError";
  }
}

export class InvalidSeqError extends SeqBufError {
  constructor(seq: number) {
    super(`invalid seq: ${seq}`);
    this.name = "InvalidSeqError";
  }
}

export class OutOfWindowError extends SeqBufError {
  constructor(seq: number) {
    super(`seq out of window: ${seq}`);
    this.name = "OutOfWindowError";
  }
}

export class DuplicateSeqError extends SeqBufError {
  constructor(seq: number) {
    super(`duplicate seq in window: ${seq}`);
    this.name = "DuplicateSeqError";
  }
}
