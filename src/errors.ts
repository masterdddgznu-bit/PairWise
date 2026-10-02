export class AbaRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbaRuleError";
  }
}
export class InvalidProcessError extends AbaRuleError {
  constructor(id: number) {
    super(`invalid process id: ${id}`);
    this.name = "InvalidProcessError";
  }
}
export class BusyError extends AbaRuleError {
  constructor(message = "busy") {
    super(message);
    this.name = "BusyError";
  }
}
export class InvalidConfigError extends AbaRuleError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigError";
  }
}
