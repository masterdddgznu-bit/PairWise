export class TxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxError";
  }
}

export class DeadlockError extends Error {
  constructor(message = "Deadlock detected") {
    super(message);
    this.name = "DeadlockError";
  }
}

export class LockTimeoutError extends Error {
  constructor(message = "Lock timeout") {
    super(message);
    this.name = "LockTimeoutError";
  }
}
