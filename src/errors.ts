export class GKError extends Error {
  constructor(message = "GK summary error") {
    super(message);
    this.name = "GKError";
  }
}
