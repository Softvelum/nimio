import { NR_COLS } from './constants'
import { StyledUnicodeChar } from './styled-unicode-char'
import { PenState } from './pen-state'
import { Utils } from './utils'
import { Logger } from './logger'

/**
 * CEA-608 row consisting of NR_COLS instances of StyledUnicodeChar.
 */
export class Row {

  constructor () {
    this.chars = [];
    for (let i = 0; i < NR_COLS; i++) {
      this.chars.push(new StyledUnicodeChar());
    }
    this.pos = 0;
    this.currPenState = new PenState();
  }

  equals (other) {
    let equal = true;
    for (let i = 0; i < NR_COLS; i ++) {
      if (!this.chars[i].equals(other.chars[i])) {
        equal = false;
        break;
      }
    }

    return equal;
  }
  
  copy (other) {
    for (let i = 0; i < NR_COLS; i ++) {
      this.chars[i].copy(other.chars[i]);
    }
  }
  
  isEmpty () {
    let empty = true;
    for (let i = 0; i < NR_COLS; i ++) {
      if (!this.chars[i].isEmpty()) {
        empty = false;
        break;
      }
    }

    return empty;
  }

  /**
   *  Set the cursor to a valid column.
   */
  setCursor (absPos) {
    if (this.pos !== absPos) {
      this.pos = absPos;
    }
    if (this.pos < 0) {
      Logger.log("ERROR", "Negative cursor position " + this.pos);
      this.pos = 0;
    } else if (this.pos > NR_COLS) {
      Logger.log("ERROR", "Too large cursor position " + this.pos);
      this.pos = NR_COLS;
    }
  }

  /** 
   * Move the cursor relative to current position.
   */
  moveCursor (relPos) {
    let newPos = this.pos + relPos;
    if (relPos > 1) {
      for (let i = this.pos+1; i < newPos+1; i++) {
        this.chars[i].setPenState(this.currPenState);
      }
    }
    this.setCursor(newPos);
  }

  /**
   * Backspace, move one step back and clear character.
   */
  backSpace () {
    this.moveCursor(-1);
    this.chars[this.pos].setChar(' ', this.currPenState);
  }

  insertChar (byte) {
    if (byte >= 0x90) { //Extended char
      this.backSpace();
    }
    let char = Utils.getCharForByte(byte);
    if (this.pos >= NR_COLS) {
      Logger.log(
        "ERROR",
        `Cannot insert ${byte.toString(16)} (${char}) at position ${this.pos}. Skipping it!`
      );
      return;
    }
    this.chars[this.pos].setChar(char, this.currPenState);
    this.moveCursor(1);
  }

  clearFromPos (startPos) {
    for (let i = startPos; i < NR_COLS; i++) {
      this.chars[i].reset();
    }
  }

  clear () {
    this.clearFromPos(0);
    this.pos = 0;
    this.currPenState.reset();
  }

  clearToEndOfRow () {
    this.clearFromPos(this.pos);
  }

  getTextString () {
    let chars = [];
    let empty = true;
    for (let i = 0; i < NR_COLS; i++) {
      let char = this.chars[i].uchar;
      if (char !== " ") {
        empty = false;
      }
      chars.push(char);
    }

    return empty ? '' : chars.join('');
  }

  setPenStyles (styles) {
    this.currPenState.setStyles(styles);
    let currChar = this.chars[this.pos];
    currChar.setPenState(this.currPenState);
  }

}
