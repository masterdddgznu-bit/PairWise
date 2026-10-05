import { InvalidConfigError } from "./errors.js";

export interface QuorumConfig {
  quorumCount?: number;
  quorumFraction?: number;
}

export function resolveRequired(
  config: QuorumConfig,
  partyCount: number,
): number {
  const hasCount = config.quorumCount !== undefined;
  const hasFraction = config.quorumFraction !== undefined;
  if (hasCount === hasFraction) {
    throw new InvalidConfigError(
      "exactly one of quorumCount or quorumFraction must be provided",
    );
  }
  if (hasCount) {
    const count = config.quorumCount as number;
    if (!Number.isInteger(count) || count < 1 || count > partyCount) {
      throw new InvalidConfigError(
        "quorumCount must be an integer in 1..parties.length",
      );
    }
    return count;
  }
  const fraction = config.quorumFraction as number;
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new InvalidConfigError(
      "quorumFraction must be a finite number in (0, 1]",
    );
  }
  return Math.max(1, Math.ceil(fraction * partyCount));
}
