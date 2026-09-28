export class Replica {
  readonly id: number;
  online = true;
  value: string | null = null;
  seq = 0;
  constructor(id: number) { this.id = id; }
}
