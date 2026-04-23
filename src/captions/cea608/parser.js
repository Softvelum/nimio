import { Cea608Channel } from "./channel";

// Tables to look up row from PAC data
let rowsLowCh1 = {
  0x11: 1,
  0x12: 3,
  0x15: 5,
  0x16: 7,
  0x17: 9,
  0x10: 11,
  0x13: 12,
  0x14: 14,
};
let rowsHighCh1 = {
  0x11: 2,
  0x12: 4,
  0x15: 6,
  0x16: 8,
  0x17: 10,
  0x13: 13,
  0x14: 15,
};
let rowsLowCh2 = {
  0x19: 1,
  0x1a: 3,
  0x1d: 5,
  0x1e: 7,
  0x1f: 9,
  0x18: 11,
  0x1b: 12,
  0x1c: 14,
};
let rowsHighCh2 = {
  0x19: 2,
  0x1a: 4,
  0x1d: 6,
  0x1e: 8,
  0x1f: 10,
  0x1b: 13,
  0x1c: 15,
};

let backgroundColors = [
  "white",
  "green",
  "blue",
  "cyan",
  "red",
  "yellow",
  "magenta",
  "black",
  "transparent",
];

/**
 * Parse CEA-608 data and send decoded data to out1 and out2.
 */
export class Cea608Parser {
  /**
   * @constructor
   * @param {Number} field  CEA-608 field (1 or 2)
   * @param {CueHandler} out1 Output from channel1
   * @param {CueHandler} out2 Output from channel2
   */
  constructor(instName, field, out1, out2) {
    this.field = field || 1;
    this.outputs = [out1, out2];
    this.channels = [
      new Cea608Channel(field, out1),
      new Cea608Channel(field + 1, out2),
    ];

    this.currChNr = -1; // Will be 1 or 2
    this.lastCmdA = null; // First byte of last command
    this.lastCmdB = null; // Second byte of last command
    this.dataCounters = { padding: 0, char: 0, cmd: 0, other: 0 };
  }

  getHandler(index) {
    return this.channels[index].getHandler();
  }

  setHandler(index, newHandler) {
    this.channels[index].setHandler(newHandler);
  }

  /**
   * Add data for time t in forms of list of bytes (unsigned ints). The bytes are treated as pairs.
   */
  addData(pTime, byteList) {
    let cmdFound,
      a,
      b,
      charsFound = false;

    for (let i = 0; i < byteList.length; i += 2) {
      a = byteList[i] & 0x7f;
      b = byteList[i + 1] & 0x7f;

      if (
        a >= 0x10 &&
        a <= 0x1f &&
        a === this.lastCmdA &&
        b === this.lastCmdB
      ) {
        this.lastCmdA = null;
        this.lastCmdB = null;
        continue; // Repeated commands are dropped (once)
      }

      if (a === 0 && b === 0) {
        this.dataCounters.padding += 2;
        continue;
      }
      cmdFound = this.parseCmd(a, b, pTime);
      if (!cmdFound) {
        cmdFound = this.parseXDSCmd(a, b);
      }
      if (!cmdFound) {
        cmdFound = this.parseMidrow(a, b, pTime);
      }
      if (!cmdFound) {
        cmdFound = this.parsePAC(a, b);
      }
      if (!cmdFound) {
        cmdFound = this.parseBackgroundAttributes(a, b);
      }
      if (!cmdFound) {
        charsFound = this.parseChars(a, b);
        if (charsFound && this.currChNr > 0) {
          let channel = this.channels[this.currChNr - 1];
          channel.insertChars(charsFound, pTime);
        }
      }
      if (cmdFound) {
        this.dataCounters.cmd += 2;
      } else if (charsFound) {
        this.dataCounters.char += 2;
      } else {
        this.dataCounters.other += 2;
      }
    }

    if (this.currChNr > 0) {
      this.channels[this.currChNr - 1].reportActive();
    }
  }

