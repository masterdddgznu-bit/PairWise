export class NestLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends NestLeaseError {}
export class UnknownNodeError extends NestLeaseError {}
export class InvalidAcquireError extends NestLeaseError {}
export class InvalidReleaseError extends NestLeaseError {}
export class FenceError extends NestLeaseError {}
export class UnknownTicketError extends NestLeaseError {}
