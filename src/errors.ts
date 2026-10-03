export class ResvMeshError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends ResvMeshError {}

export class UnknownHolderError extends ResvMeshError {}

export class InvalidRequestError extends ResvMeshError {}

export class FenceError extends ResvMeshError {}

export class UnknownTicketError extends ResvMeshError {}