  /**
   * Parse Command.
   * @returns {Boolean} Tells if a command was found
   */
  parseCmd(a, b, pTime) {
    let chNr = null;

    let cond1 =
      (a === 0x14 || a === 0x15 || a === 0x1c || a === 0x1d) &&
      0x20 <= b &&
      b <= 0x2f;
    let cond2 = (a === 0x17 || a === 0x1f) && 0x21 <= b && b <= 0x23;
    if (!(cond1 || cond2)) {
      return false;
    }

    if (a === 0x14 || a === 0x15 || a === 0x17) {
      chNr = 1;
    } else {
      chNr = 2; // (a === 0x1C || a === 0x1D || a=== 0x1f)
    }

    let channel = this.channels[chNr - 1];

    if (a === 0x14 || a === 0x15 || a === 0x1c || a === 0x1d) {
      if (b === 0x20) {
        channel.cc_RCL();
      } else if (b === 0x21) {
        channel.cc_BS(pTime);
      } else if (b === 0x22) {
        channel.cc_AOF();
      } else if (b === 0x23) {
        channel.cc_AON();
      } else if (b === 0x24) {
        channel.cc_DER(pTime);
      } else if (b === 0x25) {
        channel.cc_RU(2);
      } else if (b === 0x26) {
        channel.cc_RU(3);
      } else if (b === 0x27) {
        channel.cc_RU(4);
      } else if (b === 0x28) {
        channel.cc_FON();
      } else if (b === 0x29) {
        channel.cc_RDC();
      } else if (b === 0x2a) {
        channel.cc_TR();
      } else if (b === 0x2b) {
        channel.cc_RTD();
      } else if (b === 0x2c) {
        channel.cc_EDM(pTime);
      } else if (b === 0x2d) {
        channel.cc_CR(pTime);
      } else if (b === 0x2e) {
        channel.cc_ENM();
      } else if (b === 0x2f) {
        channel.cc_EOC(pTime);
      }
    } else {
      //a == 0x17 || a == 0x1F
      channel.cc_TO(b - 0x20);
    }
    this.lastCmdA = a;
    this.lastCmdB = b;
    this.currChNr = chNr;
    return true;
  }

  /**
   * Parse XDS command packet
   */
  parseXDSCmd(a, b) {
    if (a < 0x10) {
      // this is an XDS packet
      this.currChNr = -1;
      return true;
    }
    return false;
  }

  /**
   * Parse midrow styling command
   * @returns {Boolean}
   */
  parseMidrow(a, b, pTime) {
    let chNr = null;

    if ((a === 0x11 || a === 0x19) && 0x20 <= b && b <= 0x2f) {
      if (a === 0x11) {
        chNr = 1;
      } else {
        chNr = 2;
      }
      if (chNr !== this.currChNr) {
        return false;
      }
      let channel = this.channels[chNr - 1];
      // cea608 spec says midrow codes should inject a space
      channel.insertChars([0x20], pTime);
      channel.cc_MIDROW(b);
      this.lastCmdA = a;
      this.lastCmdB = b;
      return true;
    }

    return false;
  }

  /**
   * Parse Preable Access Codes (Table 53).
   * @returns {Boolean} Tells if PAC found
   */
  parsePAC(a, b) {
    let chNr = null;
    let row = null;

    let case1 =
      ((0x11 <= a && a <= 0x17) || (0x19 <= a && a <= 0x1f)) &&
      0x40 <= b &&
      b <= 0x7f;
    let case2 = (a === 0x10 || a === 0x18) && 0x40 <= b && b <= 0x5f;
    if (!(case1 || case2)) {
      return false;
    }

    chNr = a <= 0x17 ? 1 : 2;

    if (0x40 <= b && b <= 0x5f) {
      row = chNr === 1 ? rowsLowCh1[a] : rowsLowCh2[a];
    } else {
      // 0x60 <= b <= 0x7F
      row = chNr === 1 ? rowsHighCh1[a] : rowsHighCh2[a];
    }

    let channel = this.channels[chNr - 1];
    if (!channel) {
      return false;
    }
    channel.setPAC(this.interpretPAC(row, b));
    this.lastCmdA = a;
    this.lastCmdB = b;
    this.currChNr = chNr;

    return true;
  }

