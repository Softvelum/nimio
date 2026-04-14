import { BitReader } from '@/shared/bit-reader'
import { NalReader } from '@/nal/reader'

export class H264SpsParser {
  constructor () {
    this._bitr = new BitReader();
  }

  parse (data, start, end, retObj) {
    const rbsp = NalReader.extractUnit(data, start, end);
    this._bitr.attach(rbsp);

    let sps = this._sps = (retObj || {});

    sps.profileIdc = this._bitr.readBits(8); // profile_idc
    this._bitr.readBits(8); // constraint_set_flags and reserved_zero_2bits
    sps.levelIdc = this._bitr.readBits(8); // level_idc
    sps.spsId = this._bitr.readUE(); // seq_parameter_set_id

    if (
      sps.profileIdc === 100 || sps.profileIdc === 110 || sps.profileIdc === 122 ||
      sps.profileIdc === 244 || sps.profileIdc === 44  || sps.profileIdc === 83  ||
      sps.profileIdc === 86  || sps.profileIdc === 118 || sps.profileIdc === 128 ||
      sps.profileIdc === 138 || sps.profileIdc === 139 || sps.profileIdc === 134 ||
      sps.profileIdc === 135
    ) {
      const chromaFormatIdc = this._bitr.readUE();
      if (chromaFormatIdc === 3) {
        this._bitr.readBits(1); // separate_colour_plane_flag
      }
      this._bitr.readUE(); // bit_depth_luma_minus8
      this._bitr.readUE(); // bit_depth_chroma_minus8
      this._bitr.readBits(1); // qpprime_y_zero_transform_bypass_flag
      const seqScalingMatrixPresentFlag = this._bitr.readBits(1);
      if (seqScalingMatrixPresentFlag) {
        const scalingListCount = chromaFormatIdc !== 3 ? 8 : 12;
        for (let i = 0; i < scalingListCount; i++) {
          const seqScalingListPresentFlag = this._bitr.readBits(1);
          if (seqScalingListPresentFlag) {
            if (i < 6) {
              this._skipScalingList(16);
            } else {
              this._skipScalingList(64);
            }
          }
        }
      }
    }

    this._bitr.readUE(); // log2_max_frame_num_minus4
    const picOrderCntType = this._bitr.readUE();
    if (picOrderCntType === 0) {
      this._bitr.readUE(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      this._bitr.readBits(1); // delta_pic_order_always_zero_flag
      this._bitr.readSE(); // offset_for_non_ref_pic
      this._bitr.readSE(); // offset_for_top_to_bottom_field
      const numRefFramesInPicOrderCntCycle = this._bitr.readUE();
      for (let i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
        this._bitr.readSE(); // offset_for_ref_frame[i]
      }
    }

    this._bitr.readUE(); // max_num_ref_frames
    this._bitr.readBits(1); // gaps_in_frame_num_value_allowed_flag
    this._bitr.readUE(); // pic_width_in_mbs_minus1
    this._bitr.readUE(); // pic_height_in_map_units_minus1
    
    const frameMbsOnlyFlag = this._bitr.readBits(1); // frame_mbs_only_flag
    if (!frameMbsOnlyFlag) {
      this._bitr.readBits(1); // mb_adaptive_frame_field_flag
    }
    this._bitr.readBits(1); // direct_8x8_inference_flag

    const frameCroppingFlag = this._bitr.readBits(1);
    if (frameCroppingFlag) {
      this._bitr.readUE(); // frame_crop_left_offset
      this._bitr.readUE(); // frame_crop_right_offset
      this._bitr.readUE(); // frame_crop_top_offset
      this._bitr.readUE(); // frame_crop_bottom_offset
    }

    const vuiParametersPresentFlag = this._bitr.readBits(1);
    if (vuiParametersPresentFlag) {
      this._readVUIParameters();
    }

    return this._sps;
  }

  _skipScalingList (size) {
    let lastScale = 8, nextScale = 8;
    for (let i = 0; i < size; i++) {
      if (nextScale !== 0) {
        let deltaScale = this._bitr.readSE();
        nextScale = (lastScale + deltaScale + 256) % 256;
      }
      lastScale = (nextScale === 0) ? lastScale : nextScale;
    }
  }

  _readVUIParameters () {
    const aspectRatioInfoPresentFlag = this._bitr.readBits(1);
    if (aspectRatioInfoPresentFlag) {
      // TODO: handle SAR/DAR parameters for correcting the player aspect ratio
      // Width = ((pic_width_in_mbs_minus1 +1)*16) - frame_crop_right_offset*2 - frame_crop_left_offset*2;
      // Height = ((2 - frame_mbs_only_flag)* (pic_height_in_map_units_minus1 +1) * 16) - (frame_crop_top_offset * 2) - (frame_crop_bottom_offset * 2);
      const aspectRatioIdc = this._bitr.readBits(8);
      if (aspectRatioIdc === 255) {
        let sarW = this._bitr.readBits(16); // sar_width
        let sarH = this._bitr.readBits(16); // sar_height
      }
    }
    if (this._bitr.readBits(1)) { // overscan_info_present_flag
      this._bitr.readBits(1); // overscan_appropriate_flag
    }
    if (this._bitr.readBits(1)) { // video_signal_type_present_flag
      this._bitr.readBits(3); // video_format
      this._bitr.readBits(1); // video_full_range_flag
      if (this._bitr.readBits(1)) { // colour_description_present_flag
        this._bitr.readBits(8); // colour_primaries
        this._bitr.readBits(8); // transfer_characteristics
        this._bitr.readBits(8); // matrix_coefficients
      }
    }
    if (this._bitr.readBits(1)) { // chroma_loc_info_present_flag
      this._bitr.readUE(); // chroma_sample_loc_type_top_field
      this._bitr.readUE(); // chroma_sample_loc_type_bottom_field
    }
    const timingInfoPresentFlag = this._bitr.readBits(1);
    if (timingInfoPresentFlag) {
      this._sps.timingInfo = true;
      this._sps.numUnitsInTick = this._bitr.readBits(32); // num_units_in_tick
      this._sps.timeScale = this._bitr.readBits(32); // time_scale
      if (this._sps.numUnitsInTick !== 0) {
        this._sps.maxFps = Math.ceil(this._sps.timeScale / (2 * this._sps.numUnitsInTick));
      }

      this._bitr.readBits(1); // fixed_frame_rate_flag
    }

    const nalHrdParametersPresentFlag = this._bitr.readBits(1);
    if (nalHrdParametersPresentFlag) {
      this._readHRDParameters();
    }
    const vclHrdParametersPresentFlag = this._bitr.readBits(1);
    if (vclHrdParametersPresentFlag) {
      this._readHRDParameters(); // vcl_hrd_parameters
    }
    if (nalHrdParametersPresentFlag || vclHrdParametersPresentFlag) {
      this._sps.hrdParametersPresentFlag = true;
      this._bitr.readBits(1); // low_delay_hrd_flag
    }
    this._sps.picStructPresentFlag = this._bitr.readBits(1);
    this._bitr.readBits(1); // bitstream_restriction_flag
    // if (this._bitr.readBits(1)) { // motion_vectors_over_pic_boundaries_flag
    //   this._bitr.readUE(); // max_bytes_per_pic_denom
    //   this._bitr.readUE(); // max_bits_per_mb_denom
    //   this._bitr.readUE(); // log2_max_mv_length_horizontal
    //   this._bitr.readUE(); // log2_max_mv_length_vertical
    //   this._bitr.readUE(); // max_num_reorder_frames
    //   this._bitr.readUE(); // max_dec_frame_buffering
    // }
  }

  _readHRDParameters () {
    const cpbCntMinus1 = this._bitr.readUE();
    this._bitr.readBits(4); // bit_rate_scale
    this._bitr.readBits(4); // cpb_size_scale
    for (let i = 0; i <= cpbCntMinus1; i++) {
      this._bitr.readUE(); // bit_rate_value_minus1[i]
      this._bitr.readUE(); // cpb_size_value_minus1[i]
      this._bitr.readBits(1); // cbr_flag[i]
    }

    let initialCpbRemovalDelayLengthMinus1 = this._bitr.readBits(5);
    let cpbRemovalDelayLengthMinus1 = this._bitr.readBits(5);
    let dpbOutputDelayLengthMinus1 = this._bitr.readBits(5);
    let timeOffsetLength = this._bitr.readBits(5);

    if (this._sps.cpbRemovalDelayLength === undefined) {
      this._sps.initialCpbRemovalDelayLength = initialCpbRemovalDelayLengthMinus1 + 1;
      this._sps.cpbRemovalDelayLength = cpbRemovalDelayLengthMinus1 + 1;
      this._sps.dpbOutputDelayLength = dpbOutputDelayLengthMinus1 + 1;
      this._sps.timeOffsetLength = timeOffsetLength;
    }
  }
}
