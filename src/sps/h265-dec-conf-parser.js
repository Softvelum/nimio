import { HEVC_NAL_UNIT_TYPE } from "@/nal/unit-type";

// aligned(8) class HEVCDecoderConfigurationRecord {
//    unsigned int(8) configurationVersion = 1;
//    unsigned int(2) general_profile_space;
//    unsigned int(1) general_tier_flag;
//    unsigned int(5) general_profile_idc;
//    unsigned int(32) general_profile_compatibility_flags;
//    unsigned int(48) general_constraint_indicator_flags;
//    unsigned int(8) general_level_idc;
//    bit(4) reserved = ‘1111’b;
//    unsigned int(12) min_spatial_segmentation_idc;
//    bit(6) reserved = ‘111111’b;
//    unsigned int(2) parallelismType;
//    bit(6) reserved = ‘111111’b;
//    unsigned int(2) chroma_format_idc;
//    bit(5) reserved = ‘11111’b;
//    unsigned int(3) bit_depth_luma_minus8;
//    bit(5) reserved = ‘11111’b;
//    unsigned int(3) bit_depth_chroma_minus8;
//    bit(16) avgFrameRate;
//    bit(2) constantFrameRate;
//    bit(3) numTemporalLayers;
//    bit(1) temporalIdNested;
//    unsigned int(2) lengthSizeMinusOne;
//    unsigned int(8) numOfArrays;
//    for (j=0; j < numOfArrays; j++) {
//       bit(1) array_completeness;
//       unsigned int(1) reserved = 0;
//       unsigned int(6) NAL_unit_type;
//       unsigned int(16) numNalus;
//       for (i=0; i< numNalus; i++) {
//          unsigned int(16) nalUnitLength;
//          bit(8*nalUnitLength) nalUnit;
//       }
//    }
// }

export class H265DecConfParser {
  constructor(spsParser, vpsParser) {
    this._spsParser = spsParser;
    this._vpsParser = vpsParser;
  }

  parse(data, retObj) {
    // Skip configurationVersion, general_profile_space, general_tier_flag, general_profile_idc,
    // general_profile_compatibility_flags, general_constraint_indicator_flags,
    // general_level_idc, min_spatial_segmentation_idc, parallelismType, chroma_format_idc,
    // bit_depth_luma_minus8, bit_depth_chroma_minus8, avgFrameRate, constantFrameRate,
    // numTemporalLayers, temporalIdNested, lengthSizeMinusOne.
    let offset = 22; // These fields account for the first 22 bytes

    const numOfArrays = data[offset]; // Number of NALU arrays
    offset += 1;

    for (let i = 0; i < numOfArrays; i++) {
      const nalUnitType = data[offset] & 0x3f; // Last 6 bits indicate the NALU type
      offset += 1;

      const numNALUs = (data[offset] << 8) | data[offset + 1];
      offset += 2;

      for (let j = 0; j < numNALUs; j++) {
        const nalUnitLength = (data[offset] << 8) | data[offset + 1];
        offset += 2;

        if (
          nalUnitType === HEVC_NAL_UNIT_TYPE.SPS ||
          nalUnitType === HEVC_NAL_UNIT_TYPE.VPS
        ) {
          // parse sps or vps and check it contains sei timecode related data
          // if so return from the loop
          // offset + 2 skips nal unit header
          let parser =
            nalUnitType === HEVC_NAL_UNIT_TYPE.SPS
              ? this._spsParser
              : this._vpsParser;
          parser.parse(data, offset + 2, offset + nalUnitLength - 1, retObj);

          if (retObj.generalInfo && retObj.timingInfo) return;
        }

        offset += nalUnitLength;
      }
    }
  }
}
