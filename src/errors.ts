export class CoolShipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends CoolShipError {}
export class InvalidIdError extends CoolShipError {}
export class InvalidSpanError extends CoolShipError {}
export class InvalidGravityError extends CoolShipError {}
export class InvalidAmountError extends CoolShipError {}
export class CapacityError extends CoolShipError {}
export class UnknownIdError extends CoolShipError {}
