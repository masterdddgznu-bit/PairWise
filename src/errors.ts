export class SpanJoinError extends Error {
  constructor(message = "SpanJoin error") {
    super(message);
    this.name = "SpanJoinError";
  }
}
