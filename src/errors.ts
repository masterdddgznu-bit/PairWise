export class GenError extends Error {
  constructor(message = "Gen hub error") {
    super(message);
    this.name = "GenError";
  }
}

export class StaleGenError extends Error {
  constructor(message = "Stale generation") {
    super(message);
    this.name = "StaleGenError";
  }
}
