export class UnknownClientError extends Error {
  constructor(message = "Unknown client") {
    super(message);
    this.name = "UnknownClientError";
  }
}

export class CircuitOpenError extends Error {
  constructor(message = "Circuit is open") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

export class CompactedError extends Error {
  constructor(message = "Sequence has been compacted") {
    super(message);
    this.name = "CompactedError";
  }
}
