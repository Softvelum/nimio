import { NR_ROWS } from "./constants";
import { CaptionScreen } from "./caption-screen";
import { Logger } from "./logger";

/**
 * Handle a CEA-608 channel and send decoded data to outputFilter
 */
export class Cea608Channel {
  constructor(channelNumber, outputFilter) {
    this.chNr = channelNumber;
    this.outputFilter = outputFilter;
    this.mode = null;
    this.verbose = 0;
    this.displayedMemory = new CaptionScreen();
    this.nonDisplayedMemory = new CaptionScreen();
    this.lastOutputScreen = new CaptionScreen();
    this.currRollUpRow = this.displayedMemory.rows[NR_ROWS - 1];
    this.writeScreen = this.displayedMemory;
    this.mode = null;
    this.cueStartTime = null; // Keeps track of where a cue started.
  }

  get modes() {
    return ["MODE_ROLL-UP", "MODE_POP-ON", "MODE_PAINT-ON", "MODE_TEXT"];
  }

  reset() {
    this.mode = null;
    this.displayedMemory.reset();
    this.nonDisplayedMemory.reset();
    this.lastOutputScreen.reset();
    this.currRollUpRow = this.displayedMemory.rows[NR_ROWS - 1];
    this.writeScreen = this.displayedMemory;
    this.mode = null;
    this.cueStartTime = null;
    this.lastCueEndTime = null;
    if (this.outputFilter) {
      this.outputFilter.reset();
    }
  }

  reportActive() {
    if (this.outputFilter) {
      this.outputFilter.activate();
    }
  }

  getHandler() {
    return this.outputFilter;
  }

  setHandler(newHandler) {
    this.outputFilter = newHandler;
  }

  setPAC(pacData) {
    this.writeScreen.setPAC(pacData);
  }

  setBkgData(bkgData) {
    this.writeScreen.setBkgData(bkgData);
  }

  setMode(newMode) {
    if (newMode === this.mode) {
      return;
    }
    this.mode = newMode;
    Logger.log("INFO", "MODE=" + newMode);
    if (this.mode === "MODE_POP-ON") {
      this.writeScreen = this.nonDisplayedMemory;
    } else {
      this.writeScreen = this.displayedMemory;
      this.writeScreen.reset();
    }
    if (this.mode !== "MODE_ROLL-UP") {
      this.displayedMemory.nrRollUpRows = null;
      this.nonDisplayedMemory.nrRollUpRows = null;
    }
    this.mode = newMode;
  }

  insertChars(chars) {
    for (let i = 0; i < chars.length; i++) {
      this.writeScreen.insertChar(chars[i]);
    }
    let screen =
      this.writeScreen === this.displayedMemory ? "DISP" : "NON_DISP";
    Logger.log("INFO", screen + ": " + this.writeScreen.getDisplayText(true));
    if (this.mode === "MODE_PAINT-ON" || this.mode === "MODE_ROLL-UP") {
      Logger.log(
        "TEXT",
        "DISPLAYED: " + this.displayedMemory.getDisplayText(true),
      );
      this.outputDataUpdate();
    }
  }

  cc_RCL() {
    // Resume Caption Loading (switch mode to Pop On)
    Logger.log("INFO", "RCL - Resume Caption Loading");
    this.setMode("MODE_POP-ON");
  }

  cc_BS() {
    // BackSpace
    Logger.log("INFO", "BS - BackSpace");
    if (this.mode === "MODE_TEXT") {
      return;
    }
    this.writeScreen.backSpace();
    if (this.writeScreen === this.displayedMemory) {
      this.outputDataUpdate();
    }
  }

  cc_AOF() {
    // Reserved (formerly Alarm Off)
    return;
  }

  cc_AON() {
    // Reserved (formerly Alarm On)
    return;
  }

  cc_DER() {
    // Delete to End of Row
    Logger.log("INFO", "DER- Delete to End of Row");
    this.writeScreen.clearToEndOfRow();
    this.outputDataUpdate();
  }

