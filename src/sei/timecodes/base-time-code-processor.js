import { SPSHolder } from "@/sps/holder";
import { BitReader } from "@/shared/bit-reader";

export class BaseTimeCodeProcessor {
  constructor(instanceId) {
    this._instId = instanceId;
    this._sps = SPSHolder.getInstance(instanceId).sps();
    this._bitr = new BitReader();
    this.type = "timecode";
  }

  reset() {}

  handleUnit(pTime, rbsp, seiRange) {
    if (!this._sps.timingInfo || !this._tcCallback) return;

    this._bitr.attach(rbsp, seiRange[0]);
    let timecodes = this._extractTimecodes();
    for (let i = 0; i < timecodes.length; i++) {
      this._tcCallback(pTime, timecodes[i].clockTs(), timecodes[i].stringTs());
    }
  }

  _readHMS(tc, fullTimestampFlag) {
    if (fullTimestampFlag) {
      tc.seconds = this._bitr.readBits(6); // seconds_value 0..59
      tc.minutes = this._bitr.readBits(6); // minutes_value 0..59
      tc.hours = this._bitr.readBits(5); // hours_value 0..23
    } else {
      if (this._bitr.readBits(1)) {
        // seconds_flag
        tc.seconds = this._bitr.readBits(6);
        if (this._bitr.readBits(1)) {
          // minutes_flag
          tc.minutes = this._bitr.readBits(6);
          if (this._bitr.readBits(1)) {
            // hours_flag
            tc.hours = this._bitr.readBits(5);
          }
        }
      }
    }
  }

  set onTimecode(callback) {
    this._tcCallback = callback;
  }
}
