// aligned(8) class AVCDecoderConfigurationRecord {
//   unsigned int(8) configurationVersion = 1;
//   unsigned int(8) AVCProfileIndication;
//   unsigned int(8) profile_compatibility;
//   unsigned int(8) AVCLevelIndication;
//   bit(6) reserved = ‘111111’b;
//   unsigned int(2) lengthSizeMinusOne;
//   bit(3) reserved = ‘111’b;
//   unsigned int(5) numOfSequenceParameterSets;
//   for (i=0; i< numOfSequenceParameterSets; i++) {
//     unsigned int(16) sequenceParameterSetLength ;
//     bit(8*sequenceParameterSetLength) sequenceParameterSetNALUnit;
//   }
//   unsigned int(8) numOfPictureParameterSets;
//   for (i=0; i< numOfPictureParameterSets; i++) {
//     unsigned int(16) pictureParameterSetLength;
//     bit(8*pictureParameterSetLength) pictureParameterSetNALUnit;
//   }
// }

export class H264DecConfParser {
  constructor(spsParser) {
    this._spsParser = spsParser;
  }

  parse(data, retObj) {
    // Skip configurationVersion, AVCProfileIndication, profile_compatibility, AVCLevelIndication, and lengthSizeMinusOne
    let offset = 5;

    const numOfSPS = data[offset] & 0x1f; // Last 5 bits indicate the number of SPS entries
    offset++;

    for (let i = 0; i < numOfSPS; i++) {
      const spsLength = (data[offset] << 8) | data[offset + 1];
      offset += 2;

      // return if sps contains SEI timecode related parameters
      this._spsParser.parse(data, offset + 1, offset + spsLength - 1, retObj);
      if (retObj.timingInfo) return;

      offset += spsLength;
    }
  }
}
