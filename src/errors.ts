export class PartWinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends PartWinError {}
export class InvalidOpenError extends PartWinError {}
export class UnknownAssemblyError extends PartWinError {}
export class CapacityError extends PartWinError {}
export class KeyBusyError extends PartWinError {}
