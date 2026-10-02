export class ReplicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplicError";
  }
}

export class InvalidQuorumError extends ReplicError {
  constructor(message = "Invalid write quorum") {
    super(message);
    this.name = "InvalidQuorumError";
  }
}

export class InsufficientReplicasError extends ReplicError {
  constructor(message = "Not enough healthy replicas for quorum") {
    super(message);
    this.name = "InsufficientReplicasError";
  }
}
