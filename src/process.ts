export class Proc {
  readonly id: number;
  state = 0;
  started = false;
  done = false;
  recordedState: number | null = null;
  /** from -> recording? */
  recording = new Map<number, boolean>();
  /** from -> recorded payloads */
  channelSnap = new Map<number, string[]>();

  constructor(id: number) {
    this.id = id;
  }
}
