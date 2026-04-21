import { H265BaseUnitParser } from "./h265-base-unit-parser";
import { getSarFromAspectRatioIdc } from "./helpers";

export class H265SpsParser extends H265BaseUnitParser {
  constructor() {
    super();
  }

  parse(data, start, end, retObj) {
    this._assignBits(data, start, end);
    this._sps = retObj || {};

    let spsVideoParameterSetId = this._bitr.readBits(4); // sps_video_parameter_set_id
    let spsMaxSubLayersMinus1 = this._bitr.readBits(3); // sps_max_sub_layers_minus1
    this._bitr.skipBits(1); // sps_temporal_id_nesting_flag

    this._parseProfileTierLevel(spsMaxSubLayersMinus1); // profile_tier_level( 1, sps_max_sub_layers_minus1 )
    this._sps.spsId = this._bitr.readUE(); // sps_seq_parameter_set_id

    let chromaFormatIdc = this._bitr.readUE();
    if (chromaFormatIdc === 3) {
      this._bitr.skipBits(1); // separate_colour_plane_flag
    }

    // Picture Dimensions
    let width = this._bitr.readUE(); // pic_width_in_luma_samples
    let height = this._bitr.readUE(); // pic_height_in_luma_samples

    // Conformance Window
    let conformanceWindowFlag = this._bitr.readBits(1);
    if (conformanceWindowFlag) {
      this._bitr.readUE(); // conf_win_left_offset
      this._bitr.readUE(); // conf_win_right_offset
      this._bitr.readUE(); // conf_win_top_offset
      this._bitr.readUE(); // conf_win_bottom_offset
    }

    // Bit Depth and Scaling
    this._bitr.readUE(); // bit_depth_luma_minus8
    this._bitr.readUE(); // bit_depth_chroma_minus8

    let log2MaxPicOrderCtnLsbMinus4 = this._bitr.readUE(); // log2_max_pic_order_cnt_lsb_minus4

    // Sub-layer ordering information
    let spsSubLayerOrderInfoPresent = this._bitr.readBits(1);
    let subLayerStart = spsSubLayerOrderInfoPresent ? 0 : spsMaxSubLayersMinus1;

    // TODO: debug!
    let i = 0;
    for (i = subLayerStart; i <= spsMaxSubLayersMinus1; i++) {
      this._bitr.readUE(); // max_dec_pic_buffering_minus1
      this._bitr.readUE(); // max_num_reorder_pics
      this._bitr.readUE(); // max_latency_increase_plus1
    }

    // Log2 min/max sizes
    this._bitr.readUE(); // log2_min_luma_coding_block_size_minus3
    this._bitr.readUE(); // log2_diff_max_min_luma_coding_block_size
    this._bitr.readUE(); // log2_min_luma_transform_block_size_minus2
    this._bitr.readUE(); // log2_diff_max_min_luma_transform_block_size
    this._bitr.readUE(); // max_transform_hierarchy_depth_inter
    this._bitr.readUE(); // max_transform_hierarchy_depth_intra

    // Scaling List Data
    let scalingListEnabledFlag = this._bitr.readBits(1); // scaling_list_enabled_flag
    if (scalingListEnabledFlag) {
      // sps_scaling_list_data_present_flag
      if (this._bitr.readBits(1)) {
        this._skipScalingListData();
      }
    }

    this._bitr.skipBits(2); // amp_enabled_flag, sample_adaptive_offset_enabled_flag

    // PCM
    let pcmEnabledFlag = this._bitr.readBits(1);
    if (pcmEnabledFlag) {
      this._bitr.skipBits(4); // pcm_sample_bit_depth_luma_minus1
      this._bitr.skipBits(4); // pcm_sample_bit_depth_chroma_minus1
      this._bitr.readUE(); // log2_min_pcm_luma_coding_block_size_minus3
      this._bitr.readUE(); // log2_diff_max_min_pcm_luma_coding_block_size
      this._bitr.skipBits(1); // pcm_loop_filter_disabled_flag
    }

    let numShortTermRefPicSets = this._bitr.readUE(); // num_short_term_ref_pic_sets
    this._shortTermRefPicSets = [];
    for (i = 0; i < numShortTermRefPicSets; i++) {
      this._skipReferencePictureSet(i, numShortTermRefPicSets);
    }
    this._shortTermRefPicSets = undefined; // free rps array

    let longTermRefPicsPresentFlag = this._bitr.readBits(1); // long_term_ref_pics_present_flag
    if (longTermRefPicsPresentFlag) {
      let numLongTermRefPicsSps = this._bitr.readUE(); // num_long_term_ref_pics_sps
      for (i = 0; i < numLongTermRefPicsSps; i++) {
        this._bitr.skipBits(log2MaxPicOrderCtnLsbMinus4 + 4); // lt_ref_pic_poc_lsb_sps[i]
        this._bitr.skipBits(1); // used_by_curr_pic_lt_sps_flag[i]
      }
    }
    this._bitr.skipBits(2); // sps_temporal_mvp_enabled_flag, strong_intra_smoothing_enabled_flag

    // VUI Parameters
    const vuiParametersPresentFlag = this._bitr.readBits(1);
    if (vuiParametersPresentFlag) {
      this._parseVUIParameters(spsMaxSubLayersMinus1);
    }
    // mark that general SPS data is read
    this._sps.generalInfo = true;

    // SPS Extentions
    // this._bitr.readBits(1); // sps_extension_present_flag
    // no need to parse extension part for now

    return this._sps;
  }

