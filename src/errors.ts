export class FairLeadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends FairLeadError {}
export class InvalidIdError extends FairLeadError {}
export class InvalidSpanError extends FairLeadError {}
export class InvalidHaulError extends FairLeadError {}
export class InvalidAmountError extends FairLeadError {}
export class CapacityError extends FairLeadError {}
export class UnknownIdError extends FairLeadError {}
