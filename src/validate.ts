import {
  InvalidAmountError,
  InvalidGaleError,
  InvalidIdError,
  InvalidSpanError,
} from "./errors.js";

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(pegAt: unknown, strikeAt: unknown): void {
  if (
    typeof pegAt !== "number" ||
    !Number.isInteger(pegAt) ||
    pegAt < 0 ||
    typeof strikeAt !== "number" ||
    !Number.isInteger(strikeAt) ||
    strikeAt < 0 ||
    strikeAt <= pegAt
  ) {
    throw new InvalidSpanError(
      "pegAt/strikeAt must be integers >= 0 with strikeAt > pegAt",
    );
  }
}

export function validateGale(gale: unknown): void {
  if (typeof gale !== "number" || !Number.isInteger(gale) || gale < 1) {
    throw new InvalidGaleError("gale must be an integer >= 1");
  }
}

export function validateAmount(amount: unknown): void {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1) {
    throw new InvalidAmountError("amount must be an integer >= 1");
  }
}
