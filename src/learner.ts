export class Learner {
  private value: string | null = null;
  private ballot = 0;
  chosenValue(): string | null { return this.value; }
  chosenBallot(): number { return this.ballot; }
  isChosen(): boolean { return this.value !== null; }
  noteChosen(value: string, ballot: number): void {
    if (this.value === null) {
      this.value = value;
      this.ballot = ballot;
    }
  }
}
