export class QuorumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuorumError";
  }
}

export class InvalidQuorumError extends QuorumError {
  constructor(message = "Invalid quorum: require r + w > n") {
    super(message);
    this.name = "InvalidQuorumError";
  }
}

export class InsufficientReplicasError extends QuorumError {
  constructor(message = "Not enough healthy replicas") {
    super(message);
    this.name = "InsufficientReplicasError";
  }
}

export class StaleWriteError extends QuorumError {
  constructor(message = "Stale write rejected") {
    super(message);
    this.name = "StaleWriteError";
  }
}