  _skipScalingListData() {
    for (let sizeId = 0; sizeId < 4; sizeId++) {
      for (let matrixId = 0; matrixId < (sizeId === 3 ? 2 : 6); matrixId++) {
        let scalingListPredModeFlag = this._bitr.readBits(1); // scaling_list_pred_mode_flag[ sizeId ][ matrixId ]
        if (!scalingListPredModeFlag) {
          this._bitr.readUE(); // scaling_list_pred_matrix_id_delta[ sizeId ][ matrixId ]
        } else {
          const coefNum = Math.min(64, 1 << (4 + (sizeId << 1)));
          if (sizeId > 1) {
            this._bitr.readSE(); // scaling_list_dc_coef_minus8[ sizeId − 2 ][ matrixId ]
          }
          for (let i = 0; i < coefNum; i++) {
            this._bitr.readSE(); // scaling_list_delta_coef
          }
        }
      }
    }
  }

  _skipReferencePictureSet(stRpsIdx, numShortTermRefPicSets) {
    let usedByCurrPicFlag = [];
    let deltaPocS0Minus1 = [];
    let deltaPocS1Minus1 = [];
    let useDeltaFlag = [];

    let i, j;
    for (i = 0; i < 16; i++) {
      usedByCurrPicFlag[i] = deltaPocS0Minus1[i] = deltaPocS1Minus1[i] = 0;
      useDeltaFlag[i] = 1;
    }

    let deltaRps;
    let stRPS = (this._shortTermRefPicSets[stRpsIdx] = {
      DeltaPocS0: [],
      DeltaPocS1: [],
      UsedByCurrPicS0: [],
      UsedByCurrPicS1: [],
      NumNegativePics: 0,
      NumPositivePics: 0,
      NumDeltaPocs: 0,
    });
    /* set default values for fields that might not be present in the bitstream
       and have valid defaults */
    stRPS.inter_ref_pic_set_prediction_flag = 0;
    stRPS.delta_idx_minus1 = 0;

    if (stRpsIdx != 0) {
      stRPS.inter_ref_pic_set_prediction_flag = this._bitr.readBits(1);
    }

    if (stRPS.inter_ref_pic_set_prediction_flag) {
      stRPS.delta_rps_sign = this._bitr.readBits(1);
      stRPS.abs_delta_rps_minus1 = this._bitr.readUE();

      let refRpsIdx = stRpsIdx - stRPS.delta_idx_minus1 - 1; /* 7-45 */
      deltaRps =
        (1 - 2 * stRPS.delta_rps_sign) *
        (stRPS.abs_delta_rps_minus1 + 1); /* 7-46 */

      let refRPS = this._shortTermRefPicSets[refRpsIdx];

      for (i = 0; i <= refRPS.NumDeltaPocs; i++) {
        usedByCurrPicFlag[i] = this._bitr.readBits(1);
        if (!usedByCurrPicFlag[i]) {
          useDeltaFlag[i] = this._bitr.readBits(1);
        }

        if (usedByCurrPicFlag[i] || useDeltaFlag[i]) {
          stRPS.NumDeltaPocs++;
        }
      }

      /* 7-47: calcuate NumNegativePics, DeltaPocS0 and UsedByCurrPicS0 */
      i = 0;
      let dPoc = 0;
      for (j = refRPS.NumPositivePics - 1; j >= 0; j--) {
        dPoc = refRPS.DeltaPocS1[j] + deltaRps;
        if (dPoc < 0 && useDeltaFlag[refRPS.NumNegativePics + j]) {
          stRPS.DeltaPocS0[i] = dPoc;
          stRPS.UsedByCurrPicS0[i++] =
            usedByCurrPicFlag[refRPS.NumNegativePics + j];
        }
      }
      if (deltaRps < 0 && useDeltaFlag[refRPS.NumDeltaPocs]) {
        stRPS.DeltaPocS0[i] = deltaRps;
        stRPS.UsedByCurrPicS0[i++] = usedByCurrPicFlag[refRPS.NumDeltaPocs];
      }
      for (j = 0; j < refRPS.NumNegativePics; j++) {
        dPoc = refRPS.DeltaPocS0[j] + deltaRps;
        if (dPoc < 0 && useDeltaFlag[j]) {
          stRPS.DeltaPocS0[i] = dPoc;
          stRPS.UsedByCurrPicS0[i++] = usedByCurrPicFlag[j];
        }
      }
      stRPS.NumNegativePics = i;

      /* 7-48: calcuate NumPositivePics, DeltaPocS1 and UsedByCurrPicS1 */
      i = 0;
      for (j = refRPS.NumNegativePics - 1; j >= 0; j--) {
        dPoc = refRPS.DeltaPocS0[j] + deltaRps;
        if (dPoc > 0 && useDeltaFlag[j]) {
          stRPS.DeltaPocS1[i] = dPoc;
          stRPS.UsedByCurrPicS1[i++] = usedByCurrPicFlag[j];
        }
      }
      if (deltaRps > 0 && useDeltaFlag[refRPS.NumDeltaPocs]) {
        stRPS.DeltaPocS1[i] = deltaRps;
        stRPS.UsedByCurrPicS1[i++] = usedByCurrPicFlag[refRPS.NumDeltaPocs];
      }
      for (j = 0; j < refRPS.NumPositivePics; j++) {
        dPoc = refRPS.DeltaPocS1[j] + deltaRps;
        if (dPoc > 0 && useDeltaFlag[refRPS.NumNegativePics + j]) {
          stRPS.DeltaPocS1[i] = dPoc;
          stRPS.UsedByCurrPicS1[i++] =
            usedByCurrPicFlag[refRPS.NumNegativePics + j];
        }
      }
      stRPS.NumPositivePics = i;
    } else {
      /* 7-49 */
      stRPS.NumNegativePics = this._bitr.readUE();

      /* 7-50 */
      stRPS.NumPositivePics = this._bitr.readUE();

      for (i = 0; i < stRPS.NumNegativePics; i++) {
        deltaPocS0Minus1[i] = this._bitr.readUE();

        /* 7-51 */
        stRPS.UsedByCurrPicS0[i] = this._bitr.readBits(1);

        if (i == 0) {
          /* 7-53 */
          stRPS.DeltaPocS0[i] = -(deltaPocS0Minus1[i] + 1);
        } else {
          /* 7-55 */
          stRPS.DeltaPocS0[i] =
            stRPS.DeltaPocS0[i - 1] - (deltaPocS0Minus1[i] + 1);
        }
      }

      for (j = 0; j < stRPS.NumPositivePics; j++) {
        deltaPocS1Minus1[j] = this._bitr.readUE();

        /* 7-52 */
        stRPS.UsedByCurrPicS1[j] = this._bitr.readBits(1);

        if (j == 0) {
          /* 7-54 */
          stRPS.DeltaPocS1[j] = deltaPocS1Minus1[j] + 1;
        } else {
          /* 7-56 */
          stRPS.DeltaPocS1[j] =
            stRPS.DeltaPocS1[j - 1] + (deltaPocS1Minus1[j] + 1);
        }
      }

      /* 7-57 */
      stRPS.NumDeltaPocs = stRPS.NumPositivePics + stRPS.NumNegativePics;
    }
  }

