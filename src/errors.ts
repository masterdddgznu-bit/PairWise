export class SkipError extends Error {
  constructor(message = "Skip error") {
    super(message);
    this.name = "SkipError";
  }
}
