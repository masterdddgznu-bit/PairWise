import type { Frame } from "./types.js";

/** Create an empty frame. */
export function emptyFrame(): Frame {
  return { key: null, value: 0, ref: false };
}

/** Deep-copy frames array. */
export function copyFrames(frames: Frame[]): Frame[] {
  return frames.map((f) => ({ key: f.key, value: f.value, ref: f.ref }));
}
