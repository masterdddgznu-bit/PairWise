export class DecayQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends DecayQError {}
export class InvalidIdError extends DecayQError {}
export class InvalidScoreError extends DecayQError {}
export class InvalidTenantError extends DecayQError {}
export class CapacityError extends DecayQError {}
export class UnknownIdError extends DecayQError {}
export class UnknownTenantError extends DecayQError {}
