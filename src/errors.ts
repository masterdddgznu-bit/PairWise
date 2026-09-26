export class CausalKvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CausalKvError";
  }
}

export class InvalidReplicaError extends CausalKvError {
  constructor(id: number) {
    super(`invalid replica id: ${id}`);
    this.name = "InvalidReplicaError";
  }
}
