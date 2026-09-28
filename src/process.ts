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

  /** Open recording on every incoming channel (used by the initiator). */
  startRecording(incomingFrom: number[]): void {
    for (const from of incomingFrom) {
      this.recording.set(from, true);
      this.channelSnap.set(from, []);
    }
  }

  /** Begin the local snapshot: record state and open the remaining incoming channels. */
  begin(recordedState: number, incomingFrom: number[], markerFrom: number): void {
    this.started = true;
    this.recordedState = recordedState;
    for (const from of incomingFrom) {
      if (from === markerFrom) {
        // The marker channel is closed immediately with an empty snapshot.
        this.recording.set(from, false);
        this.channelSnap.set(from, []);
      } else {
        this.recording.set(from, true);
        this.channelSnap.set(from, []);
      }
    }
  }

  /** Record an application message arriving on an incoming channel that is still open. */
  recordApp(from: number, payload: string): void {
    if (this.started && this.recording.get(from) === true) {
      this.channelSnap.get(from)!.push(payload);
    }
  }

  /** Marker arrived from `from`: close recording for that channel. */
  closeChannel(from: number): void {
    this.recording.set(from, false);
  }

  isRecordingFrom(from: number): boolean {
    return this.started && this.recording.get(from) === true;
  }

  /** Local snapshot completes once every incoming channel has been closed by its marker. */
  checkDone(incomingFrom: number[]): boolean {
    if (!this.started) return false;
    this.done = incomingFrom.every((from) => this.recording.get(from) === false);
    return this.done;
  }

  /** Reset all snapshot bookkeeping so a new global snapshot can start. */
  reset(): void {
    this.started = false;
    this.done = false;
    this.recordedState = null;
    this.recording.clear();
    this.channelSnap.clear();
  }
}
