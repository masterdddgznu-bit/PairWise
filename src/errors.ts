export class QuotaRingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaRingError";
  }
}
export class InvalidConfigError extends QuotaRingError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
export class InvalidTicketError extends QuotaRingError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTicketError";
  }
}
export class UnknownNodeError extends QuotaRingError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownNodeError";
  }
}