  cc_RU(nrRows) {
    //Roll-Up Captions-2,3,or 4 Rows
    Logger.log("INFO", "RU(" + nrRows + ") - Roll Up");
    this.writeScreen = this.displayedMemory;
    this.setMode("MODE_ROLL-UP");
    this.writeScreen.setRollUpRows(nrRows);
  }

  cc_FON() {
    //Flash On
    Logger.log("INFO", "FON - Flash On");
    this.writeScreen.setPen({ flash: true });
  }

  cc_RDC() {
    // Resume Direct Captioning (switch mode to PaintOn)
    Logger.log("INFO", "RDC - Resume Direct Captioning");
    this.setMode("MODE_PAINT-ON");
  }

  cc_TR() {
    // Text Restart in text mode (not supported, however)
    Logger.log("INFO", "TR");
    this.setMode("MODE_TEXT");
  }

  cc_RTD() {
    // Resume Text Display in Text mode (not supported, however)
    Logger.log("INFO", "RTD");
    this.setMode("MODE_TEXT");
  }

  cc_EDM() {
    // Erase Displayed Memory
    Logger.log("INFO", "EDM - Erase Displayed Memory");
    this.displayedMemory.reset();
    this.outputDataUpdate();
  }

  cc_CR() {
    // Carriage Return
    Logger.log("CR - Carriage Return");
    this.writeScreen.rollUp();
    this.outputDataUpdate();
  }

  cc_ENM() {
    //Erase Non-Displayed Memory
    Logger.log("INFO", "ENM - Erase Non-displayed Memory");
    this.nonDisplayedMemory.reset();
  }

  cc_EOC() {
    //End of Caption (Flip Memories)
    Logger.log("INFO", "EOC - End Of Caption");
    if (this.mode === "MODE_POP-ON") {
      let tmp = this.displayedMemory;
      this.displayedMemory = this.nonDisplayedMemory;
      this.nonDisplayedMemory = tmp;
      this.writeScreen = this.nonDisplayedMemory;
      Logger.log("TEXT", "DISP: " + this.displayedMemory.getDisplayText());
    }
    this.outputDataUpdate();
  }

  cc_TO(nrCols) {
    // Tab Offset 1,2, or 3 columns
    Logger.log("INFO", "TO(" + nrCols + ") - Tab Offset");
    this.writeScreen.moveCursor(nrCols);
  }

  cc_MIDROW(secondByte) {
    // Parse MIDROW command
    let styles = { flash: false };
    styles.underline = secondByte % 2 === 1;
    styles.italics = secondByte >= 0x2e;
    if (!styles.italics) {
      let colorIndex = Math.floor(secondByte / 2) - 0x10;
      let colors = [
        "white",
        "green",
        "blue",
        "cyan",
        "red",
        "yellow",
        "magenta",
      ];
      styles.foreground = colors[colorIndex];
    } else {
      styles.foreground = "white";
    }
    Logger.log("INFO", "MIDROW: " + JSON.stringify(styles));
    this.writeScreen.setPen(styles);
  }

  outputDataUpdate() {
    let pTime = Logger.time;
    if (pTime === null) {
      return;
    }

    if (this.outputFilter) {
      if (this.cueStartTime === null && !this.displayedMemory.isEmpty()) {
        // Start of a new cue
        this.cueStartTime = pTime;
        this.outputFilter.newCue(this.cueStartTime, this.displayedMemory);
      } else {
        if (!this.displayedMemory.equals(this.lastOutputScreen)) {
          let isEmpty = this.displayedMemory.isEmpty();
          this.outputFilter.finalizeCue(pTime, isEmpty);
          if (!isEmpty) {
            this.cueStartTime = pTime;
            this.outputFilter.newCue(this.cueStartTime, this.displayedMemory);
          } else {
            this.cueStartTime = null;
          }
        }
      }
      this.lastOutputScreen.copy(this.displayedMemory);
    }
  }

  cueSplitAtTime(time) {
    if (this.outputFilter) {
      if (!this.displayedMemory.isEmpty()) {
        if (this.outputFilter.newCue) {
          this.outputFilter.newCue(
            this.cueStartTime,
            time,
            this.displayedMemory,
          );
        }
        this.cueStartTime = time;
      }
    }
  }
}