  /**
   * Interpret the second byte of the pac, and return the information.
   * @returns {Object} pacData with style parameters.
   */
  interpretPAC(row, byte) {
    let pacIndex = byte;
    let pacData = {
      color: null,
      italics: false,
      indent: null,
      underline: false,
      row: row,
    };

    if (byte > 0x5f) {
      pacIndex = byte - 0x60;
    } else {
      pacIndex = byte - 0x40;
    }
    pacData.underline = (pacIndex & 1) === 1;
    if (pacIndex <= 0xd) {
      pacData.color = [
        "white",
        "green",
        "blue",
        "cyan",
        "red",
        "yellow",
        "magenta",
        "white",
      ][Math.floor(pacIndex / 2)];
    } else if (pacIndex <= 0xf) {
      pacData.italics = true;
      pacData.color = "white";
    } else {
      pacData.indent = Math.floor((pacIndex - 0x10) / 2) * 4;
    }

    return pacData; // Note that row has zero offset. The spec uses 1.
  }

  /**
   * Parse characters.
   * @returns An array with 1 to 2 codes corresponding to chars, if found. null otherwise.
   */
  parseChars(a, b) {
    let channelNr = null,
      charCodes = null,
      charCode1 = null;

    if (a >= 0x19) {
      channelNr = 2;
      charCode1 = a - 8;
    } else {
      channelNr = 1;
      charCode1 = a;
    }
    if (0x11 <= charCode1 && charCode1 <= 0x13) {
      // Special character
      let oneCode = b;
      if (charCode1 === 0x11) {
        oneCode = b + 0x50;
      } else if (charCode1 === 0x12) {
        oneCode = b + 0x70;
      } else {
        oneCode = b + 0x90;
      }
      charCodes = [oneCode];
      this.lastCmdA = a;
      this.lastCmdB = b;
    } else if (0x20 <= a && a <= 0x7f) {
      charCodes = b === 0 ? [a] : [a, b];
      this.lastCmdA = null;
      this.lastCmdB = null;
    }
    // if (charCodes) {
    //   let hexCodes = Utils.numArrayToHexArray(charCodes);
    // }

    return charCodes;
  }

  /**
   * Parse extended background attributes as well as new foreground color black.
   * @returns{Boolean} Tells if background attributes are found
   */
  parseBackgroundAttributes(a, b) {
    let case1 = (a === 0x10 || a === 0x18) && 0x20 <= b && b <= 0x2f;
    let case2 = (a === 0x17 || a === 0x1f) && 0x2d <= b && b <= 0x2f;
    if (!(case1 || case2)) {
      return false;
    }

    let bkgData = {};
    if (a === 0x10 || a === 0x18) {
      let index = Math.floor((b - 0x20) / 2);
      bkgData.background = backgroundColors[index];
      if (b % 2 === 1) {
        bkgData.background = bkgData.background + "_semi";
      }
    } else if (b === 0x2d) {
      bkgData.background = "transparent";
    } else {
      bkgData.foreground = "black";
      if (b === 0x2f) {
        bkgData.underline = true;
      }
    }
    let chNr = a < 0x18 ? 1 : 2;
    let channel = this.channels[chNr - 1];
    channel.setBkgData(bkgData);
    this.lastCmdA = a;
    this.lastCmdB = b;

    return true;
  }

  /**
   * Reset state of parser and its channels.
   */
  reset() {
    for (let i = 0; i < this.channels.length; i++) {
      if (this.channels[i]) {
        this.channels[i].reset();
      }
    }
    this.lastCmdA = null;
    this.lastCmdB = null;
  }

  /**
   * Trigger the generation of a cue, and the start of a new one if displayScreens are not empty.
   */
  cueSplitAtTime(t) {
    for (let i = 0; i < this.channels.length; i++) {
      if (this.channels[i]) {
        this.channels[i].cueSplitAtTime(t);
      }
    }
  }
}
