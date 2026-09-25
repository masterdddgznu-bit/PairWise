export class LeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotOwnerError extends LeaseError {}
export class StaleTokenError extends LeaseError {}
export class LeaseNotFoundError extends LeaseError {}
export class AlreadyHeldError extends LeaseError {}
export class NotLeaderError extends LeaseError {}
