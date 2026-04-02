import { NR_ROWS } from "./constants";
import { Row } from "./row";
import { Logger } from "./logger";

/**
 * Keep a CEA-608 screen of 32x15 styled characters
 */
export class CaptionScreen {
  constructor() {
    this.rows = [];
    for (let i = 0; i < NR_ROWS; i++) {
      this.rows.push(new Row()); // Note that we use zero-based numbering (0-14)
    }
    this.currRow = NR_ROWS - 1;
    this.nrRollUpRows = null;
    this.reset();
  }

  reset() {
    for (let i = 0; i < NR_ROWS; i++) {
      this.rows[i].clear();
    }
    this.currRow = NR_ROWS - 1;
  }

  equals(other) {
    let equal = true;
    for (let i = 0; i < NR_ROWS; i++) {
      if (!this.rows[i].equals(other.rows[i])) {
        equal = false;
        break;
      }
    }

    return equal;
  }

  copy(other) {
    for (let i = 0; i < NR_ROWS; i++) {
      this.rows[i].copy(other.rows[i]);
    }
  }

  isEmpty() {
    let empty = true;
    for (let i = 0; i < NR_ROWS; i++) {
      if (!this.rows[i].isEmpty()) {
        empty = false;
        break;
      }
    }

    return empty;
  }

  backSpace() {
    let row = this.rows[this.currRow];
    row.backSpace();
  }

  clearToEndOfRow() {
    let row = this.rows[this.currRow];
    row.clearToEndOfRow();
  }

  /**
   * Insert a character (without styling) in the current row.
   */
  insertChar(char) {
    let row = this.rows[this.currRow];
    row.insertChar(char);
  }

  setPen(styles) {
    let row = this.rows[this.currRow];
    row.setPenStyles(styles);
  }

  moveCursor(relPos) {
    let row = this.rows[this.currRow];
    row.moveCursor(relPos);
  }

  setCursor(absPos) {
    Logger.log("INFO", "setCursor: " + absPos);
    let row = this.rows[this.currRow];
    row.setCursor(absPos);
  }

  setPAC(pacData) {
    Logger.log("INFO", "pacData = " + JSON.stringify(pacData));
    let newRow = pacData.row - 1;
    if (this.nrRollUpRows && newRow < this.nrRollUpRows - 1) {
      newRow = this.nrRollUpRows - 1;
    }

    this.currRow = newRow;
    let row = this.rows[this.currRow];
    if (pacData.indent !== null) {
      let indent = pacData.indent;
      let prevPos = Math.max(indent - 1, 0);
      row.setCursor(pacData.indent);
      pacData.color = row.chars[prevPos].penState.foreground;
    }

    let styles = {
      foreground: pacData.color,
      underline: pacData.underline,
      italics: pacData.italics,
      background: "black",
      flash: false,
    };

    this.setPen(styles);
  }

  /**
   * Set background/extra foreground, but first do back_space, and then insert space (backwards compatibility).
   */
  setBkgData(bkgData) {
    Logger.log("INFO", "bkgData = " + JSON.stringify(bkgData));
    this.backSpace();
    this.setPen(bkgData);
    this.insertChar(0x20); //Space
  }

  setRollUpRows(nrRows) {
    this.nrRollUpRows = nrRows;
  }

  rollUp() {
    if (this.nrRollUpRows === null) {
      Logger.log("DEBUG", "roll_up but nrRollUpRows not set yet");
      return; // Improper setup
    }
    Logger.log("TEXT", this.getDisplayText());
    let topRowIndex = this.currRow + 1 - this.nrRollUpRows;
    let topRow = this.rows.splice(topRowIndex, 1)[0];
    topRow.clear();
    this.rows.splice(this.currRow, 0, topRow);
    Logger.log("INFO", "Rolling up");
  }

  /**
   * Get all non-empty rows with as unicode text.
   */
  getDisplayText(asOneRow) {
    asOneRow = asOneRow || false;
    let displayText = [];
    let text = "";
    let rowNr = -1;
    for (let i = 0; i < NR_ROWS; i++) {
      let rowText = this.rows[i].getTextString();
      if (rowText) {
        rowNr = i + 1;
        if (asOneRow) {
          displayText.push("Row " + rowNr + ': "' + rowText + '"');
        } else {
          displayText.push(rowText.trim());
        }
      }
    }
    if (displayText.length > 0) {
      if (asOneRow) {
        text = "[" + displayText.join(" | ") + "]";
      } else {
        text = displayText.join("\n");
      }
    }

    return text;
  }

  getTextAndFormat() {
    return this.rows;
  }
}
