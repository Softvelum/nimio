import { BitReader } from '@/shared/bit-reader'
import { NalReader } from '@/nal/reader'

export class H265BaseUnitParser {
  constructor () {
    this._bitr = new BitReader();
  }

  _assignBits (data, start, end) {
    const rbsp = NalReader.extractUnit(data, start, end);
    this._bitr.attach(rbsp);
  }

  _parseProfileTierLevel (maxNumSubLayersMinus1) {
    this._bitr.skipBits(2); // general_profile_space
    this._bitr.skipBits(1); // general_tier_flag
    this._sps.profileIdc = this._bitr.readBits(5); // general_profile_idc

    this._bitr.skipBits(32); // general_profile_compatibility_flag[i]
    this._bitr.skipBits(4); // general_progressive_source_flag, general_interlaced_source_flag
                            // general_non_packed_constraint_flag, general_frame_only_constraint_flag

    this._bitr.skipBits(44); // skip 44 reserved bits
    this._sps.levelIdc = this._bitr.readBits(8); // general_level_idc

    let i;
    let subLayerProfilePresentFlag = [];
    let subLayerLevelPresentFlag = [];
    for (i = 0; i < maxNumSubLayersMinus1; i++) {
      subLayerProfilePresentFlag[i] = this._bitr.readBits(1);
      subLayerLevelPresentFlag[i] = this._bitr.readBits(1);
    }

    if (maxNumSubLayersMinus1 > 0) {
      for (i = maxNumSubLayersMinus1; i < 8; i++) {
        this._bitr.skipBits(2);
      }
    }

    for (i = 0; i < maxNumSubLayersMinus1; i++) {
      if (subLayerProfilePresentFlag[i]) {
        this._bitr.skipBits(2); // sub_layer_profile_space[i]
        this._bitr.skipBits(1); // sub_layer_tier_flag[i]
        this._bitr.skipBits(5); // sub_layer_profile_idc[i]

        this._bitr.skipBits(32); // sub_layer_profile_compatibility_flag[i][j]
        this._bitr.skipBits(4); // sub_layer_progressive_source_flag[i], sub_layer_interlaced_source_flag[i],
                                // sub_layer_non_packed_constraint_flag[i], sub_layer_frame_only_constraint_flag[i]

        this._bitr.skipBits(44); // skip sub layer reserved flags
      }

      if (subLayerLevelPresentFlag[i]) {
        this._bitr.skipBits(8); // sub_layer_level_idc[i]
      }
    }
  }

  _calcMaxFps () {
    if (this._sps.numUnitsInTick !== 0) {
      let unitsFieldBasedFlag = this._sps.fieldSeqFlag === 1 ? 1 : 0; 
      this._sps.maxFps = Math.ceil(
        this._sps.timeScale / ((1 + unitsFieldBasedFlag) * this._sps.numUnitsInTick)
      );
    }
  }

  // There is currently no need to parse hrd parameters for H265
  // howerver it might be necessary in the future so keep it commented
  // _parseHRDParameters(maxNumSubLayersMinus1) {
  //   // default values
  //   this._sps.initialCpbRemovalDelayLength = 24;
  //   this._sps.cpbRemovalDelayLength = 24;
  //   this._sps.dpbOutputDelayLength = 24;

  //   let subPicHrdParamsPresentFlag = 0;
  //   let nalHrdParametersPresentFlag = this._bitr.readBits(1);
  //   let vclHrdParametersPresentFlag = this._bitr.readBits(1);
  //   if (nalHrdParametersPresentFlag || vclHrdParametersPresentFlag) {
  //     let subPicHrdParamsPresentFlag = this._bitr.readBits(1); // sub_pic_hrd_params_present_flag
  //     if (subPicHrdParamsPresentFlag) {
  //       this._bitr.skipBits(8); // tick_divisor_minus2
  //       this._bitr.skipBits(5); // du_cpb_removal_delay_increment_length_minus1
  //       this._bitr.skipBits(1); // sub_pic_cpb_params_in_pic_timing_sei_flag
  //       this._bitr.skipBits(5); // dpb_output_delay_du_length_minus1
  //     }
  //     this._bitr.skipBits(4); // bit_rate_scale
  //     this._bitr.skipBits(4); // cpb_size_scale
  //     if (subPicHrdParamsPresentFlag) {
  //       this._bitr.skipBits(4); // cpb_size_du_scale
  //     }
  //     this._sps.initialCpbRemovalDelayLength = this._bitr.readBits(5) + 1; // initial_cpb_removal_delay_length_minus1
  //     this._sps.cpbRemovalDelayLength = this._bitr.readBits(5) + 1; // au_cpb_removal_delay_length_minus1
  //     this._sps.dpbOutputDelayLength = this._bitr.readBits(5) + 1; // dpb_output_delay_length_minus1
  //   }

  //   for (let i = 0; i <= maxNumSubLayersMinus1; i++) {
  //     let fixedPicRateGeneralFlag = this._bitr.readBits(1); // fixed_pic_rate_general_flag
  //     let fixedPicRateWithinCvsFlag = 1;
  //     if (!fixedPicRateGeneralFlag) {
  //       fixedPicRateWithinCvsFlag = this._bitr.readBits(1); // fixed_pic_rate_within_cvs_flag
  //     }

  //     let lowDelayHrdFlag = 0;
  //     if (fixedPicRateWithinCvsFlag) {
  //       this._bitr.readUE(); // elemental_duration_in_tc_minus1[i]
  //     } else {
  //       lowDelayHrdFlag = this._bitr.readBits(1); // low_delay_hrd_flag
  //     }

  //     let cpbCntMinus1 = 0;
  //     if (!lowDelayHrdFlag) {
  //       cpbCntMinus1 = this._bitr.readUE(); // cpb_cnt_minus1
  //     }

  //     if (nalHrdParametersPresentFlag) {
  //       this._parseSubLayerHrdParameters(cpbCntMinus1, subPicHrdParamsPresentFlag);
  //     }

  //     if (vclHrdParametersPresentFlag) {
  //       this._parseSubLayerHrdParameters(cpbCntMinus1, subPicHrdParamsPresentFlag);
  //     }

  //   }
  // }

  // _parseSubLayerHrdParameters (cpbCntMinus1, subPicHrdParamsPresentFlag) {
  //   for (let i = 0; i <= cpbCntMinus1; i++) {
  //     this._bitr.readUE(); // bit_rate_value_minus1
  //     this._bitr.readUE(); // cpb_size_value_minus1

  //     if (subPicHrdParamsPresentFlag) {
  //       this._bitr.readUE(); // cpb_size_du_value_minus1
  //       this._bitr.readUE(); // bit_rate_du_value_minus1
  //     }
  //     this._bitr.readBits(1); // cbr_flag
  //   }
  // }
}
