export class ExactError extends Error {
  constructor(message = "Exact error") {
    super(message);
    this.name = "ExactError";
  }
}

export class JumpError extends Error {
  constructor(message = "Jump error") {
    super(message);
    this.name = "JumpError";
  }
}
