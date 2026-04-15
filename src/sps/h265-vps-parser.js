import { H265BaseUnitParser } from "./h265-base-unit-parser";

export class H265VpsParser extends H265BaseUnitParser {
  constructor() {
    super();
  }

  parse(data, start, end, retObj) {
    this._assignBits(data, start, end);
    this._sps = retObj || {};

    let vpsVideoParameterSetId = this._bitr.readBits(4); // vps_video_parameter_set_id
    this._bitr.skipBits(2); // vps_base_layer_internal_flag, vps_base_layer_available_flag
    let vpsMaxLayersMinus1 = this._bitr.readBits(6); // vps_max_layers_minus1
    let vpsMaxSubLayersMinus1 = this._bitr.readBits(3); // vps_max_sub_layers_minus1
    this._bitr.skipBits(17); // vps_temporal_id_nesting_flag (1), vps_reserved_0xffff_16bits (16)

    this._parseProfileTierLevel(vpsMaxSubLayersMinus1); // profile_tier_level( 1, vps_max_sub_layers_minus1 )
    let vpsSubLayerOrderingInfoPresentFlag = this._bitr.readBits(1); // vps_sub_layer_ordering_info_present_flag

    let sIdx = vpsSubLayerOrderingInfoPresentFlag ? 0 : vpsMaxSubLayersMinus1;
    for (let i = sIdx; i <= vpsMaxSubLayersMinus1; i++) {
      this._bitr.readUE(); // vps_max_dec_pic_buffering_minus1[ i ]
      this._bitr.readUE(); // vps_max_num_reorder_pics[ i ]
      this._bitr.readUE(); // vps_max_latency_increase_plus1[ i ]
    }

    let vpsMaxLayerId = this._bitr.readBits(6); // vps_max_layer_id
    let vpsNumLayerSetsMinus1 = this._bitr.readUE(); // vps_num_layer_sets_minus1

    if (vpsMaxLayerId >= 0 && vpsNumLayerSetsMinus1 > 0) {
      this._bitr.skipBits(vpsNumLayerSetsMinus1 * (vpsMaxLayerId + 1)); // layer_id_included_flag[ i ][ j ]
    }

    let vpsTimingInfoPresent = this._bitr.readBits(1); // vps_timing_info_present_flag
    if (vpsTimingInfoPresent) {
      this._sps.timingInfo = true;
      this._sps.numUnitsInTick = this._bitr.readBits(32); // vps_num_units_in_tick
      this._sps.timeScale = this._bitr.readBits(32); // vps_time_scale
      this._calcMaxFps();

      // let vpsPocProportionalToTiming = this._bitr.readBits(1); // vps_poc_proportional_to_timing_flag
      // if (vpsPocProportionalToTiming) {
      //   this._bitr.readUE(); // vps_num_ticks_poc_diff_one_minus1
      // }
      // let vpsNumHrdParameters = this._bitr.readUE(); // vps_num_hrd_parameters
      // for (let i = 0; i < vpsNumHrdParameters; i++) {
      //   this._bitr.readUE(); // hrd_layer_set_idx[ i ]
      //   if (i > 0) {
      //     this._bitr.skipBits(1); // cprms_present_flag[ i ]
      //   }
      //   //  hrd_parameters( cprms_present_flag[ i ], vps_max_sub_layers_minus1 )
      //   this._parseHRDParameters(cprms_present_flag[ i ], vpsMaxSubLayersMinus1)
      // }
    }

    // let vpsExtensionFlag = this._bitr.readBits(1); // vps_extension_flag
    // if (vpsExtensionFlag) {
    //   while (more_rbsp_data()) {
    //     this._bitr.readBits(1); // vps_extension_data_flag
    //   }
    // }
  }
}
