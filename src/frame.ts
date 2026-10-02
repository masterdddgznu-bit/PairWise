import type { Frame } from "./types.js";

/** Create an empty frame. */
export function emptyFrame(): Frame {
  return { key: null, value: 0, ref: false };
}

/** Deep-copy frames array; unoccupied slots are normalized to empty frames. */
export function copyFrames(frames: readonly Frame[]): Frame[] {
  return frames.map((frame) =>
    frame.key === null
      ? emptyFrame()
      : { key: frame.key, value: frame.value, ref: frame.ref },
  );
}
