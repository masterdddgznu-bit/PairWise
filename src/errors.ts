export class CutMeshError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CutMeshError {}
export class UnknownShardError extends CutMeshError {}
export class UnknownKeyError extends CutMeshError {}
export class NotOwnerError extends CutMeshError {}
export class InvalidMoveError extends CutMeshError {}
export class FenceError extends CutMeshError {}
export class InFlightError extends CutMeshError {}
export class UnknownTicketError extends CutMeshError {}
