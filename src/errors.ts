export class JoinLatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidConfigError extends JoinLatchError {}

export class InvalidPartyError extends JoinLatchError {}

export class UnknownPartyError extends JoinLatchError {}

export class DuplicateArriveError extends JoinLatchError {}

export class LateError extends JoinLatchError {}
