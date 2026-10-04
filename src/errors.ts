export class GroupFifoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends GroupFifoError {}
export class InvalidMessageError extends GroupFifoError {}
export class UnknownReceiptError extends GroupFifoError {}
export class ReceiptFenceError extends GroupFifoError {}