  _parseVUIParameters(maxNumSubLayersMinus1) {
    const aspectRatioInfoPresentFlag = this._bitr.readBits(1); // aspect_ratio_info_present_flag
    if (aspectRatioInfoPresentFlag) {
      const aspectRatioIdc = this._bitr.readBits(8);
      let sar = getSarFromAspectRatioIdc(aspectRatioIdc, () => {
        let sarW = this._bitr.readBits(16); // sar_width
        let sarH = this._bitr.readBits(16); // sar_height
        return { w: sarW, h: sarH };
      });
      this._sps.sar = sar;
    } else {
      this._sps.sar = getSarFromAspectRatioIdc(1); // default to square pixels
    }

    // overscan_info_present_flag
    if (this._bitr.readBits(1)) {
      this._bitr.skipBits(1); // overscan_appropriate_flag
    }
    // video_signal_type_present_flag
    if (this._bitr.readBits(1)) {
      this._bitr.skipBits(3); // video_format
      this._bitr.skipBits(1); // video_full_range_flag
      // colour_description_present_flag
      if (this._bitr.readBits(1)) {
        this._bitr.skipBits(8); // colour_primaries
        this._bitr.skipBits(8); // transfer_characteristics
        this._bitr.skipBits(8); // matrix_coefficients
      }
    }

    // chroma_loc_info_present_flag
    if (this._bitr.readBits(1)) {
      this._bitr.readUE(); // chroma_sample_loc_type_top_field
      this._bitr.readUE(); // chroma_sample_loc_type_bottom_field
    }
    this._bitr.skipBits(1); // neutral_chroma_indication_flag

    // units_field_based_flag[ i ] is used in calculating clockTimestamp[ i ], as specified in Equation D-26.
    // NOTE 2 – units_field_based_flag[ i ] is expected to be the same for all values of i for all pictures in the CVS.
    // When field_seq_flag is equal to 1 or frame_field_info_present_flag is equal to 1
    // and pic_struct is in the range of 1 to 6 or 9 to 12, inclusive, units_field_based_flag[ i ] is expected to be equal to 1.
    this._sps.fieldSeqFlag = this._bitr.readBits(1); // field_seq_flag
    this._bitr.skipBits(1); // frame_field_info_present_flag

    let defaultDisplayWindowFlag = this._bitr.readBits(1); // default_display_window_flag
    if (defaultDisplayWindowFlag) {
      this._bitr.readUE(); // def_disp_win_left_offset
      this._bitr.readUE(); // def_disp_win_right_offset
      this._bitr.readUE(); // def_disp_win_top_offset
      this._bitr.readUE(); // def_disp_win_bottom_offset
    }

    let vuiTimingInfoPresentFlag = this._bitr.readBits(1); // vui_timing_info_present_flag
    if (vuiTimingInfoPresentFlag) {
      this._sps.timingInfo = true;
      this._sps.numUnitsInTick = this._bitr.readBits(32); // num_units_in_tick
      this._sps.timeScale = this._bitr.readBits(32); // time_scale
      this._calcMaxFps();

      // There is currently no need to parse hrd parameters for H265
      // howerver it might be necessary in the future so keep it commented
      // let pocProportionalToTimingFlag = this._bitr.readBits(1); // poc_proportional_to_timing_flag
      // if (pocProportionalToTimingFlag) {
      //   this._bitr.readUE(); // vui_num_ticks_poc_diff_one_minus1
      // }

      // this._sps.hrdParametersPresentFlag = this._bitr.readBits(1); // hrd_parameters_present_flag
      // if (this._sps.hrdParametersPresentFlag) {
      //   this._parseHRDParameters(maxNumSubLayersMinus1);
      // }
    }

    // if (this._bitr.readBits(1)) { // bitstream_restriction_flag
    //   this._bitr.skipBits(3); // tiles_fixed_structure_flag, motion_vectors_over_pic_boundaries_flag,
    //                           // restricted_ref_pic_lists_flag
    //   this._bitr.readUE(); // min_spatial_segmentation_idc
    //   this._bitr.readUE(); // max_bytes_per_pic_denom
    //   this._bitr.readUE(); // max_bits_per_min_cu_denom
    //   this._bitr.readUE(); // log2_max_mv_length_horizontal
    //   this._bitr.readUE(); // log2_max_mv_length_vertical
    // }
  }
}
