export class LateWinError extends Error {
  constructor(message = "LateWin error") {
    super(message);
    this.name = "LateWinError";
  }
}
