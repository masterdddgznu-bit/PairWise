export class Proc {
  readonly id: number;
  /** peer process ids (all ids except self); incoming/outgoing are symmetric */
  readonly peers: number[];
  state = 0;
  started = false;
  done = false;
  recordedState: number | null = null;
  /** from -> recording? */
  recording = new Map<number, boolean>();
  /** from -> recorded payloads */
  channelSnap = new Map<number, string[]>();

  constructor(id: number, peers: number[] = []) {
    this.id = id;
    this.peers = peers;
    for (const from of peers) {
      this.recording.set(from, false);
      this.channelSnap.set(from, []);
    }
  }

  /** Record local state and put every incoming channel into recording mode. */
  beginSnapshot(): void {
    this.started = true;
    this.done = false;
    this.recordedState = this.state;
    for (const from of this.peers) {
      this.recording.set(from, true);
      this.channelSnap.set(from, []);
    }
  }

  /** Stop recording the incoming channel from `from`; recorded entries stay. */
  closeIncoming(from: number): void {
    this.recording.set(from, false);
  }

  recordApp(from: number, payload: string): void {
    const list = this.channelSnap.get(from);
    if (list) {
      list.push(payload);
    } else {
      this.channelSnap.set(from, [payload]);
    }
  }

  isRecordingFrom(from: number): boolean {
    return this.recording.get(from) === true;
  }

  snapshotOf(from: number): string[] {
    return this.channelSnap.get(from) ?? [];
  }

  allIncomingClosed(): boolean {
    return this.peers.every((from) => !this.isRecordingFrom(from));
  }
}
