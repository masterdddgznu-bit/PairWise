export class Paxos1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Paxos1Error";
  }
}
export class InvalidValueError extends Paxos1Error {
  constructor() {
    super("value must be non-empty");
    this.name = "InvalidValueError";
  }
}
