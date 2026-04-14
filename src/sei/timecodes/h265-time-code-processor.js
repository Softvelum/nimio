import { Timecode } from './timecode'
import { BaseTimeCodeProcessor } from './base-time-code-processor'
import { HEVC_NAL_UNIT_TYPE } from '@/nal/unit-type'

export class H265TimeCodeProcessor extends BaseTimeCodeProcessor {
  constructor (instanceId) {
    super(instanceId);
  }

  isMatching (payloadType, payloadSize, frame, pos, naluType) {
    return (naluType === HEVC_NAL_UNIT_TYPE.SEI_PREFIX) &&
           (payloadType === 136); // SEI time_code message
  }

  _extractTimecodes () {
    let result = [];

    let numClockTs = this._bitr.readBits(2);

    // Loop through clock timestamps
    for (let i = 0; i < numClockTs; i++) {
      if (this._bitr.readBits(1)) {                     // clock_timestamp_flag
        let tc = new Timecode(this._sps.numUnitsInTick, this._sps.timeScale);
        tc.unitFieldBasedFlag = this._bitr.readBits(1); // nuit_field_based_flag
        let countingType = this._bitr.readBits(5);      // counting_type

        let fullTimestampFlag = this._bitr.readBits(1); // full_timestamp_flag
        let discontinuityFlag = this._bitr.readBits(1); // discontinuity_flag
        let cntDroppedFlag = this._bitr.readBits(1);    // cnt_dropped_flag

        if (cntDroppedFlag && countingType > 1 && countingType < 7) {
          tc.dropframe = 1;
        }
        tc.nFrames = this._bitr.readBits(9);            // n_frames

        this._readHMS(tc, fullTimestampFlag);           // hours, minutes, seconds

        // Parse time_offset_length (5 bits) and time_offset based on its value
        tc.timeOffset = 0;
        let timeOffsetLength = this._bitr.readBits(5);
        if (timeOffsetLength > 0) {
          tc.timeOffset = this._bitr.readBits(timeOffsetLength);
        }

        result.push(tc);
      }
    }

    return result;
  }

}
