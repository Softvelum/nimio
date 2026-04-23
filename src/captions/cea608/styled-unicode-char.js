import { PenState } from "./pen-state";

/**
 * Unicode character with styling and background.
 */
export class StyledUnicodeChar {
  constructor(uchar, foreground, underline, italics, background, flash) {
    this.uchar = uchar || " "; // unicode character
    this.penState = new PenState(
      foreground,
      underline,
      italics,
      background,
      flash,
    );
  }

  reset() {
    this.uchar = " ";
    this.penState.reset();
  }

  setChar(uchar, newPenState) {
    this.uchar = uchar;
    this.penState.copy(newPenState);
  }

  setPenState(newPenState) {
    this.penState.copy(newPenState);
  }

  equals(other) {
    return this.uchar === other.uchar && this.penState.equals(other.penState);
  }

  copy(newChar) {
    this.uchar = newChar.uchar;
    this.penState.copy(newChar.penState);
  }

  isEmpty() {
    return this.uchar === " " && this.penState.isDefault();
  }
}
