export class ChainRepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainRepError";
  }
}
export class InvalidValueError extends ChainRepError {
  constructor() {
    super("value must be non-empty");
    this.name = "InvalidValueError";
  }
}
export class InvalidReplicaError extends ChainRepError {
  constructor(id: number) {
    super(`invalid replica id: ${id}`);
    this.name = "InvalidReplicaError";
  }
}
export class NoQuorumError extends ChainRepError {
  constructor() {
    super("no online replicas");
    this.name = "NoQuorumError";
  }
}
export class NotDoneError extends ChainRepError {
  constructor(opId: string) {
    super(`operation not done: ${opId}`);
    this.name = "NotDoneError";
  }
}
