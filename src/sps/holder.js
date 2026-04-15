import { multiInstanceService } from "@/shared/service";
import { H264SpsParser } from "./h264-sps-parser";
import { H264DecConfParser } from "./h264-dec-conf-parser";
import { H265SpsParser } from "./h265-sps-parser";
import { H265VpsParser } from "./h265-vps-parser";
import { H265DecConfParser } from "./h265-dec-conf-parser";

class SPSHolder {
  constructor(instName) {
    this._instId = instName;
    this._sps = {
      hasTimecodeParams: function () {
        return (
          this.numUnitsInTick !== undefined && this.timeScale !== undefined
        );
      },
    };
  }

  setCodec(codec) {
    if (this._codec === codec) return;
    if (this._codec) {
      this._resetParsers();
    }

    this._codec = codec;
    if (this._codec === "H264") {
      this._spsParser = new H264SpsParser();
      this._dcParser = new H264DecConfParser(this._spsParser);
    } else if (this._codec === "H265") {
      this._spsParser = new H265SpsParser();
      this._vpsParser = new H265VpsParser();
      this._dcParser = new H265DecConfParser(this._spsParser, this._vpsParser);
    }
  }

  getCodec() {
    return this._codec;
  }

  sps() {
    return this._sps;
  }

  parseSPS(data, start, end) {
    if (!this._spsParser || this._sps.timingInfo) return;

    this._spsParser.parse(data, start, end, this._sps);
  }

  parseDecoderConfig(data) {
    if (!this._dcParser) return;

    if (this._sps.timingInfo) {
      this._resetSPS();
    }
    this._dcParser.parse(data, this._sps);
  }

  _resetParsers() {
    this._spsParser = this._vpsParser = this._dcParser = undefined;
  }

  _resetSPS() {
    this._sps.profileIdc = undefined;
    this._sps.levelIdc = undefined;
    this._sps.spsId = undefined;
    this._sps.picStructPresentFlag = undefined;
    this._sps.hrdParametersPresentFlag = undefined;
    this._sps.initialCpbRemovalDelayLength = undefined;
    this._sps.cpbRemovalDelayLength = undefined;
    this._sps.dpbOutputDelayLength = undefined;
    this._sps.timeOffsetLength = undefined;
    this._sps.numUnitsInTick = undefined;
    this._sps.timeScale = undefined;
    this._sps.fieldSeqFlag = undefined;
    this._sps.maxFps = undefined;

    this._sps.timingInfo = false;
    this._sps.generalInfo = false;
  }
}

SPSHolder = multiInstanceService(SPSHolder);
export { SPSHolder };
