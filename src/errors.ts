export class RaftVoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RaftVoteError";
  }
}
export class InvalidNodeError extends RaftVoteError {
  constructor(id: number) {
    super(`invalid node id: ${id}`);
    this.name = "InvalidNodeError";
  }
}
