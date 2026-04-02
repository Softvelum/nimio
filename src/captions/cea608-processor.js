import { Cea608Parser } from "./cea608/parser";
import { CueHandler } from "./cue-handler";

export class Cea608Processor {
  constructor(instName, captionPresenter) {
    let cueHdlrs = [];
    for (let i = 0; i < 4; i++) {
      cueHdlrs[i] = new CueHandler(captionPresenter, `CC${i + 1}`);
    }
    this.type = "cea608";

    this._parser1 = new Cea608Parser(instName, 1, cueHdlrs[0], cueHdlrs[1]);
    this._parser2 = new Cea608Parser(instName, 2, cueHdlrs[2], cueHdlrs[3]);
  }

  isMatching(payloadType, payloadSize, frame, pos) {
    if (payloadType !== 4 || payloadSize < 8) {
      return null;
    }
    let countryCode = frame[pos];
    let providerCode = (frame[pos + 1] << 8) | frame[pos + 2];
    let userIdentifier =
      (frame[pos + 3] << 24) |
      (frame[pos + 4] << 16) |
      (frame[pos + 5] << 8) |
      (frame[pos + 6]);

    let userDataTypeCode = frame[pos + 7];
    return (
      countryCode == 0xb5 &&
      providerCode == 0x31 &&
      userIdentifier == 0x47413934 &&
      userDataTypeCode == 0x3
    );
  }

  handleUnit(pTime, frame, seiRange) {
    let data = this._extractCea608DataFromRange(frame, seiRange);
    if (data[0].length > 0) this._parser1.addData(pTime, data[0]);
    if (data[1].length > 0) this._parser2.addData(pTime, data[1]);
  }

  reset() {
    this._parser1.reset();
    this._parser2.reset();
  }

  _extractCea608DataFromRange(frame, range) {
    let pos = range[0];
    let fieldData = [[], []];

    pos += 8; // Skip country code(8), provider code(16), user identifier(32) and userDataTypeCode(8)
    let ccCount = frame[pos] & 0x1f;
    pos += 2; // Advance 1 and skip reserved byte

    for (let i = 0; i < ccCount; i++) {
      let ccValid = frame[pos] & 0x4;
      let ccType = frame[pos] & 0x3;
      pos++;
      let ccData1 = frame[pos++]; // Keep parity bit
      let ccData2 = frame[pos++]; // Keep parity bit

      if (
        ccValid &&
        (0x00 === ccType || 0x01 === ccType) && // CEA608 field1 and field2
        (ccData1 & 0x7f) + (ccData2 & 0x7f) !== 0
      ) {
        fieldData[ccType].push(ccData1);
        fieldData[ccType].push(ccData2);
      }
    }

    return fieldData;
  }
}
