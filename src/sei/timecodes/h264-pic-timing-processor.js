import { BaseTimeCodeProcessor } from './base-time-code-processor'
import { Timecode } from './timecode'

const seiNumClockTsTable = [ 1, 1, 1, 2, 2, 3, 3, 2, 3 ];

export class H264PicTimingProcessor extends BaseTimeCodeProcessor {
  constructor (instanceId) {
    super(instanceId);
  }

  isMatching (payloadType) {
    return payloadType === 1; // SEI pic_timing message
  }

  _extractTimecodes () {
    let result = [];

    if (this._sps.hrdParametersPresentFlag) {
      this._bitr.skipBits(this._sps.cpbRemovalDelayLength); // cpb_removal_delay
      this._bitr.skipBits(this._sps.dpbOutputDelayLength);  // dpb_output_delay
    }
    if (this._sps.picStructPresentFlag) {
      let picStruct = this._bitr.readBits(4);

      let numClockTs = seiNumClockTsTable[picStruct];
      if (numClockTs === undefined) return null;

      for (let i = 0; i < numClockTs; i++) {
        if (this._bitr.readBits(1)) {                     // clock_timestamp_flag
          let tc = new Timecode(this._sps.numUnitsInTick, this._sps.timeScale);

          tc.ctType = this._bitr.readBits(2);             // ct_type
          tc.unitFieldBasedFlag = this._bitr.readBits(1); // nuit_field_based_flag
          let countingType = this._bitr.readBits(5);      // counting_type
          let fullTimestampFlag = this._bitr.readBits(1); // full_timestamp_flag
          let discontinuityFlag = this._bitr.readBits(1); // discontinuity_flag
          let cntDroppedFlag = this._bitr.readBits(1);    // cnt_dropped_flag
          if (cntDroppedFlag && countingType > 1 && countingType < 7) {
            tc.dropframe = 1;
          }
          tc.nFrames = this._bitr.readBits(8);            // n_frames

          this._readHMS(tc, fullTimestampFlag);           // hours, minutes, seconds

          tc.timeOffset = 0;
          if (this._sps.timeOffsetLength > 0) {
            tc.timeOffset = this._bitr.readBits(this._sps.timeOffsetLength);
          }

          result.push(tc);
        }
      }
    }

    return result;
  }

}
