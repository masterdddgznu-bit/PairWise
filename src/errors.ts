export class SlotFillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends SlotFillError {}
export class CapacityError extends SlotFillError {}
export class UnknownSlotError extends SlotFillError {}
export class UnknownItemError extends SlotFillError {}
