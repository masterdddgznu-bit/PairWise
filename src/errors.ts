export class IdemBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends IdemBoxError {}
export class InvalidArgError extends IdemBoxError {}
export class CapacityError extends IdemBoxError {}
export class StateError extends IdemBoxError {}
export class UnknownError extends IdemBoxError {}
