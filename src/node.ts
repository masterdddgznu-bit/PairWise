export class TNode {
  readonly id: number;
  online = true;
  wantEnter = false;
  inCs = false;
  hasToken = false;

  constructor(id: number) {
    this.id = id;
  }
}
