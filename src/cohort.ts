import type { CohortState, Message } from "./types.js";

export class Cohort {
  readonly id: number;
  online = true;
  voteYes = true;
  state: CohortState = "idle";
  inbox: Message[] = [];

  constructor(id: number) {
    this.id = id;
  }
}
