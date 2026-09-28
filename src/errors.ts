export class ConflictError extends Error {
  readonly kind: "ww" | "skew";
  constructor(kind: "ww" | "skew", message?: string) {
    super(message ?? kind);
    this.name = "ConflictError";
    this.kind = kind;
  }
}

export class TxStateError extends Error {
  constructor(message = "Invalid transaction state") {
    super(message);
    this.name = "TxStateError";
  }
}
