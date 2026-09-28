export class AbdRegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbdRegError";
  }
}
export class InvalidValueError extends AbdRegError {
  constructor() {
    super("value must be non-empty");
    this.name = "InvalidValueError";
  }
}
export class InvalidReplicaError extends AbdRegError {
  constructor(id: number) {
    super(`invalid replica id: ${id}`);
    this.name = "InvalidReplicaError";
  }
}
export class NotDoneError extends AbdRegError {
  constructor(opId: string) {
    super(`operation not done: ${opId}`);
    this.name = "NotDoneError";
  }
}
